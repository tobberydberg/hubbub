import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import { parseEvents } from './caldav'
import { presetRule } from './repeat'
import {
  excludeOccurrenceIcs,
  localTimeZone,
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
