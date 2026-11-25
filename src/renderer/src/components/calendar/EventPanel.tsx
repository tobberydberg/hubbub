import { useEffect, useState } from 'react'
import {
  Bell,
  CalendarDays,
  Clock,
  ExternalLink,
  MapPin,
  MessageSquare,
  Pencil,
  Repeat,
  Trash2,
  Video
} from 'lucide-react'
import type { Answer, EventPerson } from '@renderer/lib/caldav'
import { formatDate, formatEventTime } from '@renderer/lib/calendar-time'
import { fold, type Person } from '@renderer/lib/people'
import { setApp, useApp } from '@renderer/store/app'
import { useCalendar } from '@renderer/store/calendar'
import { useCall } from '@renderer/store/call'
import { findEvent, joinEventCall, nextcloudCalendarUrl, openEventChat } from '@renderer/sync/calendar'
import { answerInvitation, deleteEvent, moveEvent } from '@renderer/sync/calendar-edit'
import { loadDirectory } from '@renderer/sync/people'
import { Avatar } from '../common/Avatar'
import { Linkified } from '../common/Linkified'
import { openContactCard, openProfileCard } from '../common/ProfileCard'

// A calendar event in the side panel: when and where, its call and chat, your answer, and who is
// coming.

const ANSWER_LABEL: Record<Answer, { label: string; className: string }> = {
  ACCEPTED: { label: 'Yes', className: 'ans-yes' },
  TENTATIVE: { label: 'Maybe', className: 'ans-maybe' },
  DECLINED: { label: 'No', className: 'ans-no' },
  'NEEDS-ACTION': { label: 'No answer', className: 'ans-waiting' },
  DELEGATED: { label: 'Delegated', className: 'ans-waiting' }
}

const CHOICES: { answer: Answer; label: string }[] = [
  { answer: 'ACCEPTED', label: 'Yes' },
  { answer: 'TENTATIVE', label: 'Maybe' },
  { answer: 'DECLINED', label: 'No' }
]

const reminderText = (minutes: number): string =>
  minutes === 0
    ? 'At the start'
    : minutes % 1440 === 0
      ? `${minutes / 1440} ${minutes === 1440 ? 'day' : 'days'} before`
      : minutes % 60 === 0
        ? `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'} before`
        : `${minutes} minutes before`

