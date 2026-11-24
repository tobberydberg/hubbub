import { describe, expect, it } from 'vitest'
import { onlineMeetingIn, parseCalendarList, parseEvents, talkTokenIn, utcStamp } from './caldav'

// Shaped like Nextcloud's responses (from a Nextcloud 31 test server)
const list = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:oc="http://owncloud.org/ns">
 <d:response><d:href>/remote.php/dav/calendars/alice/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/calendars/alice/work/</d:href><d:propstat><d:prop>
  <d:displayname>Work</d:displayname><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
  <x1:calendar-color xmlns:x1="http://apple.com/ns/ical/">#2E9E6BFF</x1:calendar-color><x1:calendar-order xmlns:x1="http://apple.com/ns/ical/">2</x1:calendar-order>
  <cs:getctag>http://sabre.io/ns/sync/7</cs:getctag><oc:owner-principal>principals/users/alice</oc:owner-principal>
  <d:current-user-privilege-set><d:privilege><d:write/></d:privilege><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
  <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
 </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/calendars/alice/personal/</d:href><d:propstat><d:prop>
  <d:displayname>Personal</d:displayname><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
  <x1:calendar-order xmlns:x1="http://apple.com/ns/ical/">1</x1:calendar-order><cs:getctag>http://sabre.io/ns/sync/3</cs:getctag>
  <oc:owner-principal>principals/users/alice</oc:owner-principal>
  <d:current-user-privilege-set><d:privilege><d:all/></d:privilege></d:current-user-privilege-set>
 </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/calendars/alice/oncall_shared_by_bob/</d:href><d:propstat><d:prop>
  <d:displayname>Team on-call (Bob Test)</d:displayname><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
  <x1:calendar-color xmlns:x1="http://apple.com/ns/ical/">#D9822B</x1:calendar-color><cs:getctag>http://sabre.io/ns/sync/1</cs:getctag>
  <oc:owner-principal>principals/users/bob</oc:owner-principal><x2:owner-displayname xmlns:x2="http://nextcloud.com/ns">Bob Test</x2:owner-displayname>
  <d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
 </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/calendars/alice/tasks/</d:href><d:propstat><d:prop>
  <d:displayname>Tasks</d:displayname><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
  <cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set>
 </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/calendars/alice/inbox/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:schedule-inbox/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`

const report = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
 <d:response><d:href>/remote.php/dav/calendars/alice/work/standup.ics</d:href><d:propstat><d:prop><cal:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:standup
SUMMARY:Daily standup
DTSTART:20261123T080000Z
DTEND:20261123T081500Z
LOCATION:https://cloud.example.com/index.php/call/txkonz23
RECURRENCE-ID:20261123T080000Z
END:VEVENT
BEGIN:VEVENT
UID:standup
SUMMARY:Daily standup
DTSTART:20261124T080000Z
DTEND:20261124T081500Z
LOCATION:https://cloud.example.com/index.php/call/txkonz23
RECURRENCE-ID:20261124T080000Z
END:VEVENT
END:VCALENDAR
</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/calendars/alice/work/review.ics</d:href><d:propstat><d:prop><cal:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:review
SUMMARY:Architecture review &amp; planning
DTSTART:20261125T133000Z
DTEND:20261125T143000Z
DESCRIPTION:Bring the diagrams\\, please.
ORGANIZER;CN=Bob Test:mailto:bob@example.test
ATTENDEE;CN=Bob Test;PARTSTAT=ACCEPTED;ROLE=CHAIR:mailto:bob@example.test
ATTENDEE;CN=Alice Test;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:Alice@Example.test
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT15M
END:VALARM
END:VEVENT
END:VCALENDAR
</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/calendars/alice/work/birthday.ics</d:href><d:propstat><d:prop><cal:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:birthday
SUMMARY:Carol's birthday
DTSTART;VALUE=DATE:20261127
DTEND;VALUE=DATE:20261128
END:VEVENT
END:VCALENDAR
</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`

const ctx = {
  calendarHref: '/remote.php/dav/calendars/alice/work/',
  serverUrl: 'https://cloud.example.com',
  myEmails: ['alice@example.test']
}

