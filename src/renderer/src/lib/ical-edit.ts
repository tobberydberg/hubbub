import ICAL from 'ical.js'
import type { Answer } from './caldav'
import { fromRRule, toRRule, type RepeatRule } from './repeat'

// Writing events: new ones, changes to existing ones, answers to invitations and removing one
// occurrence of a repeating event. Changes are made to the event as the server has it, so whatever
// Hubbub doesn't know about (other apps' properties, extra reminders' details) stays as it was.
//
// Times are written in the user's time zone by name (TZID=Europe/Stockholm). Nextcloud knows the
// zones by name, so repeating events keep their local time across daylight saving changes.

/** A repeat rule, no repeat (null), or 'keep' to leave the stored rule as it is */
export type Repeat = RepeatRule | null | 'keep'

export interface Invitee {
  name: string
  email: string
}

export interface EventDraft {
  title: string
  /** Milliseconds; for all-day events local midnight of the first and the day after the last day */
  start: number
  end: number
  allDay: boolean
  location: string
  description: string
  /** Minutes before the start, or null for no reminder */
  reminder: number | null
  repeat: Repeat
  /** Invited people, the organizer not included */
  attendees: Invitee[]
}

export interface Organizer {
  name: string
  email: string
}

export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** A local time as an iCalendar date-time (or date) in the user's time zone */
function setTime(vevent: ICAL.Component, name: 'dtstart' | 'dtend', ms: number, allDay: boolean): void {
  vevent.removeAllProperties(name)
  const d = new Date(ms)
  const time = ICAL.Time.fromData({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: allDay ? 0 : d.getHours(),
    minute: allDay ? 0 : d.getMinutes(),
    second: 0,
    isDate: allDay
  })
  const prop = new ICAL.Property(name, vevent)
  prop.setValue(time)
  if (!allDay) prop.setParameter('tzid', localTimeZone())
  vevent.addProperty(prop)
}

const utcNow = (): ICAL.Time => ICAL.Time.fromJSDate(new Date(), true)

function setText(vevent: ICAL.Component, name: string, value: string): void {
  vevent.removeAllProperties(name)
  if (value.trim()) vevent.addPropertyWithValue(name, value.trim())
}

function person(
  name: string,
  email: string,
  prop: 'organizer' | 'attendee',
  vevent: ICAL.Component
): ICAL.Property {
  const p = new ICAL.Property(prop, vevent)
  p.setValue(`mailto:${email}`)
  if (name) p.setParameter('cn', name)
  return p
}

const emailOf = (prop: ICAL.Property): string =>
  String(prop.getFirstValue() ?? '')
    .replace(/^mailto:/i, '')
    .toLowerCase()

/** Invited people as the draft has them, keeping the answers of those already invited */
function setAttendees(vevent: ICAL.Component, attendees: Invitee[], organizer: Organizer | null): void {
  const before = new Map(vevent.getAllProperties('attendee').map((p) => [emailOf(p), p]))
  vevent.removeAllProperties('attendee')
  if (!attendees.length) {
    vevent.removeAllProperties('organizer')
    return
  }
  if (organizer) {
    if (!vevent.getFirstProperty('organizer'))
      vevent.addProperty(person(organizer.name, organizer.email, 'organizer', vevent))
    const self =
      before.get(organizer.email.toLowerCase()) ?? person(organizer.name, organizer.email, 'attendee', vevent)
    self.setParameter('partstat', 'ACCEPTED')
    self.setParameter('role', 'CHAIR')
    vevent.addProperty(self)
  }
  for (const a of attendees) {
    const kept = before.get(a.email.toLowerCase())
    if (kept) {
      vevent.addProperty(kept)
      continue
    }
    const p = person(a.name, a.email, 'attendee', vevent)
    p.setParameter('partstat', 'NEEDS-ACTION')
    p.setParameter('role', 'REQ-PARTICIPANT')
    p.setParameter('rsvp', 'TRUE')
    vevent.addProperty(p)
  }
}

function setReminder(vevent: ICAL.Component, minutes: number | null, title: string): void {
  for (const alarm of vevent.getAllSubcomponents('valarm')) vevent.removeSubcomponent(alarm)
  if (minutes === null) return
  const alarm = new ICAL.Component('valarm')
  alarm.addPropertyWithValue('action', 'DISPLAY')
  alarm.addPropertyWithValue('description', title)
  alarm.addPropertyWithValue('trigger', ICAL.Duration.fromSeconds(-minutes * 60))
  vevent.addSubcomponent(alarm)
}

function setRepeat(vevent: ICAL.Component, repeat: Repeat, allDay: boolean): void {
  if (repeat === 'keep') return
  vevent.removeAllProperties('rrule')
  // Left-out occurrences only mean something to a series
  if (!repeat) vevent.removeAllProperties('exdate')
  else vevent.addPropertyWithValue('rrule', ICAL.Recur.fromString(toRRule(repeat, allDay)))
}

