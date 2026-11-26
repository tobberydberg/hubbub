import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import { parseEvents } from './caldav'
import { presetRule } from './repeat'
import {
  excludeOccurrenceIcs,
  localTimeZone,
  optionsOf,
  newEventIcs,
  parseStored,
  repeatOf,
  setAnswerIcs,
  updateEventIcs,
  type EventDraft
} from './ical-edit'

const at = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime()
const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  title: 'Design review',
  start: at(26, 14),
  end: at(26, 15),
  allDay: false,
  location: '',
  description: '',
  reminder: null,
  repeat: null,
  attendees: [],
  ...over
})
const me = { name: 'Alice Test', email: 'alice@example.test' }

/** As the server would return it: the event in a REPORT response, parsed the way the calendar does */
function read(ics: string) {
  const xml = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/x.ics</d:href><d:propstat><d:prop><c:calendar-data>${ics
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`
  return parseEvents(xml, {
    calendarHref: '/c/',
    serverUrl: 'https://cloud.example.com',
    myEmails: [me.email]
  })
}

describe('newEventIcs', () => {
  it('writes times in the user’s time zone and reads back the same', () => {
    const ics = newEventIcs(draft({ reminder: 10, location: 'Room 3' }), 'uid-1', null)
    expect(ics).toContain(`DTSTART;TZID=${localTimeZone()}:20261126T140000`)
    const [event] = read(ics)
    expect(event).toMatchObject({
      title: 'Design review',
      start: at(26, 14),
      end: at(26, 15),
      location: 'Room 3',
      reminders: [10]
    })
    expect(event.organizer).toBeUndefined()
  })

  it('writes all-day events as dates', () => {
    const ics = newEventIcs(draft({ allDay: true, start: at(27, 0), end: at(28, 0) }), 'uid-2', null)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261127')
    expect(read(ics)[0]).toMatchObject({ allDay: true, start: at(27, 0), end: at(28, 0) })
  })

  it('invites people, with the organizer as an attendee who said yes', () => {
    const ics = newEventIcs(
      draft({ attendees: [{ name: 'Bob Test', email: 'bob@example.test' }] }),
      'uid-3',
      me
    )
    const [event] = read(ics)
    expect(event.organizer).toMatchObject({ email: me.email, isMe: true })
    expect(event.attendees.map((a) => [a.email, a.answer])).toEqual([
      [me.email, 'ACCEPTED'],
      ['bob@example.test', 'NEEDS-ACTION']
    ])
  })

  it('writes repeat rules and reads them back', () => {
    const rule = { ...presetRule('weekdays', at(26, 14)), end: 'count' as const, count: 4 }
    const ics = newEventIcs(draft({ repeat: rule }), 'uid-4', null)
    // ical.js orders the parts its own way
    const rrule = ics.split('\r\n').find((l) => l.startsWith('RRULE:')) ?? ''
    expect(rrule.split(/[:;]/).slice(1).sort()).toEqual(['BYDAY=MO,TU,WE,TH,FR', 'COUNT=4', 'FREQ=WEEKLY'])
    expect(repeatOf(parseStored(ics).master)).toMatchObject({ freq: 'WEEKLY', end: 'count', count: 4 })
  })

  it('keeps a rule the dialog can’t show', () => {
    const ics = newEventIcs(draft(), 'uid-4b', null).replace(
      'END:VEVENT',
      'RRULE:FREQ=HOURLY;INTERVAL=6\r\nEND:VEVENT'
    )
    expect(repeatOf(parseStored(ics).master)).toBe('keep')
    expect(updateEventIcs(ics, draft({ repeat: 'keep' }), null)).toContain('RRULE:FREQ=HOURLY;INTERVAL=6')
  })
})

describe('scheduling mark', () => {
  it('editing takes off the mark that kept an imported meeting from inviting everyone', () => {
    const imported = newEventIcs(
      draft({ attendees: [{ name: 'Bob', email: 'bob@example.test' }] }),
      'uid-m1',
      me
    )
      .replace('ORGANIZER;', 'ORGANIZER;SCHEDULE-AGENT=CLIENT;')
      .replace(/ATTENDEE;/g, 'ATTENDEE;SCHEDULE-AGENT=CLIENT;')
    expect(imported).toContain('SCHEDULE-AGENT=CLIENT')
    const edited = updateEventIcs(
      imported,
      draft({ title: 'Changed', attendees: [{ name: 'Bob', email: 'bob@example.test' }] }),
      me
    )
    expect(edited).not.toContain('SCHEDULE-AGENT')
  })
})

describe('invitation options', () => {
  it('writes Outlook’s options only when something is not allowed', () => {
    const open = newEventIcs(draft({ forwarding: true, proposals: true }), 'uid-o1', null)
    expect(open).not.toContain('X-MICROSOFT')
    const closed = newEventIcs(draft({ forwarding: false, proposals: false }), 'uid-o2', null)
    expect(closed).toContain('X-MICROSOFT-DONOTFORWARDMEETING:TRUE')
    expect(closed).toContain('X-MICROSOFT-DISALLOW-COUNTER:TRUE')
    expect(optionsOf(parseStored(closed).master)).toEqual({ forwarding: false, proposals: false })
  })

  it('keeps what is stored unless the draft says otherwise', () => {
    const closed = newEventIcs(draft({ forwarding: false }), 'uid-o3', null)
    const kept = updateEventIcs(closed, draft({ title: 'Renamed' }), null)
    expect(optionsOf(parseStored(kept).master).forwarding).toBe(false)
    const reopened = updateEventIcs(closed, draft({ forwarding: true }), null)
    expect(optionsOf(parseStored(reopened).master).forwarding).toBe(true)
  })
})

describe('updateEventIcs', () => {
  it('keeps the answers of people already invited and bumps the sequence', () => {
    const bob = { name: 'Bob Test', email: 'bob@example.test' }
    let ics = newEventIcs(draft({ attendees: [bob] }), 'uid-5', me)
    ics = ics.replace('PARTSTAT=NEEDS-ACTION', 'PARTSTAT=ACCEPTED')
    const carol = { name: 'Carol Test', email: 'carol@example.test' }
    const updated = updateEventIcs(ics, draft({ title: 'Design review v2', attendees: [bob, carol] }), me)
    const [event] = read(updated)
    expect(event.title).toBe('Design review v2')
    expect(event.attendees.map((a) => [a.email, a.answer])).toEqual([
      [me.email, 'ACCEPTED'],
      ['bob@example.test', 'ACCEPTED'],
      ['carol@example.test', 'NEEDS-ACTION']
    ])
    expect(parseStored(updated).master.getFirstPropertyValue('sequence')).toBe(1)
  })

  it('keeps things Hubbub doesn’t edit', () => {
    const ics = newEventIcs(draft(), 'uid-6', null).replace('END:VEVENT', 'X-OTHER-APP:keep me\r\nEND:VEVENT')
    expect(updateEventIcs(ics, draft({ title: 'New' }), null)).toContain('X-OTHER-APP:keep me')
  })

  it('moves a repeating series by as much as the edited occurrence moved', () => {
    const ics = newEventIcs(
      draft({ start: at(2, 9), end: at(2, 10), repeat: presetRule('weekly', at(2, 9)) }),
      'uid-7',
      null
    )
    // The occurrence on the 23rd moved an hour later
    const updated = updateEventIcs(
      ics,
      draft({ start: at(23, 10), end: at(23, 11), repeat: 'keep' }),
      null,
      at(23, 9)
    )
    const start = new ICAL.Event(parseStored(updated).master).startDate
    expect([start.day, start.hour]).toEqual([2, 10])
  })
})

describe('answers and occurrences', () => {
  const invite = newEventIcs(
    draft({ attendees: [{ name: 'Alice Test', email: 'Alice@Example.test' }] }),
    'uid-8',
    { name: 'Bob Test', email: 'bob@example.test' }
  )

  it('sets the user’s own answer', () => {
    const [event] = read(setAnswerIcs(invite, [me.email], 'TENTATIVE'))
    expect(event.myAnswer).toBe('TENTATIVE')
  })

  it('refuses to answer for someone not invited', () => {
    expect(() => setAnswerIcs(invite, ['carol@example.test'], 'ACCEPTED')).toThrow()
  })

  describe('one occurrence of a series', () => {
    const series = newEventIcs(
      draft({
        start: at(2, 9),
        end: at(2, 10),
        repeat: presetRule('weekly', at(2, 9)),
        attendees: [{ name: 'Alice Test', email: 'alice@example.test' }]
      }),
      'uid-10',
      { name: 'Bob Test', email: 'bob@example.test' }
    )
    const occurrence = ICAL.Time.fromJSDate(new Date(at(9, 9)), true).toString()
    const answers = (ics: string) =>
      parseStored(ics)
        .calendar.getAllSubcomponents('vevent')
        .map((v) => ({
          rid: v.getFirstProperty('recurrence-id')?.toICALString() ?? null,
          start: v.getFirstProperty('dtstart')?.toICALString(),
          partstat: v
            .getAllProperties('attendee')
            .find((a) => String(a.getFirstValue()).includes('alice'))
            ?.getParameter('partstat')
        }))

    it('answers only that one, as an exception written in the series’ zone', () => {
      const out = answers(setAnswerIcs(series, [me.email], 'DECLINED', occurrence))
      const tz = localTimeZone()
      expect(out).toEqual([
        { rid: null, start: `DTSTART;TZID=${tz}:20261102T090000`, partstat: 'NEEDS-ACTION' },
        {
          rid: `RECURRENCE-ID;TZID=${tz}:20261109T090000`,
          start: `DTSTART;TZID=${tz}:20261109T090000`,
          partstat: 'DECLINED'
        }
      ])
    })

    it('changes an exception that is already there instead of adding one', () => {
      const once = setAnswerIcs(series, [me.email], 'DECLINED', occurrence)
      const out = answers(setAnswerIcs(once, [me.email], 'ACCEPTED', occurrence))
      expect(out.map((o) => o.partstat)).toEqual(['NEEDS-ACTION', 'ACCEPTED'])
    })

    it('answers every occurrence, exceptions too, without one', () => {
      const once = setAnswerIcs(series, [me.email], 'DECLINED', occurrence)
      const out = answers(setAnswerIcs(once, [me.email], 'ACCEPTED'))
      expect(out.map((o) => o.partstat)).toEqual(['ACCEPTED', 'ACCEPTED'])
    })

    it('uses the time zone the invitation defines (Outlook’s names)', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VTIMEZONE',
        'TZID:W. Europe Standard Time',
        'BEGIN:STANDARD',
        'DTSTART:16010101T030000',
        'TZOFFSETFROM:+0200',
        'TZOFFSETTO:+0100',
        'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
        'END:STANDARD',
        'BEGIN:DAYLIGHT',
        'DTSTART:16010101T020000',
        'TZOFFSETFROM:+0100',
        'TZOFFSETTO:+0200',
        'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
        'END:DAYLIGHT',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'UID:teams-1',
        'DTSTART;TZID=W. Europe Standard Time:20261102T090000',
        'DTEND;TZID=W. Europe Standard Time:20261102T093000',
        'RRULE:FREQ=WEEKLY',
        'SUMMARY:Standup',
        'ORGANIZER:mailto:boss@corp.example',
        'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:alice@example.test',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n')
      const out = answers(setAnswerIcs(ics, [me.email], 'TENTATIVE', '2026-11-09T08:00:00Z'))
      expect(out[1]).toEqual({
        rid: 'RECURRENCE-ID;TZID=W. Europe Standard Time:20261109T090000',
        start: 'DTSTART;TZID=W. Europe Standard Time:20261109T090000',
        partstat: 'TENTATIVE'
      })
    })
  })

  it('leaves out one occurrence', () => {
    const ics = newEventIcs(
      draft({ start: at(2, 9), end: at(2, 10), repeat: presetRule('weekly', at(2, 9)) }),
      'uid-9',
      null
    )
    const out = excludeOccurrenceIcs(ics, ICAL.Time.fromJSDate(new Date(at(9, 9)), true).toString())
    expect(parseStored(out).master.getAllProperties('exdate')).toHaveLength(1)
  })
})
