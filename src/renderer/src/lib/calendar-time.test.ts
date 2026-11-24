import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from './caldav'
import { addDays, isoWeek, layoutDay, onDay, startOfWeek, stepDate, viewRange } from './calendar-time'

const at = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime()
const ev = (id: string, start: number, end: number, allDay = false): CalendarEvent => ({
  id,
  href: id,
  calendarHref: 'c',
  uid: id,
  title: id,
  start,
  end,
  allDay,
  attendees: [],
  reminders: []
})

describe('weeks and ranges', () => {
  it('starts weeks on Monday', () => {
    // Tuesday 24 and Sunday 29 November 2026 are both in the week of Monday 23
    expect(startOfWeek(at(24, 15))).toBe(at(23, 0))
    expect(startOfWeek(at(29, 23))).toBe(at(23, 0))
  })

  it('fetches whole weeks, and six weeks for a month', () => {
    const week = viewRange('week', at(24, 9))
    expect(week.days).toHaveLength(7)
    expect(week.end).toBe(at(30, 0))
    const month = viewRange('month', at(24, 9))
    expect(month.start).toBe(new Date(2026, 9, 26).getTime())
    expect(month.days).toHaveLength(42)
  })

  it('keeps local midnight across daylight saving time', () => {
    // Europe/Stockholm-style change on 25 October: still midnight a day later
    const day = new Date(2026, 9, 25).getTime()
    expect(new Date(addDays(day, 1)).getHours()).toBe(0)
  })

  it('steps by the view', () => {
    expect(stepDate('week', at(24, 9), 1)).toBe(new Date(2026, 11, 1, 9).getTime())
    expect(new Date(stepDate('month', at(24, 9), -1)).getMonth()).toBe(9)
  })
})

describe('isoWeek', () => {
  it('numbers weeks the ISO way', () => {
    expect(isoWeek(new Date(2026, 10, 24).getTime())).toBe(48)
    // 1 January 2027 is a Friday: still week 53 of 2026
    expect(isoWeek(new Date(2027, 0, 1).getTime())).toBe(53)
    expect(isoWeek(new Date(2027, 0, 4).getTime())).toBe(1)
    // 29 December 2025 (Monday) is already week 1 of 2026
    expect(isoWeek(new Date(2025, 11, 29).getTime())).toBe(1)
  })
})

describe('layoutDay', () => {
  const day = at(24, 0)

  it('puts overlapping events side by side and others full width', () => {
    const placed = layoutDay(
      [
        ev('lunch', at(24, 12), at(24, 13)),
        ev('vendor', at(24, 12, 30), at(24, 13, 30)),
        ev('sync', at(24, 14), at(24, 15, 30))
      ],
      day
    )
    const by = Object.fromEntries(placed.map((p) => [p.event.id, p]))
    expect([by.lunch.lane, by.lunch.lanes]).toEqual([0, 2])
    expect([by.vendor.lane, by.vendor.lanes]).toEqual([1, 2])
    expect([by.sync.lane, by.sync.lanes, by.sync.top, by.sync.height]).toEqual([0, 1, 14 * 60, 90])
  })

  it('reuses a lane once it is free again', () => {
    const placed = layoutDay(
      [ev('a', at(24, 9), at(24, 12)), ev('b', at(24, 9), at(24, 10)), ev('c', at(24, 10), at(24, 11))],
      day
    )
    const by = Object.fromEntries(placed.map((p) => [p.event.id, p]))
    expect(by.c.lane).toBe(1)
    expect(by.c.lanes).toBe(2)
  })

  it('clips events that cross midnight and leaves out all-day ones', () => {
    const placed = layoutDay([ev('late', at(23, 22), at(24, 2)), ev('bday', at(24, 0), at(25, 0), true)], day)
    expect(placed.map((p) => [p.event.id, p.top, p.height])).toEqual([['late', 0, 120]])
  })

  it('knows which days an event is on', () => {
    expect(onDay(ev('bday', at(24, 0), at(25, 0), true), at(24, 0))).toBe(true)
    expect(onDay(ev('bday', at(24, 0), at(25, 0), true), at(25, 0))).toBe(false)
  })
})
