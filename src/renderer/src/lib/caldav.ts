import ICAL from 'ical.js'
import { decode, element, text } from './calendars'

// The user's Nextcloud calendars and their events, from CalDAV: the same calendars Nextcloud
// Calendar shows. Events come from a REPORT with the server expanding repeating events, so each
// occurrence arrives as its own VEVENT, in UTC, with a RECURRENCE-ID.

export const DEFAULT_COLOR = '#0082c9'

export interface CalendarInfo {
  /** Path of the calendar collection, e.g. /remote.php/dav/calendars/alice/work/ */
  href: string
  name: string
  color: string
  order: number
  writable: boolean
  /** Shared with the user by someone else; their name */
  sharedBy?: string
  /** Changes whenever an event in the calendar changes */
  ctag: string
  /** A calendar link Nextcloud fetches (a subscription in Nextcloud Calendar): read-only */
  subscription?: boolean
  /** A calendar Hubbub reads itself (a link, iCloud), not in Nextcloud: read-only */
  source?: { id: string; name: string }
}

export type Answer = 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'NEEDS-ACTION' | 'DELEGATED'

export interface EventPerson {
  name: string
  email?: string
  answer?: Answer
  isMe: boolean
}

export interface CalendarEvent {
  /** Unique per occurrence: object path and recurrence id */
  id: string
  /** Path of the event's .ics */
  href: string
  calendarHref: string
  uid: string
  /** Set on occurrences of repeating events */
  recurrenceId?: string
  title: string
  /** Milliseconds; all-day events start and end at local midnight */
  start: number
  end: number
  allDay: boolean
  location?: string
  description?: string
  status?: string
  organizer?: EventPerson
  attendees: EventPerson[]
  /** The user's answer when invited by someone else */
  myAnswer?: Answer
  /** Reminders, in minutes before the start */
  reminders: number[]
  /** Shown as free (TRANSP:TRANSPARENT): doesn't block the time */
  free?: boolean
  /** The Talk conversation the event links to, on the same server */
  talkToken?: string
  /** A meeting elsewhere: Microsoft Teams, Zoom, Google Meet or Webex */
  onlineMeeting?: OnlineMeeting
}

export interface OnlineMeeting {
  url: string
  /** "Microsoft Teams", "Zoom", … */
  service: string
}

