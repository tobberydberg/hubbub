import ICAL from 'ical.js'

// Invitations that arrive by mail (iMIP: an iCalendar part with METHOD:REQUEST or CANCEL), as
// Hubbub puts them into a calendar: stored as a plain event, updated when the organizer sends a
// newer version (keeping the user's answer), and marked cancelled when they call it off.

export interface MailInvitation {
  method: 'REQUEST' | 'CANCEL'
  uid: string
  sequence: number
  title: string
  /** When it (the first occurrence) starts, ms */
  start: number
  /** Who sent it, for the debug log */
  organizer?: string
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
    start: event.startDate?.toJSDate().getTime() ?? 0,
    organizer: String(master.getFirstPropertyValue('organizer') ?? '').replace(/^mailto:/i, '') || undefined,
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

/**
 * The stored event marked as cancelled, as calendars show a called-off meeting, noting the
 * cancellation's version so that only a newer invitation brings the meeting back
 */
export function cancelledInvitation(stored: string, sequence: number): string {
  const calendar = new ICAL.Component(ICAL.parse(stored))
  for (const v of calendar.getAllSubcomponents('vevent')) {
    v.updatePropertyWithValue('status', 'CANCELLED')
    v.updatePropertyWithValue(CANCEL_SEQUENCE, String(sequence))
  }
  return calendar.toString()
}

const CANCEL_SEQUENCE = 'x-hubbub-cancel-sequence'

/** Whether a stored event is cancelled, and by which version (null when Hubbub didn't note it) */
export function cancellationOf(ics: string): { cancelled: boolean; sequence: number | null } {
  try {
    const calendar = new ICAL.Component(ICAL.parse(ics))
    const events = calendar.getAllSubcomponents('vevent')
    const master = events.find((v) => !v.hasProperty('recurrence-id')) ?? events[0]
    const cancelled = String(master?.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED'
    const noted = master?.getFirstPropertyValue(CANCEL_SEQUENCE)
    return { cancelled, sequence: noted === null || noted === undefined ? null : Number(noted) }
  } catch {
    return { cancelled: false, sequence: null }
  }
}

/**
 * Whether an invitation brings a cancelled meeting back: it has to be newer than the cancellation,
 * or, when the cancellation's version wasn't noted, at least as new as the stored event
 */
export function revives(stored: string, sequence: number): boolean {
  const c = cancellationOf(stored)
  if (!c.cancelled) return false
  return c.sequence === null ? sequence >= sequenceOf(stored) : sequence > c.sequence
}

/** A file name for an imported invitation, from its UID where that is safe */
export function invitationFileName(uid: string): string {
  return /^[\w.@-]{1,120}$/.test(uid) ? `${uid}.ics` : `hubbub-${crypto.randomUUID()}.ics`
}

/**
 * The invitation with its organizer marked as scheduling it themselves (SCHEDULE-AGENT=CLIENT), or
 * without that mark. Saving an invitation as a new event makes Nextcloud tell the organizer the
 * user's answer: "needs action", which Outlook shows as accepted. Marked, Nextcloud sends nothing.
 */
export function scheduledByClient(ics: string, on: boolean): string {
  const calendar = new ICAL.Component(ICAL.parse(ics))
  for (const v of calendar.getAllSubcomponents('vevent')) {
    // The organizer's mark keeps your answers to yourself; the invitees' marks keep a meeting you
    // organize from inviting them
    for (const p of [...v.getAllProperties('organizer'), ...v.getAllProperties('attendee')]) {
      if (on) p.setParameter('schedule-agent', 'CLIENT')
      else p.removeParameter('schedule-agent')
    }
  }
  return calendar.toString()
}

const emailIn = (prop: ICAL.Property | null): string =>
  String(prop?.getFirstValue() ?? '')
    .replace(/^mailto:/i, '')
    .toLowerCase()

/** Whether you organize the meeting or are among its invitees (by any of your addresses) */
export function includesMe(ics: string, myEmails: string[]): boolean {
  const mine = new Set(myEmails.map((e) => e.toLowerCase()))
  const calendar = new ICAL.Component(ICAL.parse(ics))
  return calendar
    .getAllSubcomponents('vevent')
    .some(
      (v) =>
        mine.has(emailIn(v.getFirstProperty('organizer'))) ||
        v.getAllProperties('attendee').some((a) => mine.has(emailIn(a)))
    )
}

/**
 * The invitation with you among the invitees, unanswered, when it reached you without listing you:
 * forwarded to you, or sent to an address of yours the calendar doesn't know. Answering then reaches
 * the organizer as from someone the meeting was forwarded to, as in Outlook.
 */
export function withMe(
  ics: string,
  me: { email: string; name: string },
  myEmails: string[],
  /** Your answer so far, when an update arrives without you (forwarded to you) */
  partstat = 'NEEDS-ACTION'
): string {
  if (includesMe(ics, myEmails)) return ics
  const calendar = new ICAL.Component(ICAL.parse(ics))
  for (const v of calendar.getAllSubcomponents('vevent')) {
    const attendee = new ICAL.Property('attendee', v)
    attendee.setValue(`mailto:${me.email}`)
    if (me.name) attendee.setParameter('cn', me.name)
    attendee.setParameter('role', 'REQ-PARTICIPANT')
    attendee.setParameter('partstat', partstat)
    if (partstat === 'NEEDS-ACTION') attendee.setParameter('rsvp', 'TRUE')
    v.addProperty(attendee)
  }
  return calendar.toString()
}

/** Your answer in a stored event (its series), or undefined when you're not among the invitees */
export function myAnswerIn(ics: string, myEmails: string[]): string | undefined {
  const mine = new Set(myEmails.map((e) => e.toLowerCase()))
  const calendar = new ICAL.Component(ICAL.parse(ics))
  const events = calendar.getAllSubcomponents('vevent')
  const master = events.find((v) => !v.hasProperty('recurrence-id')) ?? events[0]
  const me = master?.getAllProperties('attendee').find((a) => mine.has(emailIn(a)))
  const partstat = me?.getParameter('partstat')
  return typeof partstat === 'string' ? partstat.toUpperCase() : undefined
}

/** Whether you organize the meeting (by any of your addresses) */
export function organizedByMe(ics: string, myEmails: string[]): boolean {
  const mine = new Set(myEmails.map((e) => e.toLowerCase()))
  try {
    const calendar = new ICAL.Component(ICAL.parse(ics))
    return calendar
      .getAllSubcomponents('vevent')
      .some((v) => mine.has(emailIn(v.getFirstProperty('organizer'))))
  } catch {
    return false
  }
}
