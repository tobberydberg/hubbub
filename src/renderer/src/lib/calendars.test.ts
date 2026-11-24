import { describe, expect, it } from 'vitest'
import { parseCalendars } from './calendars'

const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:x1="http://apple.com/ns/ical/">
  <d:response><d:href>/remote.php/dav/calendars/alice/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/remote.php/dav/calendars/alice/personal/</d:href>
    <d:propstat><d:prop><d:displayname>Personal</d:displayname>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <d:current-user-privilege-set><d:privilege><d:all/></d:privilege></d:current-user-privilege-set>
      <cal:supported-calendar-component-set><cal:comp name="VEVENT"/><cal:comp name="VTODO"/></cal:supported-calendar-component-set>
      <x1:calendar-color>#0082c9</x1:calendar-color></d:prop></d:propstat></d:response>
  <d:response><d:href>/remote.php/dav/calendars/alice/tasks/</d:href>
    <d:propstat><d:prop><d:displayname>Tasks</d:displayname>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <d:current-user-privilege-set><d:privilege><d:all/></d:privilege></d:current-user-privilege-set>
      <cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>
  <d:response><d:href>/remote.php/dav/calendars/alice/team_shared_by_bob/</d:href>
    <d:propstat><d:prop><d:displayname>Team &amp; friends</d:displayname>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
      <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>
</d:multistatus>`

describe('parseCalendars', () => {
  it('keeps writable event calendars', () => {
    expect(parseCalendars(xml)).toEqual([{ uri: 'personal', name: 'Personal', color: '#0082c9' }])
  })
})
