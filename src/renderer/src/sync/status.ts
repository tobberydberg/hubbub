import { talk, TalkError } from '@renderer/api/talk'
import { chatKey, showToast, useApp } from '@renderer/store/app'
import type { Room, UserProfile, UserStatus } from '@shared/talk-types'
import { RoomType } from '@shared/talk-types'

// Your own status (online, away, … and a message like "🏡 Working remotely" that can clear itself),
// and what Hubbub knows about other people for their profile card: their profile, their status, and
// when they were last active.

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function store(accountId: string, st: UserStatus): void {
  useApp.setState((s) => {
    const a = s.accounts[accountId]
    if (!a) return
    a.ownStatus = st
    a.userStatus = st.status
  })
  scheduleExpiry(accountId, st.clearAt)
}

const expiry: Record<string, ReturnType<typeof setTimeout>> = {}

/** Reload the status once its message has cleared itself on the server */
function scheduleExpiry(accountId: string, clearAt: number | null | undefined): void {
  clearTimeout(expiry[accountId])
  if (!clearAt) return
  const wait = clearAt * 1000 - Date.now() + 5_000
  // Timers don't run that long reliably; the menu reloads it when opened anyway
  if (wait > 0 && wait < 2 ** 31 - 1)
    expiry[accountId] = setTimeout(() => void refreshOwnStatus(accountId), wait)
}

export async function refreshOwnStatus(accountId: string): Promise<void> {
  const api = talk(accountId)
  if (useApp.getState().accounts[accountId]?.canBeBusy === undefined) {
    void api
      .supportsBusy()
      .then((busy) =>
        useApp.setState((s) => {
          const a = s.accounts[accountId]
          if (a) a.canBeBusy = busy
        })
      )
      .catch(() => undefined)
  }
  try {
    store(accountId, await api.userStatus())
  } catch {
    // Keep what we have
  }
}

export interface StatusMessage {
  icon: string | null
  message: string
  /** Nextcloud's predefined message, when it is one unchanged (others then see it in their language) */
  predefinedId?: string
  /** Unix seconds, or null for never */
  clearAt: number | null
}

/** Sets the status (online, away, …) and the message in one go; resolves with whether it worked */
export async function saveOwnStatus(
  accountId: string,
  status: string | null,
  message: StatusMessage | null
): Promise<boolean> {
  const api = talk(accountId)
  try {
    const current = useApp.getState().accounts[accountId]?.ownStatus
    if (status && (status !== current?.status || !current?.statusIsUserDefined)) {
      await api.setUserStatus(status)
    }
    if (!message || !message.message.trim()) {
      if (current?.message || current?.icon) await api.clearStatusMessage()
    } else if (message.predefinedId) {
      await api.setPredefinedMessage(message.predefinedId, message.clearAt)
    } else {
      await api.setCustomMessage(message.message.trim(), message.icon, message.clearAt)
    }
    await refreshOwnStatus(accountId)
    return true
  } catch (err) {
    showToast(`Your status couldn’t be set: ${errorText(err)}`, 'error')
    return false
  }
}

export async function clearOwnStatusMessage(accountId: string): Promise<void> {
  try {
    await talk(accountId).clearStatusMessage()
    await refreshOwnStatus(accountId)
  } catch (err) {
    showToast(`Your status couldn’t be cleared: ${errorText(err)}`, 'error')
  }
}

// --- When people were last active -------------------------------------------------
//
// Nextcloud tells only admins when someone last logged in. Hubbub notes when it sees people online
// (their status in direct messages, member lists and profile cards) and remembers it on this computer;
// their latest message counts too.

const SEEN_KEY = 'hubbub.lastSeen'
const SEEN_MAX = 2000
let seen: Record<string, number> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function seenMap(): Record<string, number> {
  if (!seen) {
    try {
      seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>
    } catch {
      seen = {}
    }
  }
  return seen
}

const isActive = (status: string | null | undefined): boolean =>
  !!status && status !== 'offline' && status !== 'invisible'

/** Notes that someone is active now when their status says so */
export function notePresence(accountId: string, userId: string, status: string | null | undefined): void {
  if (!isActive(status)) return
  const map = seenMap()
  map[`${accountId}/${userId}`] = Date.now()
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    const entries = Object.entries(map)
    if (entries.length > SEEN_MAX) {
      seen = Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, SEEN_MAX))
    }
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
    } catch {
      // Not remembered across restarts, then
    }
  }, 10_000)
}

/** The people in direct messages, whose status comes with the conversation list */
export function notePresenceInRooms(accountId: string, rooms: Room[]): void {
  for (const r of rooms) if (r.type === RoomType.OneToOne) notePresence(accountId, r.name, r.status)
}

/** When someone was last active as far as Hubbub knows (ms), or null */
export function lastSeen(accountId: string, userId: string): number | null {
  let latest = seenMap()[`${accountId}/${userId}`] ?? 0
  const s = useApp.getState()
  const prefix = chatKey(accountId, '')
  for (const [key, chat] of Object.entries(s.chats)) {
    if (!key.startsWith(prefix)) continue
    for (let i = chat.ids.length - 1; i >= 0; i--) {
      const m = chat.byId[chat.ids[i]]
      if (m?.actorType !== 'users' || m.actorId !== userId) continue
      latest = Math.max(latest, m.timestamp * 1000)
      break
    }
  }
  return latest || null
}

// --- Profiles ---------------------------------------------------------------------

export interface PersonCard {
  profile: UserProfile | null
  status: UserStatus | null
}

const cards = new Map<string, { at: number; card: Promise<PersonCard> }>()

/** Someone's profile and status, kept for a minute */
export function loadPersonCard(accountId: string, userId: string): Promise<PersonCard> {
  const key = `${accountId}/${userId}`
  const cached = cards.get(key)
  if (cached && Date.now() - cached.at < 60_000) return cached.card
  const api = talk(accountId)
  const card = Promise.all([
    // Without profiles (turned off, or before Nextcloud 23) the card shows what Talk knows
    api.profile(userId).catch(() => null),
    api
      .statusOf(userId)
      .catch((err: unknown) =>
        err instanceof TalkError && err.status === 404 ? ({ userId, status: 'offline' } as UserStatus) : null
      )
  ]).then(([profile, status]) => {
    notePresence(accountId, userId, status?.status)
    return { profile, status }
  })
  cards.set(key, { at: Date.now(), card })
  card.catch(() => cards.delete(key))
  return card
}
