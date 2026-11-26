import { talk } from '@renderer/api/talk'
import type { Answer, CalendarEvent } from '@renderer/lib/caldav'
import {
  excludeOccurrenceIcs,
  newEventIcs,
  newUid,
  setAnswerIcs,
  updateEventIcs,
  type EventDraft,
  type Invitee,
  type Organizer
} from '@renderer/lib/ical-edit'
import { RoomType } from '@shared/talk-types'
import { formatDate } from '@renderer/lib/calendar-time'
import { setApp, showToast, useApp } from '@renderer/store/app'
import { useCalendar } from '@renderer/store/calendar'
import { myAddresses, refreshCalendars } from './calendar'

// Changing events on the server: answering invitations, creating, editing and deleting. Every
// change starts from the event as the server has it now and is saved with its ETag, so nothing
// changed elsewhere in the meantime is lost; Nextcloud then sends invitations and answers.

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

class Conflict extends Error {}

async function read(accountId: string, href: string): Promise<{ ics: string; etag: string | null }> {
  const res = await window.hubbub.calendarObject(accountId, { method: 'GET', href })
  if (res.status !== 200) throw new Error(`The event could not be read (HTTP ${res.status})`)
  return { ics: res.body, etag: res.etag }
}

async function write(accountId: string, href: string, ics: string, etag: string | null): Promise<void> {
  const res = await window.hubbub.calendarObject(accountId, { method: 'PUT', href, body: ics, etag })
  if (res.status === 412) throw new Conflict('The event was changed elsewhere in the meantime')
  if (res.status === 403) throw new Error('You may not change events in this calendar')
  if (res.status < 200 || res.status >= 300)
    throw new Error(`The event could not be saved (HTTP ${res.status})`)
}

/** Reads, changes and saves an event, once more if it changed in between. */
async function change(accountId: string, href: string, edit: (ics: string) => string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const { ics, etag } = await read(accountId, href)
    try {
      await write(accountId, href, edit(ics), etag)
      return
    } catch (err) {
      if (!(err instanceof Conflict) || attempt > 0) throw err
    }
  }
}

function account(accountId: string) {
  const a = useApp.getState().accounts[accountId]
  if (!a) throw new Error('Unknown account')
  return a
}

/** The user as organizer of invitations; null without an email address, which invitations need */
export function organizerFor(accountId: string): Organizer | null {
  const a = useApp.getState().accounts[accountId]
  const email = a?.user?.email
  return email ? { name: a.user?.displayname ?? a.info.displayName, email } : null
}

const ANSWER_TEXT: Record<Answer, string> = {
  ACCEPTED: 'You said yes',
  TENTATIVE: 'You said maybe',
  DECLINED: 'You said no',
  'NEEDS-ACTION': 'Answer removed',
  DELEGATED: 'Delegated'
}

/** Answers an invitation; for a repeating event with `onlyThis` for this occurrence only */
export async function answerInvitation(
  accountId: string,
  event: CalendarEvent,
  answer: Answer,
  onlyThis = false
): Promise<boolean> {
  const emails = myAddresses(accountId)
  const occurrence = onlyThis ? event.recurrenceId : undefined
  try {
    if (!emails.length) throw new Error('Your account has no email address')
    await change(accountId, event.href, (ics) => setAnswerIcs(ics, emails, answer, occurrence))
    showToast(
      `${ANSWER_TEXT[answer]} to ${event.title}${occurrence ? ` on ${formatDate(event.start, { weekday: 'short' })}` : ''}`
    )
    void refreshCalendars(accountId, true)
    return true
  } catch (err) {
    showToast(`Your answer couldn’t be sent: ${errorText(err)}`, 'error')
    return false
  }
}

export interface SaveRequest {
  calendarHref: string
  draft: EventDraft
  /** The event being edited, or none for a new one */
  existing?: CalendarEvent
  /** Create a Talk conversation for the event and link it */
  withTalk?: boolean
  /** User ids of invited people on this server, to add to the Talk conversation */
  talkParticipants?: string[]
}

/** Creates or changes an event. Resolves with false when it couldn't be saved (a toast says why). */
export async function saveEvent(accountId: string, req: SaveRequest): Promise<boolean> {
  const a = account(accountId)
  // A meeting you organized from another of your addresses stays organized from that one
  const was = req.existing?.organizer
  const organizer = was?.isMe && was.email ? { name: was.name, email: was.email } : organizerFor(accountId)
  try {
    if (req.draft.attendees.length && !organizer) {
      throw new Error('Your account has no email address, which invitations are sent from')
    }
    let draft = req.draft
    if (req.withTalk) {
      const link = await createEventConversation(accountId, draft, req.talkParticipants ?? [])
      draft = linkConversation(draft, link)
    }
    if (req.existing) {
      const occurrence = req.existing.recurrenceId ? req.existing.start : undefined
      await change(accountId, req.existing.href, (ics) => updateEventIcs(ics, draft, organizer, occurrence))
      if (req.calendarHref !== req.existing.calendarHref) {
        const { href } = req.existing
        await moveObject(accountId, href, req.calendarHref)
        void refreshCalendars(accountId, true).then(() => followMove(href, req.calendarHref))
      }
      showToast(draft.attendees.length ? 'Saved, and the invited people are told' : 'Saved')
    } else {
      const uid = newUid()
      const href = `${req.calendarHref.replace(/\/?$/, '/')}${uid}.ics`
      await write(accountId, href, newEventIcs(draft, uid, organizer), null)
      showToast(draft.attendees.length ? 'Event created and invitations sent' : 'Event created')
    }
    void refreshCalendars(a.info.id, true)
    return true
  } catch (err) {
    showToast(`The event couldn’t be saved: ${errorText(err)}`, 'error')
    return false
  }
}

