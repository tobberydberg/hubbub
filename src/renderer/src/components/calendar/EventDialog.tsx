import { useEffect, useMemo, useState } from 'react'
import { Video, X } from 'lucide-react'
import { addDays } from '@renderer/lib/calendar-time'
import { parseStored, repeatOf, type EventDraft, type Invitee, type Repeat } from '@renderer/lib/ical-edit'
import { hasFeature, setApp, useApp, type ModalState } from '@renderer/store/app'
import { useCalendar } from '@renderer/store/calendar'
import { usePrefs } from '@renderer/store/prefs'
import { findEvent } from '@renderer/sync/calendar'
import { inviteeFor, organizerFor, saveEvent } from '@renderer/sync/calendar-edit'
import { usePeopleSearch } from '@renderer/sync/people'
import { Avatar } from '../common/Avatar'
import { Modal, Toggle } from '../common/Modal'
import { RepeatEditor } from './RepeatEditor'

// Creating and editing calendar events. Editing starts from the event as the server has it, so
// what the dialog doesn't show (a custom repeat rule, other apps' details) is kept.

const close = (): void => setApp({ modal: null })

const REMINDERS: { value: number | null; label: string }[] = [
  { value: null, label: 'No reminder' },
  { value: 0, label: 'At the start' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' }
]

const pad = (n: number): string => String(n).padStart(2, '0')
const dateInput = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const timeInput = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromInputs = (date: string, time = '00:00'): number => new Date(`${date}T${time}`).getTime()
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Guest extends Invitee {
  userId?: string
}

/** The next half hour, an hour long */
function defaultTimes(): { start: number; end: number } {
  const now = new Date()
  now.setMinutes(now.getMinutes() < 30 ? 30 : 60, 0, 0)
  return { start: now.getTime(), end: now.getTime() + 3_600_000 }
}

export function EventDialog({ modal }: { modal: Extract<ModalState, { type: 'event-edit' }> }) {
  const { accountId } = modal
  const existing = modal.eventId ? findEvent(accountId, modal.eventId) : undefined
  const calendars = useCalendar((s) => s.accounts[accountId]?.calendars)
  const talkSupported = useApp((s) => hasFeature(s.accounts[accountId], 'conversation-v4'))
  const writable = useMemo(() => (calendars ?? []).filter((c) => c.writable), [calendars])

  const initial = existing
    ? { start: existing.start, end: existing.allDay ? addDays(existing.end, -1) : existing.end }
    : modal.start !== undefined
      ? { start: modal.start, end: modal.end ?? modal.start + 3_600_000 }
      : defaultTimes()
  const [title, setTitle] = useState(existing?.title ?? '')
  const [allDay, setAllDay] = useState(existing?.allDay ?? modal.allDay ?? false)
  const [startDate, setStartDate] = useState(dateInput(initial.start))
  const [startTime, setStartTime] = useState(timeInput(initial.start))
  const [endDate, setEndDate] = useState(dateInput(initial.end))
  const [endTime, setEndTime] = useState(timeInput(initial.end))
  const [repeat, setRepeat] = useState<Repeat>(null)
  const [calendarHref, setCalendarHref] = useState(existing?.calendarHref ?? '')
  const [location, setLocation] = useState(existing?.talkToken ? '' : (existing?.location ?? ''))
  const [description, setDescription] = useState(existing?.description ?? '')
  const [reminder, setReminder] = useState<number | null>(existing ? (existing.reminders[0] ?? null) : 10)
  const [guests, setGuests] = useState<Guest[]>(
    existing?.attendees.filter((a) => !a.isMe && a.email).map((a) => ({ name: a.name, email: a.email! })) ??
      []
  )
  const [withTalk, setWithTalk] = useState(false)
  const [loading, setLoading] = useState(!!existing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New events go into the default calendar from the settings, else the first one the user owns
  const defaultHref = usePrefs((s) => s.defaultCalendars[accountId])
  useEffect(() => {
    if (calendarHref || !writable.length) return
    const preferred = writable.find((c) => c.href === defaultHref)
    setCalendarHref((preferred ?? writable.find((c) => !c.sharedBy) ?? writable[0]).href)
  }, [calendarHref, writable, defaultHref])

  // Editing: the repeat rule as stored, which the occurrence on screen doesn't carry
  useEffect(() => {
    if (!existing) return
    let alive = true
    window.hubbub
      .calendarObject(accountId, { method: 'GET', href: existing.href })
      .then((res) => {
        if (!alive) return
        if (res.status === 200) setRepeat(repeatOf(parseStored(res.body).master))
        setLoading(false)
      })
      .catch(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // Once, for the event the dialog opened with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = allDay ? fromInputs(startDate) : fromInputs(startDate, startTime)
  const end = allDay ? addDays(fromInputs(endDate), 1) : fromInputs(endDate, endTime)
  const timesValid = !Number.isNaN(start) && !Number.isNaN(end) && end > start
  const needsEmail = guests.length > 0 && !organizerFor(accountId)

  const save = async (): Promise<void> => {
    if (!timesValid || saving || !calendarHref) return
    setSaving(true)
    const draft: EventDraft = {
      title: title.trim(),
      start,
      end,
      allDay,
      location: existing?.talkToken && !location ? (existing.location ?? '') : location,
      description,
      reminder,
      repeat,
      attendees: guests.map(({ name, email }) => ({ name, email }))
    }
    const ok = await saveEvent(accountId, {
      calendarHref,
      draft,
      existing,
      withTalk: withTalk && !existing?.talkToken,
      talkParticipants: guests.flatMap((g) => (g.userId ? [g.userId] : []))
    })
    setSaving(false)
    if (ok) close()
  }

  // Keep the end after the start when the start moves
  const moveStart = (date: string, time: string): void => {
    const before = allDay ? fromInputs(startDate) : fromInputs(startDate, startTime)
    const after = allDay ? fromInputs(date) : fromInputs(date, time)
    setStartDate(date)
    setStartTime(time)
    if (!Number.isNaN(before) && !Number.isNaN(after) && !Number.isNaN(end)) {
      const shifted = (allDay ? fromInputs(endDate) : end) + (after - before)
      setEndDate(dateInput(shifted))
      if (!allDay) setEndTime(timeInput(shifted))
    }
  }

  return (
    <Modal
      title={existing ? 'Edit event' : 'New event'}
      onClose={close}
      footer={
        <>
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!timesValid || saving || loading || !calendarHref || needsEmail}
            onClick={() => void save()}
          >
            {guests.length && !existing ? 'Send invitations' : 'Save'}
          </button>
        </>
      }
    >
      <div className="event-form">
        <input
          className="input event-form-title"
          autoFocus
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />

        <div className="event-form-times">
          <label className="field-label" htmlFor="event-start-date">
            Start
          </label>
          <div className="event-form-pair">
            <input
              id="event-start-date"
              className="input"
              type="date"
              aria-label="Start date"
              value={startDate}
              onChange={(e) => moveStart(e.target.value, startTime)}
            />
            {!allDay && (
              <input
                className="input"
                type="time"
                aria-label="Start time"
                value={startTime}
                onChange={(e) => moveStart(startDate, e.target.value)}
              />
            )}
          </div>
          <label className="field-label" htmlFor="event-end-date">
            End
          </label>
          <div className="event-form-pair">
            <input
              id="event-end-date"
              className="input"
              type="date"
              aria-label="End date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            {!allDay && (
              <input
                className="input"
                type="time"
                aria-label="End time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            )}
          </div>
        </div>
        <div className="event-form-row">
          <label className="event-form-toggle">
            <Toggle
              on={allDay}
              onChange={(v) => {
                setAllDay(v)
                if (!v && startDate === endDate && startTime === endTime)
                  setEndTime(timeInput(start + 3_600_000))
              }}
            />
            All day
          </label>
        </div>
        <label className="field-label">Repeat</label>
        <RepeatEditor
          key={loading ? 'loading' : 'loaded'}
          value={repeat}
          start={start}
          disabled={loading}
          onChange={setRepeat}
        />
        {!timesValid && <p className="error-text">The event has to end after it starts.</p>}
        {existing?.recurrenceId && (
          <p className="help">Changes apply to the whole series; moving this event moves all of them.</p>
        )}

        <label className="field-label">Calendar</label>
        <select
          className="input"
          value={calendarHref}
          disabled={!!existing}
          onChange={(e) => setCalendarHref(e.target.value)}
        >
          {writable.map((c) => (
            <option key={c.href} value={c.href}>
              {c.name}
              {c.sharedBy ? ` (${c.sharedBy})` : ''}
            </option>
          ))}
        </select>

        {talkSupported && !existing?.talkToken && (
          <label className="event-form-toggle talk">
            <Toggle on={withTalk} onChange={setWithTalk} />
            <Video size={16} /> Add a Talk conversation
            <span className="help">for chat and the call, with the invited people from this server</span>
          </label>
        )}
        {existing?.talkToken && (
          <p className="help event-form-has-talk">
            <Video size={14} /> This event has a Talk conversation.
          </p>
        )}

        <label className="field-label">Place</label>
        <input
          className="input"
          placeholder="Address or room"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />

        <label className="field-label">Invite people</label>
        <GuestPicker accountId={accountId} guests={guests} onChange={setGuests} onError={setError} />
        {needsEmail && (
          <p className="error-text">
            Your account has no email address, which invitations are sent from. Add one in your Nextcloud
            personal settings.
          </p>
        )}
        {error && <p className="error-text">{error}</p>}

        <label className="field-label">Reminder</label>
        <select
          className="input"
          value={reminder ?? ''}
          onChange={(e) => setReminder(e.target.value === '' ? null : Number(e.target.value))}
        >
          {REMINDERS.map((r) => (
            <option key={r.label} value={r.value ?? ''}>
              {r.label}
            </option>
          ))}
        </select>

        <label className="field-label">Description</label>
        <textarea
          className="input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </Modal>
  )
}

/** People to invite: users of this server, found as you type, or email addresses */
function GuestPicker({
  accountId,
  guests,
  onChange,
  onError
}: {
  accountId: string
  guests: Guest[]
  onChange: (guests: Guest[]) => void
  onError: (message: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const { people } = usePeopleSearch(accountId, query)
  const taken = new Set(guests.map((g) => g.email.toLowerCase()))
  const matches = query.trim() ? people.filter((p) => !guests.some((g) => g.userId === p.id)).slice(0, 6) : []
  const email = EMAIL.test(query.trim()) && !taken.has(query.trim().toLowerCase()) ? query.trim() : null

  const addUser = async (id: string, name: string): Promise<void> => {
    setQuery('')
    const invitee = await inviteeFor(accountId, id, name)
    if (!invitee) {
      onError(`${name} has no email address in Nextcloud, so they can’t be invited.`)
      return
    }
    onError(null)
    if (!taken.has(invitee.email.toLowerCase())) onChange([...guests, { ...invitee, userId: id }])
  }

  return (
    <div className="guest-picker">
      {guests.length > 0 && (
        <div className="guest-chips">
          {guests.map((g) => (
            <span key={g.email} className="guest-chip" title={g.email}>
              <Avatar accountId={accountId} userId={g.userId} name={g.name || g.email} size={20} />
              {g.name || g.email}
              <button
                title={`Don’t invite ${g.name || g.email}`}
                onClick={() => onChange(guests.filter((x) => x !== g))}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="input"
        placeholder="Name or email address"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (matches[0]) void addUser(matches[0].id, matches[0].name)
          else if (email) {
            onChange([...guests, { name: '', email }])
            setQuery('')
          }
        }}
      />
      {(matches.length > 0 || email) && (
        <div className="guest-results">
          {matches.map((p) => (
            <button
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void addUser(p.id, p.name)}
            >
              <Avatar accountId={accountId} userId={p.id} name={p.name} size={24} />
              <span>{p.name}</span>
              {p.subline && <span className="sub">{p.subline}</span>}
            </button>
          ))}
          {email && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange([...guests, { name: '', email }])
                setQuery('')
              }}
            >
              <span>Invite {email}</span>
              <span className="sub">by email</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
