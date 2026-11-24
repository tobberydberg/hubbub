import { RoomType, type Room } from '@shared/talk-types'
import { selectAccount, openRoom } from '@renderer/sync/actions'
import { useApp, type AccountState } from '@renderer/store/app'
import { isInCall, useCall, type IncomingCall } from '@renderer/store/call'
import { usePrefs } from '@renderer/store/prefs'
import { shouldRing } from './rules'

// Incoming calls: noticed when a conversation's call starts between two room list refreshes.

const RING_FOR = 45_000

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const key = (accountId: string, token: string): string => `${accountId}/${token}`

export function detectIncomingCalls(prev: AccountState, rooms: Room[]): void {
  const accountId = prev.info.id
  for (const room of rooms) {
    const before = prev.rooms[room.token]
    if (!room.hasCall) {
      if (before?.hasCall) dismissIncoming(accountId, room.token)
      continue
    }
    if (!shouldRing(before, room, prev.user?.id) || isInCall(accountId, room.token)) continue
    if (!usePrefs.getState().ringForCalls || prev.userStatus === 'dnd') continue
    const last = Array.isArray(room.lastMessage) ? undefined : room.lastMessage
    const caller = last?.systemMessage === 'call_started' ? last.actorDisplayName : ''
    ring(prev, room, caller || (room.type === RoomType.OneToOne ? room.displayName : ''))
  }
}

function ring(account: AccountState, room: Room, caller: string): void {
  const accountId = account.info.id
  const k = key(accountId, room.token)
  if (timers.has(k)) return
  const call: IncomingCall = { accountId, token: room.token, caller, since: Date.now() }
  useCall.setState((s) => {
    s.incoming.push(call)
  })
  timers.set(
    k,
    setTimeout(() => dismissIncoming(accountId, room.token), RING_FOR)
  )
  startRinging()

  const multi = useApp.getState().accountOrder.length > 1
  const direct = room.type === RoomType.OneToOne
  const n = new Notification(direct ? `${room.displayName} is calling` : `Call in ${room.displayName}`, {
    body: [direct ? 'Incoming call' : caller && `${caller} started a call`, multi ? account.info.label : '']
      .filter(Boolean)
      .join(' · '),
    silent: true,
    tag: `call/${k}`
  })
  n.onclick = () => {
    void window.hubbub.app.focusWindow()
    selectAccount(accountId)
    openRoom(accountId, room.token)
  }
}

export function dismissIncoming(accountId: string, token: string): void {
  const k = key(accountId, token)
  clearTimeout(timers.get(k))
  timers.delete(k)
  useCall.setState((s) => {
    s.incoming = s.incoming.filter((c) => key(c.accountId, c.token) !== k)
  })
  if (!useCall.getState().incoming.length) stopRinging()
}

// --- Ring tone ---------------------------------------------------------------
// Synthesized, so there is no sound file to license: a soft two-note chime every two seconds.

let ringer: { ctx: AudioContext; timer: ReturnType<typeof setInterval> } | null = null

function chime(ctx: AudioContext): void {
  const notes: [number, number][] = [
    [659.25, 0],
    [880, 0.18]
  ]
  for (const [freq, offset] of notes) {
    const start = ctx.currentTime + offset
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + 0.65)
  }
}

function startRinging(): void {
  if (ringer || !usePrefs.getState().notifySound) return
  const ctx = new AudioContext()
  chime(ctx)
  ringer = { ctx, timer: setInterval(() => chime(ctx), 2000) }
}

function stopRinging(): void {
  if (!ringer) return
  clearInterval(ringer.timer)
  void ringer.ctx.close()
  ringer = null
}
