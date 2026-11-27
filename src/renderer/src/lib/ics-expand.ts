import ICAL from 'ical.js'
import { eventFrom, type CalendarEvent, type ParseContext } from './caldav'

// Calendars Hubbub reads itself (a calendar link, iCloud) come as whole events with their repeat
// rules, where Nextcloud hands over each occurrence. They're parsed once per change and expanded
// here into the occurrences of the range on screen: repeat rules, skipped dates (EXDATE) and changed
// occurrences (RECURRENCE-ID), in the time zones the calendar defines.

/** Repeating events are expanded this far at most, so a broken rule can't hang the window */
const MAX_OCCURRENCES = 20_000

export interface ParsedCalendar {
  /** One per event (UID), with its changed occurrences related to it */
  series: { event: ICAL.Event; href: string }[]
  /** The calendar's own name and color, when it gives them (X-WR-CALNAME, X-APPLE-CALENDAR-COLOR) */
  name?: string
  color?: string
}

/** Parses calendar objects: a link's single file, or a CalDAV calendar's events one by one */
export function parseCalendarObjects(objects: { href: string; ics: string }[]): ParsedCalendar {
  const byUid = new Map<string, { href: string; master?: ICAL.Component; changed: ICAL.Component[] }>()
  let name: string | undefined
  let color: string | undefined
  for (const { href, ics } of objects) {
    let calendar: ICAL.Component
    try {
      calendar = new ICAL.Component(ICAL.parse(ics))
    } catch {
      continue
    }
    name ??= calendar.getFirstPropertyValue('x-wr-calname')?.toString() || undefined
    color ??= /^#[0-9a-f]{6}/i.exec(
      calendar.getFirstPropertyValue('x-apple-calendar-color')?.toString() ?? ''
    )?.[0]
    for (const zone of calendar.getAllSubcomponents('vtimezone')) {
      const tzid = zone.getFirstPropertyValue('tzid')?.toString()
      if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(new ICAL.Timezone(zone))
    }
    for (const vevent of calendar.getAllSubcomponents('vevent')) {
      const uid = vevent.getFirstPropertyValue('uid')?.toString() ?? `${href}#${byUid.size}`
      const entry = byUid.get(uid) ?? { href, changed: [] }
      if (vevent.hasProperty('recurrence-id')) entry.changed.push(vevent)
      else entry.master = vevent
      byUid.set(uid, entry)
    }
  }
  const series: ParsedCalendar['series'] = []
  for (const { href, master, changed } of byUid.values()) {
    if (master) {
      const event = new ICAL.Event(master)
      for (const c of changed) {
        try {
          event.relateException(new ICAL.Event(c))
        } catch {
          // Not this event's occurrence after all
        }
      }
      series.push({ event, href })
    } else {
      // Invited to single occurrences only: each stands alone
      for (const c of changed) series.push({ event: new ICAL.Event(c), href })
    }
  }
  return { series, name, color }
}

/**
 * Milliseconds for a time. A zone the calendar defines is known to ical.js; one it only names
 * (some servers leave the definitions out) is looked up by its name, and a name nobody knows is
 * taken as local time.
 */
export function timeOf(t: ICAL.Time): number {
  const tzid = (t as ICAL.Time & { timezone?: string }).timezone
  if (t.isDate || !tzid || tzid === 'UTC' || tzid === 'Z' || ICAL.TimezoneService.has(tzid)) {
    return t.toJSDate().getTime()
  }
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
  const first = offsetIn(tzid, wall)
  if (first === null) return t.toJSDate().getTime()
  // Twice, for times near a daylight saving change
  const second = offsetIn(tzid, wall - first)
  return wall - (second ?? first)
}

/** How far ahead of UTC a zone is at a moment, in ms; null for an unknown zone */
function offsetIn(tzid: string, at: number): number | null {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tzid,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric'
      })
        .formatToParts(at)
        .map((p) => [p.type, Number(p.value)])
    )
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - at
  } catch {
    return null
  }
}

/** The occurrences between start and end (ms), cancelled ones left out */
export function expandCalendar(
  parsed: ParsedCalendar,
  start: number,
  end: number,
  ctx: ParseContext
): CalendarEvent[] {
  const events: CalendarEvent[] = []
  const add = (
    item: ICAL.Event,
    href: string,
    startTime: ICAL.Time,
    endTime: ICAL.Time | null,
    recurrenceId?: string
  ): void => {
    const allDay = startTime.isDate
    const s = timeOf(startTime)
    const e = endTime ? timeOf(endTime) : s + (allDay ? 86_400_000 : 0)
    if (e <= start && !(e === s && s >= start)) return
    if (s >= end) return
    if (item.component.getFirstPropertyValue('status')?.toString().toUpperCase() === 'CANCELLED') return
    const event = eventFrom(item.component, { start: s, end: e, allDay, recurrenceId }, href, ctx)
    // An id per occurrence that stays the same between refreshes
    event.id = `${ctx.calendarHref}#${href}#${item.uid}#${recurrenceId ?? ''}`
    events.push(event)
  }
  for (const { event, href } of parsed.series) {
    if (!event.startDate) continue
    if (!event.isRecurring()) {
      add(event, href, event.startDate, event.endDate, event.recurrenceId?.toString())
      continue
    }
    const seen = new Set<string>()
    const it = event.iterator()
    for (let i = 0, next = it.next(); next && i < MAX_OCCURRENCES; i++, next = it.next()) {
      const details = event.getOccurrenceDetails(next)
      const id = details.recurrenceId.toString()
      seen.add(id)
      // Past the range: changed occurrences may still have been moved into it (below)
      if (timeOf(next) >= end && timeOf(details.startDate) >= end) break
      add(details.item, href, details.startDate, details.endDate, id)
    }
    // An occurrence moved into the range from a date the loop above didn't reach
    for (const [id, changed] of Object.entries(event.exceptions)) {
      if (seen.has(id) || !changed.startDate) continue
      add(changed, href, changed.startDate, changed.endDate, changed.recurrenceId?.toString() ?? id)
    }
  }
  return events.sort((a, b) => a.start - b.start)
}
