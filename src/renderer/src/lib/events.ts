import type { Room } from '@shared/talk-types'

/** Conversation created by the Calendar app for an event (Talk 21+); objectId is "start#end". */
export const OBJECT_TYPE_EVENT = 'event'
/** Conversation created for an instant ("meet now") meeting */
export const OBJECT_TYPE_INSTANT_MEETING = 'instant_meeting'

export interface EventTime {
  /** Unix seconds */
  start: number
  end: number
}

/**
 * Whether a conversation is a meeting. `overrides` holds the user's own choices by token, for meeting
 * conversations Talk doesn't mark as such (e.g. calendar links created before Talk 21).
 */
export function isMeeting(r: Room, overrides?: Record<string, boolean>): boolean {
  const own = overrides?.[r.token]
  if (own !== undefined) return own
  return r.objectType === OBJECT_TYPE_EVENT || r.objectType === OBJECT_TYPE_INSTANT_MEETING
}

export function eventTime(r: Room): EventTime | null {
  if (r.objectType !== OBJECT_TYPE_EVENT || !r.objectId) return null
  const [start, end] = r.objectId.split('#').map(Number)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null
  return { start, end: Math.max(start, end) }
}

/** When a meeting is over: the event's end, or the last activity of an instant meeting. */
export function meetingEnd(r: Room): number {
  return eventTime(r)?.end ?? r.lastActivity
}

export function isOngoing(r: Room, now = Date.now() / 1000): boolean {
  const t = eventTime(r)
  return !!t && t.start <= now && now < t.end
}

/** Starting within `withinSeconds` or currently running. */
export function isSoon(r: Room, now = Date.now() / 1000, withinSeconds = 15 * 60): boolean {
  const t = eventTime(r)
  return !!t && t.start - withinSeconds <= now && now < t.end
}

/** Upcoming and running meetings first (soonest first), then past ones (most recent first). */
export function sortMeetings(rooms: Room[], now = Date.now() / 1000): Room[] {
  const upcoming = (r: Room): boolean => meetingEnd(r) > now
  return [...rooms].sort((a, b) => {
    const ua = upcoming(a)
    const ub = upcoming(b)
    if (ua !== ub) return ua ? -1 : 1
    if (ua) return (eventTime(a)?.start ?? a.lastActivity) - (eventTime(b)?.start ?? b.lastActivity)
    return meetingEnd(b) - meetingEnd(a)
  })
}

function dayDiff(ts: number, now: number): number {
  const d = new Date(ts * 1000)
  const n = new Date(now * 1000)
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
  return Math.round((day - today) / 86_400_000)
}

/** Short label for the sidebar: "Now", "Today 14:00", "Tomorrow 09:30", "Tue 25 Nov". */
export function formatEventTime(r: Room, now = Date.now() / 1000): string | null {
  const t = eventTime(r)
  if (!t) return null
  if (t.start <= now && now < t.end) return 'Now'
  const time = new Date(t.start * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const diff = dayDiff(t.start, now)
  if (diff === 0) return `Today ${time}`
  if (diff === 1) return `Tomorrow ${time}`
  if (diff === -1) return 'Yesterday'
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
  if (new Date(t.start * 1000).getFullYear() !== new Date(now * 1000).getFullYear()) opts.year = 'numeric'
  return new Date(t.start * 1000).toLocaleDateString([], opts)
}

/** Full label for headers and tooltips, e.g. "Tuesday 25 November, 14:00 – 15:00". */
export function formatEventRange(r: Room): string | null {
  const t = eventTime(r)
  if (!t) return null
  const start = new Date(t.start * 1000)
  const end = new Date(t.end * 1000)
  const day = start.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
  const hm = (d: Date): string => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const sameDay = start.toDateString() === end.toDateString()
  return sameDay
    ? `${day}, ${hm(start)} – ${hm(end)}`
    : `${day}, ${hm(start)} – ${end.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hm(end)}`
}
