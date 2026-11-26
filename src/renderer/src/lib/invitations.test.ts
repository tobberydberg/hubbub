import { describe, expect, it } from 'vitest'
import { parseEvents } from './caldav'
import {
  cancelledInvitation,
  cancellationOf,
  revives,
  scheduledByClient,
  includesMe,
  withMe,
  invitationFileName,
  parseMailInvitation,
  sequenceOf,
  updatedInvitation
} from './invitations'

// Shaped like an invitation from Microsoft Exchange / Teams
const teams = (sequence: number, start = '20261127T100000', partstat = 'NEEDS-ACTION'): string =>
  [
    'BEGIN:VCALENDAR',
    'METHOD:REQUEST',
    'PRODID:Microsoft Exchange Server 2010',
    'VERSION:2.0',
    'BEGIN:VTIMEZONE',
    'TZID:W. Europe Standard Time',
    'BEGIN:STANDARD',
    'DTSTART:16010101T030000',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:16010101T020000',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'ORGANIZER;CN=Erik Partner:mailto:erik@partner.example',
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=${partstat};RSVP=TRUE;CN=Alice Test:mailto:alice@example.test`,
    'UID:040000008200E00074C5B7101A82E008ABC',
    'SUMMARY:Integration kick-off',
    `DTSTART;TZID=W. Europe Standard Time:${start}`,
    `DTEND;TZID=W. Europe Standard Time:${start.replace('T10', 'T11')}`,
    `SEQUENCE:${sequence}`,
    'X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')

const read = (ics: string, myEmails = ['alice@example.test']) =>
  parseEvents(
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/x.ics</d:href><d:propstat><d:prop><c:calendar-data>${ics
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`,
    { calendarHref: '/c/', serverUrl: 'https://cloud.example.com', myEmails }
  )

describe('mail invitations', () => {
  it('reads an invitation and stores it without METHOD', () => {
    const inv = parseMailInvitation(teams(0), 'REQUEST')!
    expect(inv).toMatchObject({ method: 'REQUEST', uid: '040000008200E00074C5B7101A82E008ABC', sequence: 0 })
    expect(inv.ics).not.toContain('METHOD:')
    const [event] = read(inv.ics)
    expect(event.myAnswer).toBe('NEEDS-ACTION')
    expect(event.onlineMeeting?.service).toBe('Microsoft Teams')
    expect(inv.end).toBeGreaterThan(Date.UTC(2026, 10, 27))
  })

  it('ignores replies and anything that isn’t an event', () => {
    expect(parseMailInvitation(teams(0), 'REPLY')).toBeNull()
    expect(parseMailInvitation('not a calendar', 'REQUEST')).toBeNull()
  })

  it('takes the organizer’s update and keeps the user’s answer', () => {
    const stored = parseMailInvitation(teams(0, '20261127T100000', 'ACCEPTED'), 'REQUEST')!.ics
    const update = teams(1, '20261127T140000')
    const merged = updatedInvitation(stored, update, ['Alice@example.test'])
    expect(sequenceOf(merged)).toBe(1)
    expect(merged).toContain('T140000')
    expect(read(merged)[0].myAnswer).toBe('ACCEPTED')
  })

  it('marks a cancelled meeting', () => {
    const stored = parseMailInvitation(teams(0), 'REQUEST')!.ics
    expect(read(cancelledInvitation(stored, 1))[0].status).toBe('CANCELLED')
  })

  it('brings a meeting back only with an invitation newer than the cancellation', () => {
    const stored = parseMailInvitation(teams(3), 'REQUEST')!.ics
    const cancelled = cancelledInvitation(stored, 3)
    expect(cancellationOf(cancelled)).toEqual({ cancelled: true, sequence: 3 })
    expect(revives(cancelled, 3)).toBe(false)
    expect(revives(cancelled, 4)).toBe(true)
    expect(revives(stored, 5)).toBe(false)
  })

  it('brings back a meeting an older cancellation was applied to (before versions were noted)', () => {
    const stored = parseMailInvitation(teams(3), 'REQUEST')!.ics
    const legacy = stored.replace('BEGIN:VEVENT', 'BEGIN:VEVENT\r\nSTATUS:CANCELLED')
    expect(cancellationOf(legacy)).toEqual({ cancelled: true, sequence: null })
    expect(revives(legacy, 3)).toBe(true)
    expect(revives(legacy, 2)).toBe(false)
  })

  it('marks the organizer as scheduling the meeting, and takes the mark off again', () => {
    const stored = parseMailInvitation(teams(0), 'REQUEST')!.ics
    const marked = scheduledByClient(stored, true)
    expect(marked).toMatch(/ORGANIZER[^:]*SCHEDULE-AGENT=CLIENT/)
    expect(marked).toMatch(/ATTENDEE[^:]*SCHEDULE-AGENT=CLIENT/)
    const clean = scheduledByClient(marked, false)
    expect(clean).not.toContain('SCHEDULE-AGENT')
    expect(read(clean)[0].myAnswer).toBe('NEEDS-ACTION')
  })

  it('adds you to an invitation that doesn’t list you, unanswered', () => {
    const stored = parseMailInvitation(teams(0), 'REQUEST')!.ics
    const me = { email: 'tobias@example.test', name: 'Tobias' }
    expect(includesMe(stored, ['alice@example.test'])).toBe(true)
    expect(withMe(stored, me, ['alice@example.test'])).toBe(stored)
    const forwarded = withMe(stored, me, ['tobias@example.test'])
    expect(includesMe(forwarded, ['tobias@example.test'])).toBe(true)
    const [event] = read(forwarded, ['tobias@example.test'])
    expect(event.myAnswer).toBe('NEEDS-ACTION')
  })

  it('names files after safe UIDs only', () => {
    expect(invitationFileName('040000008200E008ABC')).toBe('040000008200E008ABC.ics')
    expect(invitationFileName('../evil/uid')).toMatch(/^hubbub-[\w-]+\.ics$/)
  })
})