function apply(vevent: ICAL.Component, draft: EventDraft, organizer: Organizer | null): void {
  setText(vevent, 'summary', draft.title || 'Untitled event')
  setTime(vevent, 'dtstart', draft.start, draft.allDay)
  setTime(vevent, 'dtend', draft.end, draft.allDay)
  setText(vevent, 'location', draft.location)
  setText(vevent, 'description', draft.description)
  setRepeat(vevent, draft.repeat, draft.allDay)
  setAttendees(vevent, draft.attendees, organizer)
  setReminder(vevent, draft.reminder, draft.title)
  vevent.updatePropertyWithValue('dtstamp', utcNow())
  vevent.updatePropertyWithValue('last-modified', utcNow())
}

/** A new event as an .ics */
export function newEventIcs(draft: EventDraft, uid: string, organizer: Organizer | null): string {
  const calendar = new ICAL.Component('vcalendar')
  calendar.addPropertyWithValue('prodid', '-//Hubbub//Hubbub Calendar//EN')
  calendar.addPropertyWithValue('version', '2.0')
  calendar.addPropertyWithValue('calscale', 'GREGORIAN')
  const vevent = new ICAL.Component('vevent')
  vevent.addPropertyWithValue('uid', uid)
  vevent.addPropertyWithValue('created', utcNow())
  vevent.addPropertyWithValue('sequence', 0)
  apply(vevent, draft, organizer)
  calendar.addSubcomponent(vevent)
  return calendar.toString()
}

const masterOf = (calendar: ICAL.Component): ICAL.Component | undefined =>
  calendar.getAllSubcomponents('vevent').find((v) => !v.hasProperty('recurrence-id'))

export interface StoredEvent {
  calendar: ICAL.Component
  master: ICAL.Component
}

export function parseStored(ics: string): StoredEvent {
  const calendar = new ICAL.Component(ICAL.parse(ics))
  const master = masterOf(calendar) ?? calendar.getFirstSubcomponent('vevent')
  if (!master) throw new Error('The event could not be read')
  return { calendar, master }
}

/**
 * The repeat rule of a stored event as the dialog edits it: null for none, 'keep' for one it can't
 * show (which is then saved unchanged).
 */
export function repeatOf(master: ICAL.Component): Repeat {
  const rule = master.getFirstPropertyValue('rrule')
  if (!rule) return null
  const start = new ICAL.Event(master).startDate?.toJSDate().getTime() ?? Date.now()
  return fromRRule(rule.toString(), start) ?? 'keep'
}

/**
 * Changes a stored event. For a repeating event `occurrenceStart` is the start of the occurrence that
 * was edited: the series moves by as much as that occurrence did, so it keeps its pattern.
 */
export function updateEventIcs(
  ics: string,
  draft: EventDraft,
  organizer: Organizer | null,
  occurrenceStart?: number
): string {
  const { calendar, master } = parseStored(ics)
  let { start, end } = draft
  if (occurrenceStart !== undefined && master.hasProperty('rrule')) {
    const masterStart = new ICAL.Event(master).startDate.toJSDate().getTime()
    start = masterStart + (draft.start - occurrenceStart)
    end = start + (draft.end - draft.start)
  }
  apply(master, { ...draft, start, end }, organizer)
  master.updatePropertyWithValue('sequence', Number(master.getFirstPropertyValue('sequence') ?? 0) + 1)
  return calendar.toString()
}

/** Sets the user's answer on every occurrence they are invited to */
export function setAnswerIcs(ics: string, myEmails: string[], answer: Answer): string {
  const { calendar } = parseStored(ics)
  const mine = new Set(myEmails.map((e) => e.toLowerCase()))
  let found = false
  for (const vevent of calendar.getAllSubcomponents('vevent')) {
    for (const attendee of vevent.getAllProperties('attendee')) {
      if (!mine.has(emailOf(attendee))) continue
      attendee.setParameter('partstat', answer)
      attendee.removeParameter('rsvp')
      attendee.removeParameter('schedule-status')
      found = true
    }
    vevent.updatePropertyWithValue('dtstamp', utcNow())
  }
  if (!found) throw new Error('You are not invited to this event')
  return calendar.toString()
}

/** Leaves out one occurrence of a repeating event */
export function excludeOccurrenceIcs(ics: string, recurrenceId: string): string {
  const { calendar, master } = parseStored(ics)
  for (const v of calendar.getAllSubcomponents('vevent')) {
    if (v !== master && v.getFirstPropertyValue('recurrence-id')?.toString() === recurrenceId) {
      calendar.removeSubcomponent(v)
    }
  }
  // The occurrence's start as the server reported it: a date for all-day series, else UTC
  const exdate = new ICAL.Property('exdate', master)
  exdate.setValue(ICAL.Time.fromString(recurrenceId, exdate))
  master.addProperty(exdate)
  master.updatePropertyWithValue('sequence', Number(master.getFirstPropertyValue('sequence') ?? 0) + 1)
  return calendar.toString()
}

/** A unique id for a new event, also used for its file name */
export function newUid(): string {
  return `hubbub-${crypto.randomUUID()}`
}
