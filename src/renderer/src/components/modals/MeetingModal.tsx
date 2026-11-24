import { useEffect, useState } from 'react'
import { talk } from '@renderer/api/talk'
import { parseCalendars, type Calendar } from '@renderer/lib/calendars'
import { formatAt } from '@renderer/lib/time'
import { setApp, showToast, useApp, type ModalState } from '@renderer/store/app'
import { Modal } from '../common/Modal'

// Schedule a meeting for a conversation: Talk puts an event with the conversation's link into one of
// our calendars and invites the participants.

const close = (): void => setApp({ modal: null })
const DURATIONS = [15, 30, 45, 60, 90, 120]

/** Talk's reasons for refusing a meeting */
const ERRORS: Record<string, string> = {
  calendar: 'That calendar was not found. Pick another one.',
  email:
    'Your account has no email address. Add one in your Nextcloud personal settings, the invitations are sent from it.',
  start: 'The meeting has to start in the future.',
  end: 'The meeting has to end after it starts.',
  conversation: 'Meetings can’t be scheduled for this conversation.'
}

const pad = (n: number): string => String(n).padStart(2, '0')

function nextFullHour(): Date {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return d
}

export function MeetingModal({ modal }: { modal: Extract<ModalState, { type: 'meeting' }> }) {
  const room = useApp((s) => s.accounts[modal.accountId]?.rooms[modal.token])
  const start0 = nextFullHour()
  const [title, setTitle] = useState(room?.displayName ?? '')
  const [date, setDate] = useState(
    `${start0.getFullYear()}-${pad(start0.getMonth() + 1)}-${pad(start0.getDate())}`
  )
  const [time, setTime] = useState(`${pad(start0.getHours())}:00`)
  const [minutes, setMinutes] = useState(60)
  const [calendars, setCalendars] = useState<Calendar[] | null>(null)
  const [calendar, setCalendar] = useState('')
  const [everyone, setEveryone] = useState(true)
  const [description, setDescription] = useState(room?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.hubbub
      .calendars(modal.accountId)
      .then((xml) => {
        const list = parseCalendars(xml)
        setCalendars(list)
        setCalendar((list.find((c) => c.uri === 'personal') ?? list[0])?.uri ?? '')
      })
      .catch((err) => {
        setCalendars([])
        setError(`Could not load your calendars: ${err instanceof Error ? err.message : String(err)}`)
      })
  }, [modal.accountId])

  const start = Math.floor(new Date(`${date}T${time}`).getTime() / 1000)
  const valid = !!calendar && !Number.isNaN(start) && start > Date.now() / 1000 - 60

  const save = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    try {
      await talk(modal.accountId).scheduleMeeting(modal.token, {
        calendarUri: calendar,
        start,
        end: start + minutes * 60,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        attendeeIds: everyone ? null : []
      })
      const name = calendars?.find((c) => c.uri === calendar)?.name ?? calendar
      showToast(`Meeting scheduled for ${formatAt(start)} in ${name}`)
      close()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(ERRORS[message] ?? message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Schedule a meeting"
      onClose={close}
      footer={
        <>
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>
            Schedule
          </button>
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}
      <label className="field-label">Title</label>
      <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="meeting-when">
        <div>
          <label className="field-label">Date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Start</label>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Length</label>
          <select className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="field-label">Calendar</label>
      <select
        className="input"
        value={calendar}
        disabled={!calendars?.length}
        onChange={(e) => setCalendar(e.target.value)}
      >
        {calendars === null && <option>Loading…</option>}
        {calendars?.length === 0 && <option>No calendar you can add events to</option>}
        {calendars?.map((c) => (
          <option key={c.uri} value={c.uri}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="field-label">Invite</label>
      <div className="meeting-invite">
        <label>
          <input type="radio" checked={everyone} onChange={() => setEveryone(true)} /> Everyone in the
          conversation
        </label>
        <label>
          <input type="radio" checked={!everyone} onChange={() => setEveryone(false)} /> Only me
        </label>
      </div>
      <label className="field-label">Description</label>
      <textarea
        className="input"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <p className="help">The event links to this conversation, so everyone can join the call from it.</p>
    </Modal>
  )
}
