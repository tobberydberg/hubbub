import { Fragment, useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, Plus, Upload, Video } from 'lucide-react'
import type { Answer, CalendarEvent, CalendarInfo } from '@renderer/lib/caldav'
import {
  addMonths,
  formatDate,
  formatEventTime,
  formatTime,
  isoWeek,
  isSameDay,
  startOfDay,
  startOfMonth,
  viewRange
} from '@renderer/lib/calendar-time'
import { answerInvitation } from '@renderer/sync/calendar-edit'
import { setApp, useActiveAccount } from '@renderer/store/app'
import { useCalendar } from '@renderer/store/calendar'
import { useCall } from '@renderer/store/call'
import { usePrefs } from '@renderer/store/prefs'
import {
  joinEventCall,
  nextcloudCalendarUrl,
  openEvent,
  openInvitations,
  setCalendarDate,
  showCalendar,
  upcomingEvents
} from '@renderer/sync/calendar'
import { CallWidget } from '../calls/CallWidget'

// The calendar's sidebar: a month to pick dates from, the calendars to show, and what's next.

export function CalendarSidebar() {
  const account = useActiveAccount()
  if (!account) return <aside className="sidebar" />
  const accountId = account.info.id
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-header-title static">{account.info.label}</span>
      </div>
      <div className="sidebar-scroll cal-side">
        <button className="cal-new" onClick={() => setApp({ modal: { type: 'event-edit', accountId } })}>
          <Plus size={16} /> New event
        </button>
        <MiniMonth accountId={accountId} />
        <CalendarList accountId={accountId} />
        <NextUp accountId={accountId} />
        <Invitations accountId={accountId} />
        <button
          className="cal-side-link"
          onClick={() => void window.hubbub.app.openExternal(nextcloudCalendarUrl(accountId, Date.now()))}
        >
          <ExternalLink size={14} /> Open Nextcloud Calendar
        </button>
        <div className="cal-side-io">
          <button
            className="cal-side-link"
            onClick={() => setApp({ modal: { type: 'calendar-io', accountId, mode: 'import' } })}
          >
            <Upload size={14} /> Import .ics…
          </button>
          <button
            className="cal-side-link"
            onClick={() => setApp({ modal: { type: 'calendar-io', accountId, mode: 'export' } })}
          >
            <Download size={14} /> Export .ics…
          </button>
        </div>
      </div>
      <CallWidget />
    </aside>
  )
}