async function moveObject(accountId: string, href: string, calendarHref: string): Promise<void> {
  const { etag } = await read(accountId, href)
  const res = await window.hubbub.calendarObject(accountId, {
    method: 'MOVE',
    href,
    destination: calendarHref,
    etag
  })
  if (res.status === 412) throw new Error('There is already an event like it in that calendar')
  if (res.status === 403) throw new Error('You may not move events between these calendars')
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
}

/** Once the calendars have reloaded: the side panel shows the event by its path, which a move changed */
function followMove(href: string, calendarHref: string): void {
  const rhs = useApp.getState().rhs
  if (rhs?.type === 'event' && rhs.eventId.startsWith(`${href}#`)) {
    const moved = `${calendarHref.replace(/\/?$/, '/')}${href.split('/').pop()}`
    setApp({ rhs: { ...rhs, eventId: moved + rhs.eventId.slice(href.length) } })
  }
}

/**
 * Moves an event (the whole series for a repeating one) to another of the user's calendars. It
 * stays the same event: invited people and the organizer aren't told, and answers are kept.
 */
export async function moveEvent(
  accountId: string,
  event: CalendarEvent,
  calendarHref: string
): Promise<boolean> {
  try {
    await moveObject(accountId, event.href, calendarHref)
    const name = useCalendar
      .getState()
      .accounts[accountId]?.calendars?.find((c) => c.href === calendarHref)?.name
    showToast(name ? `Moved to ${name}` : 'Event moved')
    await refreshCalendars(accountId, true)
    followMove(event.href, calendarHref)
    return true
  } catch (err) {
    showToast(`The event couldn’t be moved: ${errorText(err)}`, 'error')
    return false
  }
}

/** Deletes an event, or one occurrence of a repeating event. */
export async function deleteEvent(
  accountId: string,
  event: CalendarEvent,
  onlyThis: boolean
): Promise<boolean> {
  try {
    if (onlyThis && event.recurrenceId) {
      const recurrenceId = event.recurrenceId
      await change(accountId, event.href, (ics) => excludeOccurrenceIcs(ics, recurrenceId))
    } else {
      const { etag } = await read(accountId, event.href)
      const res = await window.hubbub.calendarObject(accountId, { method: 'DELETE', href: event.href, etag })
      if (res.status === 412) throw new Error('The event was changed elsewhere in the meantime')
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
    }
    showToast('Event deleted')
    void refreshCalendars(accountId, true)
    return true
  } catch (err) {
    showToast(`The event couldn’t be deleted: ${errorText(err)}`, 'error')
    return false
  }
}

/** A user's address for invitations, as their calendar knows it */
export async function inviteeFor(accountId: string, userId: string, name: string): Promise<Invitee | null> {
  const addresses = await window.hubbub.calendarAddresses(accountId, userId).catch(() => [])
  const email = addresses[0]?.replace(/^mailto:/i, '')
  return email ? { name, email } : null
}

/**
 * A Talk conversation for the event, like Nextcloud Calendar's "Add Talk conversation": an event
 * conversation (listed under Meetings) with the invited people of this server in it.
 */
async function createEventConversation(
  accountId: string,
  draft: EventDraft,
  userIds: string[]
): Promise<string> {
  const a = account(accountId)
  const api = talk(accountId)
  const room = await api.createRoom({
    roomType: RoomType.Group,
    roomName: (draft.title || 'Meeting').slice(0, 255),
    objectType: 'event',
    objectId: `${Math.floor(draft.start / 1000)}#${Math.floor(draft.end / 1000)}`
  })
  for (const id of userIds) await api.addParticipant(room.token, id).catch(() => undefined)
  return `${a.info.serverUrl.replace(/\/+$/, '')}/index.php/call/${room.token}`
}

/** The conversation's link as the place, or added to the description when there is a place already */
function linkConversation(draft: EventDraft, link: string): EventDraft {
  if (!draft.location.trim()) return { ...draft, location: link }
  const description = draft.description.trim()
  return { ...draft, description: `${description ? `${description}\n\n` : ''}Talk conversation: ${link}` }
}
