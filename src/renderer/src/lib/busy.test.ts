import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from './caldav'
import { busyIcs, busyPrefix, busySourceOf, planBusy, wantedBlocks } from './busy'

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: over.uid ?? 'x',
  href: 'feed',
  calendarHref: 'ext:src1:feed',
  uid: 'x',
  title: 'Dentist',
  start: Date.parse('2026-11-27T15:30:00Z'),
  end: Date.parse('2026-11-27T16:15:00Z'),
  allDay: false,
  attendees: [],
  reminders: [],
  ...over
})

describe('busy time', () => {
  it('copies busy events only, all-day ones when asked', () => {
    const events = [
      event({ uid: 'dentist' }),
      event({ uid: 'free', free: true }),
      event({ uid: 'cancelled', status: 'CANCELLED' }),
      event({ uid: 'holiday', allDay: true })
    ]
    expect(wantedBlocks('src1', events, false)).toHaveLength(1)
    expect(wantedBlocks('src1', events, true)).toHaveLength(2)
  })

  it('gives each occurrence the same UID every time, apart from other sources', () => {
    const run = (day: string): CalendarEvent => event({ uid: 'run', recurrenceId: `2026-11-${day}T07:00:00` })
    const [a] = wantedBlocks('src1', [run('27')], false)
    const [b] = wantedBlocks('src1', [run('27')], false)
    const [c] = wantedBlocks('src1', [run('28')], false)
    const [d] = wantedBlocks('src2', [run('27')], false)
    expect(a.uid).toBe(b.uid)
    expect(a.uid).not.toBe(c.uid)
    expect(d.uid.startsWith(busyPrefix('src2'))).toBe(true)
    expect(busySourceOf(a.uid)).toBe('src1')
    expect(busySourceOf('some-other-event')).toBeNull()
  })

  it('plans creating, moving and removing copies', () => {
    const [keep, moved, added] = wantedBlocks(
      'src1',
      [event({ uid: 'keep' }), event({ uid: 'moved' }), event({ uid: 'added' })],
      false
    )
    const plan = planBusy(
      [keep, { ...moved, start: moved.start + 3_600_000, end: moved.end + 3_600_000 }, added],
      [
        { ...keep, href: '/k.ics' },
        { ...moved, href: '/m.ics' },
        { uid: `${busyPrefix('src1')}gone`, start: 0, end: 1, allDay: false, href: '/g.ics' }
      ]
    )
    expect(plan.create.map((b) => b.uid)).toEqual([added.uid])
    expect(plan.update.map((u) => u.href)).toEqual(['/m.ics'])
    expect(plan.remove.map((r) => r.href)).toEqual(['/g.ics'])
  })

  it('writes copies with nothing but the time and the title', () => {
    const [block] = wantedBlocks('src1', [event({ uid: 'dentist', location: 'Sveavägen 1' })], false)
    const ics = busyIcs(block, 'Busy')
    const vevent = new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent')!
    const e = new ICAL.Event(vevent)
    expect(e.summary).toBe('Busy')
    expect(e.uid).toBe(block.uid)
    expect(e.startDate.toJSDate().getTime()).toBe(block.start)
    expect(vevent.getAllProperties('attendee')).toHaveLength(0)
    expect(ics).not.toContain('Dentist')
    expect(ics).not.toContain('Sveav')
  })
})
