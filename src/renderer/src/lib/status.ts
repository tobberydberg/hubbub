// Your status as Nextcloud keeps it (online, away, …, with a message such as "🏡 Working remotely"
// that can clear itself), and how other people's status and last activity read.

export type StatusType = 'online' | 'away' | 'busy' | 'dnd' | 'invisible'

/** When a status message clears itself */
export type ClearAfter = 'never' | '15m' | '30m' | '1h' | '4h' | 'today' | 'week' | 'custom'

export const CLEAR_AFTER: { value: ClearAfter; label: string }[] = [
  { value: 'never', label: 'Don’t clear' },
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'custom', label: 'Choose date and time…' }
]

const PERIODS: Partial<Record<ClearAfter, number>> = { '15m': 900, '30m': 1800, '1h': 3600, '4h': 14_400 }

/** Nextcloud's suggestion for when a predefined message clears */
export interface PredefinedClearAt {
  type: 'period' | 'end-of'
  time: number | string
}

/** A status message to pick: Nextcloud's own (with an id) or one Hubbub adds */
export interface StatusSuggestion {
  /** Nextcloud's id for its predefined messages, which other apps translate */
  id?: string
  icon: string
  message: string
  clearAfter: ClearAfter
}

/** Suggestions Nextcloud doesn't have */
export const EXTRA_SUGGESTIONS: StatusSuggestion[] = [
  { icon: '✈️', message: 'Traveling', clearAfter: 'never' },
  { icon: '🍽️', message: 'Out for lunch', clearAfter: '1h' }
]

/** The choice that matches a predefined message's own clearing */
export function clearAfterOf(clearAt: PredefinedClearAt | null | undefined): ClearAfter {
  if (!clearAt) return 'never'
  if (clearAt.type === 'end-of') return clearAt.time === 'week' ? 'week' : 'today'
  const match = Object.entries(PERIODS).find(([, s]) => s === Number(clearAt.time))
  return (match?.[0] as ClearAfter | undefined) ?? 'today'
}

/** When the message clears (unix seconds), or null for never; `custom` is the chosen time */
export function clearAtFor(choice: ClearAfter, now = new Date(), custom?: number | null): number | null {
  const base = Math.floor(now.getTime() / 1000)
  const period = PERIODS[choice]
  if (period) return base + period
  if (choice === 'today') {
    return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() / 1000)
  }
  if (choice === 'week') {
    // Weeks start on Monday, as in the calendar
    const toMonday = (8 - now.getDay()) % 7 || 7
    return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMonday).getTime() / 1000)
  }
  if (choice === 'custom') return custom ?? null
  return null
}

const time = (d: Date): string => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const dayDiff = (a: Date, b: Date): number =>
  Math.round(
    (new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() -
      new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) /
      86_400_000
  )

/** "until 17:00", "until tomorrow 09:00", "until Mon 1 Dec" (clearAt in unix seconds) */
export function formatUntil(clearAt: number, now = new Date()): string {
  const d = new Date(clearAt * 1000)
  const days = dayDiff(d, now)
  // Midnight is the end of the day before
  if (d.getHours() === 0 && d.getMinutes() === 0) {
    if (days === 1) return 'until the end of today'
    const before = new Date(d.getTime() - 1000)
    return `until the end of ${before.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`
  }
  if (days === 0) return `until ${time(d)}`
  if (days === 1) return `until tomorrow ${time(d)}`
  return `until ${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time(d)}`
}

/** "Online now", or how long ago someone was last active (ms) */
export function formatLastSeen(at: number, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - at) / 60_000)
  if (minutes < 2) return 'Active just now'
  if (minutes < 60) return `Active ${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  const d = new Date(at)
  if (hours < 6) return `Active ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = dayDiff(now, d)
  if (days === 0) return `Active today at ${time(d)}`
  if (days === 1) return `Active yesterday at ${time(d)}`
  if (days < 7) return `Active ${d.toLocaleDateString(undefined, { weekday: 'long' })}`
  return `Active ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined })}`
}

export const STATUS_LABEL: Record<string, string> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
  dnd: 'Do not disturb',
  invisible: 'Invisible',
  offline: 'Offline'
}
