import type { CalendarEvent } from './caldav'

// Dates for the calendar views: local days (DST-safe, by calendar arithmetic rather than adding
// 24 hours), Monday-first weeks, and laying out the events of a day in side-by-side lanes.

export type CalendarViewKind = 'day' | 'week' | 'month' | 'agenda'

export const DAY_MS = 86_400_000

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function addDays(ms: number, days: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes()).getTime()
}

/** Monday of the week */
export function startOfWeek(ms: number): number {
  const day = startOfDay(ms)
  return addDays(day, -((new Date(day).getDay() + 6) % 7))
}

export function startOfMonth(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

export function addMonths(ms: number, months: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth() + months, 1).getTime()
}

export const isSameDay = (a: number, b: number): boolean => startOfDay(a) === startOfDay(b)

/** ISO 8601 week number: weeks start on Monday, and week 1 holds the year's first Thursday */
export function isoWeek(ms: number): number {
  const d = new Date(startOfDay(ms))
  // The Thursday of this week decides the year the week belongs to
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7))
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
}

export const AGENDA_DAYS = 14

/** The days a view shows around `date`, and the time range its events are fetched for. */
export function viewRange(
  view: CalendarViewKind,
  date: number
): { days: number[]; start: number; end: number } {
  let first: number
  let count: number
  if (view === 'day') {
    first = startOfDay(date)
    count = 1
  } else if (view === 'week') {
    first = startOfWeek(date)
    count = 7
  } else if (view === 'month') {
    // Whole weeks from the Monday on or before the 1st: 6 rows, like most calendars
    first = startOfWeek(startOfMonth(date))
    count = 42
  } else {
    first = startOfDay(date)
    count = AGENDA_DAYS
  }
  const days = Array.from({ length: count }, (_, i) => addDays(first, i))
  return { days, start: first, end: addDays(first, count) }
}

/** Moves the view one step (a day, a week, a month or the agenda's length) forward or back. */
export function stepDate(view: CalendarViewKind, date: number, direction: 1 | -1): number {
  if (view === 'day') return addDays(date, direction)
  if (view === 'week') return addDays(date, 7 * direction)
  if (view === 'month') return addMonths(date, direction)
  return addDays(date, AGENDA_DAYS * direction)
}

/** Whether an event is on a day: timed events that touch it, all-day events that cover it. */
export function onDay(event: CalendarEvent, day: number): boolean {
  const next = addDays(day, 1)
  return event.start < next && (event.end > day || (event.end === event.start && event.start >= day))
}

export interface PlacedEvent {
  event: CalendarEvent
  /** Minutes from the day's start, clamped to the day */
  top: number
  height: number
  lane: number
  lanes: number
}

const MIN_MINUTES = 15

/**
 * The timed events of a day, placed in lanes: events that overlap share the width, each group of
 * overlapping events as many lanes as it needs.
 */
export function layoutDay(events: CalendarEvent[], day: number): PlacedEvent[] {
  const dayEnd = addDays(day, 1)
  const items = events
    .filter((e) => !e.allDay && onDay(e, day))
    .map((event) => {
      const top = Math.max(0, (event.start - day) / 60_000)
      const bottom = Math.min((dayEnd - day) / 60_000, (event.end - day) / 60_000)
      return { event, top, height: Math.max(MIN_MINUTES, bottom - top), lane: 0, lanes: 1 }
    })
    .sort((a, b) => a.top - b.top || b.height - a.height)

  let group: typeof items = []
  let groupEnd = -1
  const finish = (): void => {
    const lanes = Math.max(1, ...group.map((i) => i.lane + 1))
    for (const i of group) i.lanes = lanes
    group = []
  }
  for (const item of items) {
    if (item.top >= groupEnd) {
      finish()
      groupEnd = -1
    }
    const laneEnds: number[] = []
    for (const other of group)
      laneEnds[other.lane] = Math.max(laneEnds[other.lane] ?? -1, other.top + other.height)
    let lane = laneEnds.findIndex((end) => end <= item.top)
    if (lane < 0) lane = laneEnds.length
    item.lane = lane
    group.push(item)
    groupEnd = Math.max(groupEnd, item.top + item.height)
  }
  finish()
  return items
}

const time = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export const formatTime = time

/** "14:00–15:30", "All day", or with dates when it spans days */
export function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) {
    const days = Math.round((startOfDay(event.end) - startOfDay(event.start)) / DAY_MS)
    if (days <= 1) return 'All day'
    const last = addDays(event.end, -1)
    return `${formatDate(event.start)} – ${formatDate(last)}`
  }
  if (isSameDay(event.start, event.end) || event.end - event.start < DAY_MS / 2) {
    return `${time(event.start)}–${time(event.end)}`
  }
  return `${formatDate(event.start)} ${time(event.start)} – ${formatDate(event.end)} ${time(event.end)}`
}

export function formatDate(ms: number, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...opts
  })
}

/** The heading of a view: "23 – 29 November 2026", "November 2026", … */
export function viewTitle(view: CalendarViewKind, date: number, days: number[]): string {
  const month = (ms: number, opts: Intl.DateTimeFormatOptions = {}): string =>
    new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric', ...opts })
  if (view === 'month') return month(date)
  if (view === 'day')
    return new Date(date).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  const first = new Date(days[0])
  const last = new Date(days[days.length - 1])
  if (first.getMonth() === last.getMonth()) return `${first.getDate()} – ${last.getDate()} ${month(days[0])}`
  const short = { day: 'numeric', month: 'short' } as const
  return `${first.toLocaleDateString(undefined, short)} – ${last.toLocaleDateString(undefined, { ...short, year: 'numeric' })}`
}
