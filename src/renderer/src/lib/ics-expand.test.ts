import { describe, expect, it } from 'vitest'
import { expandCalendar, parseCalendarObjects } from './ics-expand'

// Shaped like Google's secret address: one file, its zone defined, repeats with exceptions
const feed = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
X-WR-CALNAME:Private
X-APPLE-CALENDAR-COLOR:#B64FC8FF
BEGIN:VTIMEZONE
TZID:Europe/Stockholm
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:dentist
DTSTART;TZID=Europe/Stockholm:20261127T163000
DTEND;TZID=Europe/Stockholm:20261127T171500
SUMMARY:Dentist
END:VEVENT
BEGIN:VEVENT
UID:run
DTSTART;TZID=Europe/Stockholm:20261120T070000
DTEND;TZID=Europe/Stockholm:20261120T080000
RRULE:FREQ=DAILY;COUNT=30
EXDATE;TZID=Europe/Stockholm:20261129T070000
SUMMARY:Morning run
END:VEVENT
BEGIN:VEVENT
UID:run
RECURRENCE-ID;TZID=Europe/Stockholm:20261128T070000
DTSTART;TZID=Europe/Stockholm:20261128T060000
DTEND;TZID=Europe/Stockholm:20261128T063000
SUMMARY:Morning run (short)
END:VEVENT
BEGIN:VEVENT
UID:birthday
DTSTART;VALUE=DATE:20261128
DTEND;VALUE=DATE:20261129
SUMMARY:Mum's birthday
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
UID:cancelled
DTSTART:20261127T100000Z
DTEND:20261127T110000Z
STATUS:CANCELLED
SUMMARY:Called off
END:VEVENT
END:VCALENDAR`

const ctx = { calendarHref: 'ext:abc:feed', serverUrl: 'https://cloud.example.com', myEmails: [] }
const utc = (s: string): number => Date.parse(s)

describe('expandCalendar', () => {
  const parsed = parseCalendarObjects([{ href: 'feed', ics: feed }])
  const range = expandCalendar(parsed, utc('2026-11-27T00:00:00Z'), utc('2026-11-30T00:00:00Z'), ctx)

  it('reads the calendar’s own name and color', () => {
    expect(parsed.name).toBe('Private')
    expect(parsed.color).toBe('#B64FC8')
  })

  it('places times in the zone the calendar defines', () => {
    const dentist = range.find((e) => e.uid === 'dentist')!
    expect(dentist.start).toBe(utc('2026-11-27T15:30:00Z'))
    expect(dentist.end).toBe(utc('2026-11-27T16:15:00Z'))
    expect(dentist.calendarHref).toBe('ext:abc:feed')
  })

  it('expands repeats, leaves out skipped dates and takes changed occurrences', () => {
    const runs = range.filter((e) => e.uid === 'run').map((e) => [e.title, new Date(e.start).toISOString()])
    expect(runs).toEqual([
      ['Morning run', '2026-11-27T06:00:00.000Z'],
      ['Morning run (short)', '2026-11-28T05:00:00.000Z']
    ])
    // Each occurrence has an id of its own
    expect(new Set(range.map((e) => e.id)).size).toBe(range.length)
  })

  it('keeps all-day and free events, and leaves out cancelled ones', () => {
    const birthday = range.find((e) => e.uid === 'birthday')!
    expect(birthday).toMatchObject({ allDay: true, free: true })
    expect(range.some((e) => e.uid === 'cancelled')).toBe(false)
  })

  it('gives only what overlaps the range', () => {
    const one = expandCalendar(parsed, utc('2026-12-18T00:00:00Z'), utc('2026-12-25T00:00:00Z'), ctx)
    // The 30 runs end on 19 December
    expect(one.map((e) => new Date(e.start).toISOString().slice(0, 10))).toEqual(['2026-12-18', '2026-12-19'])
  })

  it('looks up a zone the calendar only names', () => {
    const bare = parseCalendarObjects([
      {
        href: 'x.ics',
        ics: `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:ny
DTSTART;TZID=America/New_York:20260702T090000
DTEND;TZID=America/New_York:20260702T100000
SUMMARY:Call with New York
END:VEVENT
END:VCALENDAR`
      }
    ])
    const [call] = expandCalendar(bare, utc('2026-07-01T00:00:00Z'), utc('2026-07-04T00:00:00Z'), ctx)
    expect(call.start).toBe(utc('2026-07-02T13:00:00Z'))
  })

  it('reads CalDAV calendars object by object', () => {
    const objects = feed
      .split(/(?=BEGIN:VEVENT)/)
      .slice(1)
      .map((v, i) => ({
        href: `/cal/${i}.ics`,
        ics: `BEGIN:VCALENDAR\nVERSION:2.0\n${v.replace(/END:VCALENDAR$/, '')}END:VCALENDAR`
      }))
    const events = expandCalendar(
      parseCalendarObjects(objects),
      utc('2026-11-27T00:00:00Z'),
      utc('2026-11-30T00:00:00Z'),
      ctx
    )
    expect(events.map((e) => e.title)).toEqual(range.map((e) => e.title))
  })
})