const MEETING_SERVICES: [RegExp, string][] = [
  [/https:\/\/teams\.(?:microsoft|live)\.com\/[^\s<>"]+/i, 'Microsoft Teams'],
  [/https:\/\/[\w.-]*zoom\.us\/(?:j|my|w)\/[^\s<>"]+/i, 'Zoom'],
  [/https:\/\/meet\.google\.com\/[a-z0-9-]+/i, 'Google Meet'],
  [/https:\/\/[\w.-]+\.webex\.com\/[^\s<>"]+/i, 'Webex']
]

/** The link to join a Teams, Zoom, Meet or Webex meeting, from the event's own fields */
export function onlineMeetingIn(...texts: (string | undefined)[]): OnlineMeeting | undefined {
  for (const text of texts) {
    if (!text) continue
    for (const [pattern, service] of MEETING_SERVICES) {
      const url = pattern.exec(text)?.[0]?.replace(/[.,;:!?)\]'>]+$/, '')
      if (url) return { url, service }
    }
  }
  return undefined
}

/** Calendars that hold events, in the order the user arranged them in Nextcloud. */
export function parseCalendarList(xml: string, userId: string): CalendarInfo[] {
  const calendars: CalendarInfo[] = []
  for (const response of element('response', xml)) {
    const types = text('resourcetype', response)
    const subscription = element('subscribed', types).length > 0
    if (!element('calendar', types).length && !subscription) continue
    const components = element('comp', response).map((c) => /name="([^"]+)"/.exec(c)?.[1])
    if (components.length && !components.includes('VEVENT')) continue
    const href = decode(text('href', response))
    const privileges = text('current-user-privilege-set', response)
    const owner = decode(text('owner-principal', response))
    const ownerName = decode(text('owner-displayname', response))
    const shared = !!owner && owner.replace(/\/+$/, '').split('/').pop() !== userId
    let name =
      decode(text('displayname', response)) ||
      decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() ?? '')
    // Nextcloud names shared calendars "Name (Owner)"
    if (shared && ownerName && name.endsWith(` (${ownerName})`)) name = name.slice(0, -ownerName.length - 3)
    calendars.push({
      href,
      name,
      color: text('calendar-color', response).slice(0, 7) || DEFAULT_COLOR,
      order: Number(text('calendar-order', response)) || 0,
      // The privilege itself: write-properties (all the birthday calendar allows) is no write access
      writable: !subscription && /<(?:[\w-]+:)?(?:write|write-content|all)\s*\/?>/.test(privileges),
      sharedBy: shared ? ownerName || owner : undefined,
      ctag: text('getctag', response) || text('sync-token', response),
      ...(subscription ? { subscription } : {})
    })
  }
  return calendars.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

const mailto = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.replace(/^mailto:/i, '').toLowerCase() || undefined : undefined

/** The Talk conversation token in a link to this server, e.g. https://cloud/index.php/call/abc123 */
export function talkTokenIn(value: string | undefined, serverUrl: string): string | undefined {
  if (!value) return undefined
  let base: URL
  try {
    base = new URL(serverUrl.replace(/\/*$/, '/'))
  } catch {
    return undefined
  }
  for (const [link] of value.matchAll(/https?:\/\/[^\s<>"]+/gi)) {
    let url: URL
    try {
      // Without punctuation that ends the sentence around it
      url = new URL(link.replace(/[.,;:!?)\]'>]+$/, ''))
    } catch {
      continue
    }
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) continue
    const rest = url.pathname.slice(base.pathname.length)
    const token = /^(?:index\.php\/)?call\/([a-z0-9]{4,30})\/?$/i.exec(rest)?.[1]
    if (token) return token
  }
  return undefined
}

export interface ParseContext {
  calendarHref: string
  serverUrl: string
  /** The user's email addresses, to find them among attendees */
  myEmails: string[]
}

/** The events in a calendar-query REPORT response. */
export function parseEvents(xml: string, ctx: ParseContext): CalendarEvent[] {
  const events: CalendarEvent[] = []
  for (const response of element('response', xml)) {
    const href = decode(text('href', response))
    const data = decode(text('calendar-data', response).replace(/^<!\[CDATA\[|\]\]>$/g, ''))
    if (!data.includes('BEGIN:VCALENDAR')) continue
    let calendar: ICAL.Component
    try {
      calendar = new ICAL.Component(ICAL.parse(data))
    } catch {
      continue
    }
    for (const vevent of calendar.getAllSubcomponents('vevent')) {
      const event = new ICAL.Event(vevent)
      const startTime = event.startDate
      if (!startTime) continue
      const allDay = startTime.isDate
      const start = startTime.toJSDate().getTime()
      const endTime = event.endDate
      const end = endTime ? endTime.toJSDate().getTime() : start + (allDay ? 86_400_000 : 0)
      const recurrenceId = vevent.getFirstPropertyValue('recurrence-id')?.toString()
      events.push(eventFrom(vevent, { start, end, allDay, recurrenceId }, href, ctx))
    }
  }
  return events
}

/** One occurrence of an event, as Hubbub shows it */
export function eventFrom(
  vevent: ICAL.Component,
  occurrence: { start: number; end: number; allDay: boolean; recurrenceId?: string },
  href: string,
  ctx: ParseContext
): CalendarEvent {
  const { start, end, allDay, recurrenceId } = occurrence
  const event = new ICAL.Event(vevent)
  const mine = new Set(ctx.myEmails.map((e) => e.toLowerCase()))
  const person = (prop: ICAL.Property): EventPerson => {
    const email = mailto(prop.getFirstValue())
    const answer = prop.getParameter('partstat')
    return {
      name: String(prop.getParameter('cn') ?? email ?? ''),
      email,
      answer: typeof answer === 'string' ? (answer.toUpperCase() as Answer) : undefined,
      isMe: !!email && mine.has(email)
    }
  }
  const organizerProp = vevent.getFirstProperty('organizer')
  const organizer = organizerProp ? person(organizerProp) : undefined
  const attendees = vevent.getAllProperties('attendee').map(person)
  // You can be among the invitees twice: at an alias, and at your main address, added when the
  // invitation came to an alias your calendar didn't know yet. The answer you gave counts.
  const asMe = attendees.filter((a) => a.isMe)
  const me = asMe.find((a) => a.answer && a.answer !== 'NEEDS-ACTION') ?? asMe[0]

  const reminders: number[] = []
  for (const alarm of vevent.getAllSubcomponents('valarm')) {
    const trigger = alarm.getFirstPropertyValue('trigger')
    if (trigger instanceof ICAL.Duration) reminders.push(Math.round(-trigger.toSeconds() / 60))
  }

  const location = event.location || undefined
  const description = event.description || undefined
  const url = vevent.getFirstPropertyValue('url')?.toString()
  const transparent = vevent.getFirstPropertyValue('transp')?.toString().toUpperCase() === 'TRANSPARENT'
  return {
    id: `${href}#${recurrenceId ?? ''}`,
    href,
    calendarHref: ctx.calendarHref,
    uid: event.uid,
    recurrenceId,
    title: event.summary || 'Untitled event',
    start,
    end: Math.max(end, start),
    allDay,
    location,
    description,
    status: vevent.getFirstPropertyValue('status')?.toString().toUpperCase(),
    organizer,
    attendees,
    myAnswer: me && !organizer?.isMe ? me.answer : undefined,
    reminders: reminders.filter((m) => m >= 0).sort((a, b) => a - b),
    ...(transparent ? { free: true } : {}),
    talkToken:
      talkTokenIn(location, ctx.serverUrl) ??
      talkTokenIn(url, ctx.serverUrl) ??
      talkTokenIn(description, ctx.serverUrl),
    onlineMeeting: onlineMeetingIn(
      vevent.getFirstPropertyValue('x-microsoft-skypeteamsmeetingurl')?.toString(),
      location,
      url,
      description
    )
  }
}

/** A Date as the UTC stamp CalDAV time ranges use, e.g. 20261124T000000Z */
export function utcStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}