export function EventPanel({ accountId, eventId }: { accountId: string; eventId: string }) {
  // Re-render when events reload, so the panel follows changes made elsewhere
  useCalendar((s) => s.accounts[accountId])
  const event = findEvent(accountId, eventId)
  const calendars = useCalendar((s) => s.accounts[accountId]?.calendars)
  const calendar = calendars?.find((c) => c.href === event?.calendarHref)
  const roomName = useApp((s) =>
    event?.talkToken ? s.accounts[accountId]?.rooms[event.talkToken]?.displayName : undefined
  )
  const self = useApp((s) => s.accounts[accountId]?.user)
  const inCall = useCall(
    (s) => !!event?.talkToken && s.active?.accountId === accountId && s.active.token === event.talkToken
  )
  const [people, setPeople] = useState<Person[]>([])
  const [answering, setAnswering] = useState<Answer | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** For a repeating event: answer for this occurrence only, or for all of them */
  const [onlyThis, setOnlyThis] = useState(false)
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    void loadDirectory(accountId)
      .then((d) => setPeople(d.people))
      .catch(() => undefined)
  }, [accountId])
  useEffect(() => {
    setConfirmDelete(false)
    setOnlyThis(false)
  }, [eventId])

  if (!event) {
    return (
      <div className="empty-state">
        <p>This event isn’t in the calendar any more.</p>
      </div>
    )
  }

  /** The server user behind an invited email address, for their profile picture */
  const userIdOf = (p: EventPerson): string | undefined => {
    if (p.isMe) return self?.id
    const email = p.email?.toLowerCase()
    const name = fold(p.name)
    return people.find((u) => (email && u.subline?.toLowerCase() === email) || fold(u.name) === name)?.id
  }

  const now = Date.now()
  const live = event.start - 10 * 60_000 <= now && now < event.end
  const invited = dedupe([...(event.organizer ? [event.organizer] : []), ...event.attendees])
  const yes = invited.filter((p) => p === event.organizer || p.answer === 'ACCEPTED').length
  const mine = !event.organizer || event.organizer.isMe
  const canEdit = !!calendar?.writable && mine
  const answer = answering ?? event.myAnswer
  // Events move between the user's own calendars (Nextcloud moves only within one owner's)
  const own = (calendars ?? []).filter((c) => c.writable && !c.sharedBy)
  const movable = !!calendar && own.includes(calendar) && own.length > 1

  const remove = async (onlyThis: boolean): Promise<void> => {
    if (await deleteEvent(accountId, event, onlyThis)) setApp({ rhs: null })
  }

  const respond = async (a: Answer): Promise<void> => {
    // The other occurrences of a series may have another answer than this one
    if ((a === event.myAnswer && (onlyThis || !event.recurrenceId)) || answering) return
    setAnswering(a)
    await answerInvitation(accountId, event, a, onlyThis)
    setAnswering(null)
  }

  const move = async (href: string): Promise<void> => {
    if (href === event.calendarHref || moving) return
    setMoving(true)
    await moveEvent(accountId, event, href)
    setMoving(false)
  }

  return (
    <div className="rhs-body event-panel">
      <h3 className="event-title">{event.title}</h3>

      <div className="event-meta">
        <div>
          <Clock size={16} />
          <span>
            {formatDate(event.start, { weekday: 'short' })} · {formatEventTime(event)}
          </span>
        </div>
        {event.recurrenceId && (
          <div>
            <Repeat size={16} />
            <span>Repeating event</span>
          </div>
        )}
        {calendar && (
          <div>
            <CalendarDays size={16} />
            {movable ? (
              <label className="event-calendar movable" style={{ ['--c' as string]: calendar.color }}>
                <select
                  className="input"
                  aria-label="Calendar"
                  title={event.recurrenceId ? 'Moves every occurrence' : 'Move to another calendar'}
                  value={calendar.href}
                  disabled={moving}
                  onChange={(e) => void move(e.target.value)}
                >
                  {own.map((c) => (
                    <option key={c.href} value={c.href}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="event-calendar" style={{ ['--c' as string]: calendar.color }}>
                {calendar.name}
              </span>
            )}
          </div>
        )}
        {event.location && !event.talkToken && (
          <div>
            <MapPin size={16} />
            <span>
              <Linkified text={event.location} />
            </span>
          </div>
        )}
        {event.talkToken && roomName && (
          <div>
            <MessageSquare size={16} />
            <span>{roomName}</span>
          </div>
        )}
        {event.reminders.length > 0 && (
          <div>
            <Bell size={16} />
            <span>{event.reminders.map(reminderText).join(', ')}</span>
          </div>
        )}
      </div>

      {event.talkToken && (
        <div className="event-actions">
          {inCall ? (
            <span className="cal-in-call">You’re in the call</span>
          ) : (
            <button
              className={`ev-btn join${live ? ' live' : ''}`}
              onClick={() => joinEventCall(accountId, event)}
            >
              <Video size={16} /> Join call
            </button>
          )}
          {roomName && (
            <button className="ev-btn light" onClick={() => openEventChat(accountId, event)}>
              <MessageSquare size={16} /> Open chat
            </button>
          )}
        </div>
      )}

      {event.onlineMeeting && !event.talkToken && (
        <div className="event-actions">
          <button
            className={`ev-btn join${live ? ' live' : ''}`}
            title={event.onlineMeeting.url}
            onClick={() => void window.hubbub.app.openExternal(event.onlineMeeting!.url)}
          >
            <Video size={16} /> Join {event.onlineMeeting.service} meeting
          </button>
        </div>
      )}

      {event.myAnswer && (
        <div className="event-section">
          <div className="event-label">Your answer</div>
          {event.recurrenceId && (
            <div className="event-scope" role="radiogroup" aria-label="Answer for">
              <button role="radio" aria-checked={!onlyThis} onClick={() => setOnlyThis(false)}>
                All occurrences
              </button>
              <button role="radio" aria-checked={onlyThis} onClick={() => setOnlyThis(true)}>
                Only {formatDate(event.start, { weekday: 'short' })}
              </button>
            </div>
          )}
          <div className="event-rsvp" role="radiogroup" aria-label="Your answer">
            {CHOICES.map((c) => (
              <button
                key={c.answer}
                role="radio"
                aria-checked={answer === c.answer}
                className={[
                  answer === c.answer ? `on ${ANSWER_LABEL[c.answer].className}` : '',
                  answering === c.answer ? 'busy' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!!answering}
                onClick={() => void respond(c.answer)}
              >
                {c.label}
              </button>
            ))}
          </div>
          {event.myAnswer === 'NEEDS-ACTION' && event.organizer && (
            <p className="event-hint">{event.organizer.name} is waiting for your answer.</p>
          )}
        </div>
      )}

      {invited.length > 0 && (
        <div className="event-section">
          <div className="event-label">
            {invited.length} invited{yes ? ` · ${yes} yes` : ''}
          </div>
          <div className="event-people">
            {invited.map((p) => {
              const status = p === event.organizer ? null : ANSWER_LABEL[p.answer ?? 'NEEDS-ACTION']
              return (
                <div key={p.email ?? p.name} className="event-person">
                  <Avatar
                    accountId={accountId}
                    userId={userIdOf(p)}
                    name={p.name || p.email || '?'}
                    size={24}
                  />
                  <span
                    className={`event-person-name${userIdOf(p) || p.email ? ' profile-link' : ''}`}
                    title={p.email}
                    onClick={(e) => {
                      const id = userIdOf(p)
                      if (id) openProfileCard(accountId, id, p.name || id, e.currentTarget)
                      else if (p.email) openContactCard(accountId, p.email, p.name, e.currentTarget)
                    }}
                  >
                    {p.name || p.email}
                    {p.isMe && ' (you)'}
                  </span>
                  <span className={`event-person-answer ${status ? status.className : 'ans-yes'}`}>
                    {status ? status.label : 'Organizer'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {event.description && (
        <div className="event-section">
          <div className="event-label">Description</div>
          <p className="event-description">
            <Linkified text={event.description} />
          </p>
        </div>
      )}

      {canEdit && !confirmDelete && (
        <div className="event-actions">
          <button
            className="ev-btn light"
            onClick={() => setApp({ modal: { type: 'event-edit', accountId, eventId: event.id } })}
          >
            <Pencil size={15} /> Edit
          </button>
          <button className="ev-btn light danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      )}
      {confirmDelete && (
        <div className="event-confirm">
          <span>
            {event.recurrenceId
              ? 'Delete only this one, or the whole series?'
              : event.attendees.length
                ? 'Delete the event? The invited people are told.'
                : 'Delete the event?'}
          </span>
          <div className="event-actions">
            {event.recurrenceId && (
              <button className="ev-btn danger-solid" onClick={() => void remove(true)}>
                This one
              </button>
            )}
            <button className="ev-btn danger-solid" onClick={() => void remove(false)}>
              {event.recurrenceId ? 'All of them' : 'Delete'}
            </button>
            <button className="ev-btn light" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <button
        className="cal-side-link dark"
        onClick={() => void window.hubbub.app.openExternal(nextcloudCalendarUrl(accountId, event.start))}
      >
        <ExternalLink size={14} /> Open in Nextcloud Calendar
      </button>
    </div>
  )
}

/** The organizer is usually also an attendee; list each person once, the organizer first */
function dedupe(people: EventPerson[]): EventPerson[] {
  const seen = new Set<string>()
  return people.filter((p) => {
    const key = (p.email ?? p.name).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