describe('parseCalendarList', () => {
  const calendars = parseCalendarList(list, 'alice')

  it('keeps event calendars, in the user’s order', () => {
    expect(calendars.map((c) => c.name)).toEqual(['Team on-call', 'Personal', 'Work'])
  })

  it('reads colors, write access, sharing and the change tag', () => {
    const [shared, personal, work] = calendars
    expect(work).toMatchObject({ color: '#2E9E6B', writable: true, ctag: 'http://sabre.io/ns/sync/7' })
    expect(personal).toMatchObject({ color: '#0082c9', writable: true, sharedBy: undefined })
    expect(shared).toMatchObject({ sharedBy: 'Bob Test', writable: false })
  })
})

describe('parseEvents', () => {
  const events = parseEvents(report, ctx)

  it('gives each occurrence of a repeating event its own entry', () => {
    const standups = events.filter((e) => e.uid === 'standup')
    expect(standups).toHaveLength(2)
    expect(new Set(standups.map((e) => e.id)).size).toBe(2)
    expect(standups[1].start).toBe(Date.UTC(2026, 10, 24, 8, 0))
    expect(standups[1].end - standups[1].start).toBe(15 * 60_000)
    expect(standups[0].recurrenceId).toBeTruthy()
  })

  it('finds the Talk conversation of the event', () => {
    expect(events[0].talkToken).toBe('txkonz23')
    expect(events.find((e) => e.uid === 'review')?.talkToken).toBeUndefined()
  })

  it('reads invitations: organizer, attendees and the user’s own answer', () => {
    const review = events.find((e) => e.uid === 'review')!
    expect(review.title).toBe('Architecture review & planning')
    expect(review.description).toBe('Bring the diagrams, please.')
    expect(review.organizer).toMatchObject({ name: 'Bob Test', isMe: false })
    expect(review.attendees.map((a) => [a.name, a.answer, a.isMe])).toEqual([
      ['Bob Test', 'ACCEPTED', false],
      ['Alice Test', 'NEEDS-ACTION', true]
    ])
    expect(review.myAnswer).toBe('NEEDS-ACTION')
    expect(review.reminders).toEqual([15])
  })

  it('reads event data with the line endings encoded, as Nextcloud sends it', () => {
    const encoded = report.replace(/\n(?=[A-Z ])/g, '&#13;\n')
    expect(parseEvents(encoded, ctx).map((e) => e.uid)).toEqual(events.map((e) => e.uid))
  })

  it('keeps all-day events on their local day', () => {
    const birthday = events.find((e) => e.uid === 'birthday')!
    expect(birthday.allDay).toBe(true)
    expect(birthday.start).toBe(new Date(2026, 10, 27).getTime())
    expect(birthday.end).toBe(new Date(2026, 10, 28).getTime())
  })
})

describe('helpers', () => {
  it('only takes Talk links to the same server', () => {
    expect(talkTokenIn('Join: https://cloud.example.com/call/abc123', 'https://cloud.example.com/')).toBe(
      'abc123'
    )
    expect(
      talkTokenIn('https://other.example.com/index.php/call/abc123', 'https://cloud.example.com')
    ).toBeUndefined()
  })

  it('finds the link to join a Teams, Zoom or Meet meeting', () => {
    expect(
      onlineMeetingIn(
        undefined,
        'Microsoft Teams Meeting',
        'Join: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0.'
      )
    ).toEqual({
      url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0',
      service: 'Microsoft Teams'
    })
    expect(onlineMeetingIn('https://us02web.zoom.us/j/123456?pwd=x')?.service).toBe('Zoom')
    expect(onlineMeetingIn('meet.google.com/abc', 'https://meet.google.com/abc-defg-hij')?.url).toBe(
      'https://meet.google.com/abc-defg-hij'
    )
    expect(onlineMeetingIn('Room 3', 'https://example.com')).toBeUndefined()
  })

  it('writes CalDAV time stamps', () => {
    expect(utcStamp(Date.UTC(2026, 10, 24, 13, 5, 9))).toBe('20261124T130509Z')
  })
})
