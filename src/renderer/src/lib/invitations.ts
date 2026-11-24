import ICAL from 'ical.js'

// Invitations that arrive by mail (iMIP: an iCalendar part with METHOD:REQUEST or CANCEL), as
// Hubbub puts them into a calendar: stored as a plain event, updated when the organizer sends a
// newer version (keeping the user's answer), and marked cancelled when they call it off.

export interface MailInvitation {
  method: 'REQUEST' | 'CANCEL'
  uid: string
  sequence: number
  title: string
  /** When the last occurrence ends (ms), so meetings that are over are left alone */
  end: number
  /** The invitation as it is stored in a calendar: without METHOD */
  ics: string
}

const emailOf = (prop: ICAL.Property): string =>
  String(prop.getFirstValue() ?? '')
    .replace(/^mailto:/i, '')
    .toLowerCase()

/** An invitation from a mail's calendar part, or null when it isn't one Hubbub handles */
export function parseMailInvitation(text: string, method: string): MailInvitation | null {
  const m = method.toUpperCase()
  if (m !== 'REQUEST' && m !== 'CANCEL') return null
  let calendar: ICAL.Component
  try {
    calendar = new ICAL.Component(ICAL.parse(text))
  } catch {
    return null
  }
  const events = calendar.getAllSubcomponents('vevent')
  const master = events.find((v) => !v.hasProperty('recurrence-id')) ?? events[0]
  const uid = master?.getFirstPropertyValue('uid')?.toString()
  if (!master || !uid) return null
  calendar.removeAllProperties('method')
  const event = new ICAL.Event(master)
  // A repeating series counts as current, whatever its first occurrence
  const end = master.hasProperty('rrule')
    ? Number.POSITIVE_INFINITY
    : ((event.endDate ?? event.startDate)?.toJSDate().getTime() ?? 0)
  return {
    method: m,
    uid,
    sequence: Number(master.getFirstPropertyValue('sequence') ?? 0),
    title: event.summary || 'Untitled event',
    end,
    ics: calendar.toString()
  }
}

/** The sequence number of a stored event */
export function sequenceOf(ics: string): number {
  try {
    const calendar = new ICAL.Component(ICAL.parse(ics))
    const events = calendar.getAllSubcomponents('vevent')
    const master = events.find((v) => !v.hasProperty('recurrence-id')) ?? events[0]
    return Number(master?.getFirstPropertyValue('sequence') ?? 0)
  } catch {
    return 0
  }
}

/** The organizer's newer version of an event, with the user's own answer kept from the stored one */
export function updatedInvitation(stored: string, incoming: string, myEmails: string[]): string {
  const mine = new Set(myEmails.map((e) => e.toLowerCase()))
  const answers = new Map<string, string>()
  const old = new ICAL.Component(ICAL.parse(stored))
  for (const v of old.getAllSubcomponents('vevent')) {
    const rid = v.getFirstPropertyValue('recurrence-id')?.toString() ?? ''
    for (const a of v.getAllProperties('attendee')) {
      const partstat = a.getParameter('partstat')
      if (mine.has(emailOf(a)) && typeof partstat === 'string') answers.set(rid, partstat)
    }
  }
  const next = new ICAL.Component(ICAL.parse(incoming))
  next.removeAllProperties('method')
  for (const v of next.getAllSubcomponents('vevent')) {
    const rid = v.getFirstPropertyValue('recurrence-id')?.toString() ?? ''
    const answer = answers.get(rid) ?? answers.get('')
    if (!answer) continue
    for (const a of v.getAllProperties('attendee'))
      if (mine.has(emailOf(a))) a.setParameter('partstat', answer)
  }
  return next.toString()
}

/** The stored event marked as cancelled, as calendars show a called-off meeting */
export function cancelledInvitation(stored: string): string {
  const calendar = new ICAL.Component(ICAL.parse(stored))
  for (const v of calendar.getAllSubcomponents('vevent')) v.updatePropertyWithValue('status', 'CANCELLED')
  return calendar.toString()
}

/** A file name for an imported invitation, from its UID where that is safe */
export function invitationFileName(uid: string): string {
  return /^[\w.@-]{1,120}$/.test(uid) ? `${uid}.ics` : `hubbub-${crypto.randomUUID()}.ics`
}