function MiniMonth({ accountId }: { accountId: string }) {
  const date = useCalendar((s) => s.date)
  const view = usePrefs((s) => s.calendarView)
  const weeks = usePrefs((s) => s.calendarWeekNumbers)
  const [month, setMonth] = useState(() => startOfMonth(date))
  // Follow the main view when it moves to another month
  useEffect(() => setMonth(startOfMonth(date)), [date])
  const { days } = viewRange('month', month)
  const shown = viewRange(view, date)
  const today = Date.now()
  const m = new Date(month).getMonth()
  return (
    <div className="mini-month">
      <div className="mini-month-head">
        <span>{new Date(month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button className="mini-btn" title="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={14} />
        </button>
        <button className="mini-btn" title="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className={`mini-month-grid${weeks ? ' weeks' : ''}`}>
        {weeks && (
          <span className="wd wk" title="Week">
            W
          </span>
        )}
        {days.slice(0, 7).map((d) => (
          <span key={`h${d}`} className="wd">
            {new Date(d).toLocaleDateString(undefined, { weekday: 'narrow' })}
          </span>
        ))}
        {days.map((d, i) => {
          const inView = view !== 'month' && view !== 'agenda' && d >= shown.start && d < shown.end
          return (
            <Fragment key={d}>
              {weeks && i % 7 === 0 && (
                <button
                  className="wk"
                  title={`Week ${isoWeek(d)}`}
                  onClick={() => setCalendarDate(accountId, d)}
                >
                  {isoWeek(d)}
                </button>
              )}
              <button
                className={[
                  new Date(d).getMonth() !== m ? 'out' : '',
                  inView ? 'in-view' : '',
                  isSameDay(d, today) ? 'today' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setCalendarDate(accountId, d)}
              >
                {new Date(d).getDate()}
              </button>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

const NONE: string[] = []

/** The rest of the invitations are behind "Show more", so the month and calendars stay in view */
const INVITATIONS_SHOWN = 3

const ANSWERS: { answer: Answer; label: string }[] = [
  { answer: 'ACCEPTED', label: 'Yes' },
  { answer: 'TENTATIVE', label: 'Maybe' },
  { answer: 'DECLINED', label: 'No' }
]

/** Invitations the user hasn't answered: from colleagues, and from mail when that is on */
function Invitations({ accountId }: { accountId: string }) {
  useCalendar((s) => s.accounts[accountId]?.invitations)
  const [busy, setBusy] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const list = openInvitations(accountId)
  if (!list.length) return null
  const shown = all ? list : list.slice(0, INVITATIONS_SHOWN)
  const answer = async (e: CalendarEvent, a: Answer): Promise<void> => {
    setBusy(e.id)
    await answerInvitation(accountId, e, a)
    setBusy(null)
  }
  return (
    <div className="cal-section">
      <div className="cal-section-title">Invitations · {list.length}</div>
      {shown.map((e) => (
        <div
          key={e.id}
          className={`cal-invite${busy === e.id ? ' busy' : ''}`}
          onClick={() => {
            setCalendarDate(accountId, startOfDay(e.start))
            openEvent(accountId, e)
          }}
        >
          <b>{e.title}</b>
          <span className="cal-invite-when">
            {formatDate(e.start)} · {formatEventTime(e)}
          </span>
          {e.organizer && (
            <span className="cal-invite-from">From {e.organizer.name || e.organizer.email}</span>
          )}
          <span className="cal-invite-answers">
            {ANSWERS.map((x) => (
              <button
                key={x.answer}
                disabled={busy === e.id}
                onClick={(ev) => {
                  ev.stopPropagation()
                  void answer(e, x.answer)
                }}
              >
                {x.label}
              </button>
            ))}
          </span>
        </div>
      ))}
      {list.length > INVITATIONS_SHOWN && (
        <button className="cal-side-link" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show ${list.length - INVITATIONS_SHOWN} more`}
        </button>
      )}
    </div>
  )
}

function CalendarList({ accountId }: { accountId: string }) {
  const calendars = useCalendar((s) => s.accounts[accountId]?.calendars)
  const error = useCalendar((s) => s.accounts[accountId]?.error)
  // Selected as stored: a fresh [] on every read would re-render forever
  const hidden = usePrefs((s) => s.hiddenCalendars[accountId]) ?? NONE
  const toggle = (href: string): void => {
    const all = usePrefs.getState().hiddenCalendars
    const now = hidden.includes(href) ? hidden.filter((h) => h !== href) : [...hidden, href]
    usePrefs.getState().set({ hiddenCalendars: { ...all, [accountId]: now } })
  }
  if (!calendars) return error ? <p className="cal-side-note">{error}</p> : null
  const own = calendars.filter((c) => !c.sharedBy)
  const shared = calendars.filter((c) => c.sharedBy)
  const item = (c: CalendarInfo): React.ReactNode => {
    const on = !hidden.includes(c.href)
    return (
      <button
        key={c.href}
        className="cal-item"
        role="checkbox"
        aria-checked={on}
        onClick={() => toggle(c.href)}
      >
        <span
          className="cal-swatch"
          style={on ? { background: c.color, borderColor: c.color } : { borderColor: c.color }}
        >
          {on && <Check size={11} strokeWidth={3.5} />}
        </span>
        <span className="cal-item-name">{c.name}</span>
        {c.sharedBy ? (
          <span className="cal-item-note">{c.sharedBy}</span>
        ) : (
          !c.writable && <span className="cal-item-note">read-only</span>
        )}
      </button>
    )
  }
  return (
    <>
      <div className="cal-section">
        <div className="cal-section-title">My calendars</div>
        {own.length ? own.map(item) : <p className="cal-side-note">No calendars yet</p>}
      </div>
      {shared.length > 0 && (
        <div className="cal-section">
          <div className="cal-section-title">Shared with me</div>
          {shared.map(item)}
        </div>
      )}
    </>
  )
}

/** The next event with a call today */
function NextUp({ accountId }: { accountId: string }) {
  useMinuteTick()
  useCalendar((s) => s.accounts[accountId]?.upcoming)
  const next = upcomingEvents(accountId).find(
    (e) => e.talkToken && !e.allDay && isSameDay(e.start, Date.now())
  )
  if (!next) return null
  return (
    <div className="cal-next" onClick={() => openEvent(accountId, next)}>
      <span className="cal-next-when">{whenText(next)}</span>
      <span className="cal-next-row">
        <b>{next.title}</b>
        <JoinButton accountId={accountId} event={next} />
      </span>
    </div>
  )
}

function useMinuteTick(): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
}

function whenText(e: CalendarEvent): string {
  const now = Date.now()
  if (e.start <= now) return `Now · until ${formatTime(e.end)}`
  const minutes = Math.round((e.start - now) / 60_000)
  return minutes < 60 ? `In ${minutes} min · ${formatTime(e.start)}` : `Next · today ${formatTime(e.start)}`
}

function JoinButton({ accountId, event }: { accountId: string; event: CalendarEvent }) {
  const inIt = useCall((s) => s.active?.accountId === accountId && s.active.token === event.talkToken)
  if (inIt) return <span className="cal-in-call">In the call</span>
  return (
    <button
      className="cal-join"
      onClick={(e) => {
        e.stopPropagation()
        joinEventCall(accountId, event)
      }}
    >
      <Video size={13} /> Join
    </button>
  )
}

const STRIP_BEFORE = 10 * 60_000

/** In the chat sidebar: the next meeting with a call, from 10 minutes before it starts until it ends. */
export function MeetingStrip({ accountId }: { accountId: string }) {
  useMinuteTick()
  useCalendar((s) => s.accounts[accountId]?.upcoming)
  const enabled = usePrefs((s) => s.meetingStrip)
  const callToken = useCall((s) => (s.active?.accountId === accountId ? s.active.token : null))
  if (!enabled) return null
  const now = Date.now()
  const next = upcomingEvents(accountId).find(
    (e) =>
      e.talkToken &&
      !e.allDay &&
      e.myAnswer !== 'DECLINED' &&
      e.start - STRIP_BEFORE <= now &&
      now < e.end &&
      e.talkToken !== callToken
  )
  if (!next) return null
  return (
    <div
      className="meeting-strip"
      title="Show in the calendar"
      onClick={() => {
        showCalendar(accountId, true)
        openEvent(accountId, next)
      }}
    >
      <div>
        <b>
          {next.start > now
            ? `${next.title} in ${Math.max(1, Math.round((next.start - now) / 60_000))} min`
            : `${next.title} now`}
        </b>
        <span>
          {formatTime(next.start)}–{formatTime(next.end)}
          {next.attendees.length > 0 && ` · ${next.attendees.length} invited`}
        </span>
      </div>
      <JoinButton accountId={accountId} event={next} />
    </div>
  )
}
