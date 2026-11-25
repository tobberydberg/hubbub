import type { SignalingSettings } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { HpbSignaling, type SignalData } from '@renderer/calls/signaling'
import { useApp, type AccountState } from '@renderer/store/app'
import { isInCall, useCall } from '@renderer/store/call'
import { clearTyping, setTyping, typingKey } from '@renderer/store/typing'

// Being "in" the conversation that is on screen, like Talk on the web: a conversation session on the
// Nextcloud server plus the same conversation on the signaling server. That is what typing signals
// travel through. It ends a minute after the window is hidden, so Nextcloud notifies the user's
// other devices again.

const HIDDEN_GRACE = 60_000

/** Typing signals need the High-Performance Backend and the user's typing privacy set to public. */
function typingAllowed(account: AccountState | undefined): boolean {
  const chat = account?.caps?.config.chat as { 'typing-privacy'?: number } | undefined
  return chat?.['typing-privacy'] === 0
}

class RoomPresence {
  private signaling: HpbSignaling | null = null
  private settings: SignalingSettings | null = null
  private token: string | null = null
  private ncSession = ''
  /** Signaling sessions in the conversation, other than ours */
  private readonly sessions = new Map<string, { name: string; userId?: string }>()
  private queue: Promise<void> = Promise.resolve()

  constructor(readonly accountId: string) {}

  /** The conversation on screen, or null; changes are applied one after the other. */
  setRoom(token: string | null): void {
    this.queue = this.queue.then(() => this.switchTo(token)).catch(() => undefined)
  }

  /** Holds further changes until `done`, e.g. while a call leaves */
  hold(done: Promise<void>): void {
    this.queue = this.queue.then(() => done).catch(() => undefined)
  }

  /** Resolves once the changes asked for so far are applied */
  settled(): Promise<void> {
    return this.queue
  }

  sendTyping(token: string, typing: boolean): boolean {
    if (this.token !== token || !this.signaling) return false
    const selfId = useApp.getState().accounts[this.accountId]?.user?.id
    for (const [sessionId, s] of this.sessions) {
      if (s.userId && s.userId === selfId) continue
      this.signaling.sendToSession(sessionId, {
        type: typing ? 'startedTyping' : 'stoppedTyping',
        to: sessionId
      })
    }
    return true
  }

  private async switchTo(screen: string | null): Promise<void> {
    // During our own call in this conversation, the call's session carries the typing signals
    const token = screen && !isInCall(this.accountId, screen) ? screen : null
    if (token === this.token) return
    if (this.token) await this.leave()
    const account = useApp.getState().accounts[this.accountId]
    if (!token || !typingAllowed(account)) return
    const api = talk(this.accountId)
    if (!this.signaling) {
      this.settings = await api.signalingSettings(token)
      if (this.settings.signalingMode !== 'external' || !this.settings.server || !account) return
      this.signaling = new HpbSignaling(
        account.info.serverUrl,
        this.settings,
        () => api.signalingSettings(token),
        {
          message: (from, data) => this.onMessage(from, data),
          join: (sessions) => {
            for (const s of sessions) {
              if (s.sessionid === this.signaling?.sessionId) continue
              this.sessions.set(s.sessionid, {
                name: s.user?.displayname || s.userid || 'Guest',
                userId: s.userid
              })
            }
          },
          leave: (ids) => {
            for (const id of ids) {
              this.sessions.delete(id)
              if (this.token) setTyping(typingKey(this.accountId, this.token), id, null)
            }
          },
          participants: () => undefined,
          reset: () => this.sessions.clear(),
          connection: () => undefined,
          closed: () => void this.reset(),
          switchTo: () => undefined
        }
      )
      await this.signaling.connect()
    }
    // Not forced: if the user is in a call in this conversation on another device, that stays as it is
    const res = await api.joinSession(token, false)
    if (!res.ok || !res.data) return
    this.ncSession = res.data.sessionId
    this.token = token
    await this.signaling.joinRoom(token, this.ncSession)
  }

  private onMessage(from: string, data: SignalData): void {
    if (data.type !== 'startedTyping' && data.type !== 'stoppedTyping') return
    const who = this.sessions.get(from)
    if (!this.token || !who) return
    const selfId = useApp.getState().accounts[this.accountId]?.user?.id
    if (who.userId && who.userId === selfId) return
    setTyping(typingKey(this.accountId, this.token), from, data.type === 'startedTyping' ? who : null)
  }

  private async leave(): Promise<void> {
    const token = this.token
    this.token = null
    this.sessions.clear()
    if (!token) return
    clearTyping(typingKey(this.accountId, token))
    this.signaling?.leaveRoom()
    await talk(this.accountId)
      .leaveSession(token)
      .catch(() => undefined)
  }

  private async reset(): Promise<void> {
    await this.leave()
    const signaling = this.signaling
    this.signaling = null
    await signaling?.close()
  }

  close(): void {
    this.queue = this.queue.then(() => this.reset()).catch(() => undefined)
  }
}

const presences = new Map<string, RoomPresence>()
let hiddenTimer: ReturnType<typeof setTimeout> | null = null
let visible = typeof document === 'undefined' || document.visibilityState === 'visible'

function presenceFor(accountId: string): RoomPresence {
  let p = presences.get(accountId)
  if (!p) presences.set(accountId, (p = new RoomPresence(accountId)))
  return p
}

function update(): void {
  const s = useApp.getState()
  for (const [id, account] of Object.entries(s.accounts)) {
    const onScreen =
      visible && s.activeAccountId === id && account.view === 'room' && account.status === 'online'
    if (onScreen && account.activeToken) presenceFor(id).setRoom(account.activeToken)
    else presences.get(id)?.setRoom(null)
  }
  for (const [id, p] of presences) {
    if (!s.accounts[id]) {
      p.close()
      presences.delete(id)
    }
  }
}

// Nextcloud keeps one session per conversation for us (per login cookie), so presence and a call in
// the same conversation would replace each other's: presence leaves before the call joins, and
// comes back after the call has left.

/** Resolves once presence has left the conversation our call is about to join. */
export function presenceYielded(accountId: string): Promise<void> {
  return presences.get(accountId)?.settled() ?? Promise.resolve()
}

/** Presence stays out until our call has left its conversation. */
export function holdPresence(accountId: string, until: Promise<void>): void {
  presences.get(accountId)?.hold(until)
}

/** Sends our typing state to the others in the conversation; false if there is no way to. */
export function sendTypingSignal(accountId: string, token: string, typing: boolean): boolean {
  return presences.get(accountId)?.sendTyping(token, typing) ?? false
}

export function startPresence(): void {
  let last = ''
  useApp.subscribe((s) => {
    const a = s.activeAccountId ? s.accounts[s.activeAccountId] : undefined
    const sig = `${s.activeAccountId}|${a?.view}|${a?.activeToken}|${a?.status}|${Object.keys(s.accounts).length}`
    if (sig === last) return
    last = sig
    update()
  })
  // Joining or leaving a call in the conversation on screen changes which session carries typing
  let lastCall = ''
  useCall.subscribe((s) => {
    const sig = s.active ? `${s.active.accountId}/${s.active.token}` : ''
    if (sig === lastCall) return
    lastCall = sig
    update()
  })
  document.addEventListener('visibilitychange', () => {
    if (hiddenTimer) clearTimeout(hiddenTimer)
    hiddenTimer = null
    if (document.visibilityState === 'visible') {
      visible = true
      update()
    } else {
      hiddenTimer = setTimeout(() => {
        visible = false
        update()
      }, HIDDEN_GRACE)
    }
  })
  update()
}
