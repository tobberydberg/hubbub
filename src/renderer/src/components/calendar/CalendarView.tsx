import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CalendarX2, ChevronLeft, ChevronRight, RefreshCw, Video } from 'lucide-react'
import type { CalendarEvent, CalendarInfo } from '@renderer/lib/caldav'
import {
  DAY_MS,
  addDays,
  formatEventTime,
  formatTime,
  isoWeek,
  isSameDay,
  layoutDay,
  onDay,
  startOfDay,
  stepDate,
  viewRange,
  viewTitle,
  type CalendarViewKind
} from '@renderer/lib/calendar-time'
import { setApp, useApp, type AccountState } from '@renderer/store/app'
import { eventsOf, useCalendar } from '@renderer/store/calendar'
import { usePrefs } from '@renderer/store/prefs'
import { Linkified } from '../common/Linkified'
import {
  joinEventCall,
  loadView,
  openEvent,
  refreshCalendars,
  setCalendarDate
} from '@renderer/sync/calendar'

// The calendar of one server: day, week, month or agenda, from the user's Nextcloud calendars.

const HOUR_PX = 48
const VIEWS: { value: CalendarViewKind; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'agenda', label: 'Agenda' }
]

/** The current time, updated every minute */
function useNow(): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function CalendarView({ account }: { account: AccountState }) {
  const accountId = account.info.id
  const data = useCalendar((s) => s.accounts[accountId])
  const date = useCalendar((s) => s.date)
  const view = usePrefs((s) => s.calendarView)
  const weekends = usePrefs((s) => s.calendarWeekends)
  const hidden = usePrefs((s) => s.hiddenCalendars[accountId])
  const selected = useApp((s) => (s.rhs?.type === 'event' ? s.rhs.eventId : null))

  useEffect(() => {
    void loadView(accountId)
  }, [accountId, view])

  const { days } = viewRange(view, date)
  const calendars = useMemo(
    () => Object.fromEntries((data?.calendars ?? []).map((c) => [c.href, c])),
    [data?.calendars]
  )
  const events = useMemo(() => eventsOf(data?.view ?? null, hidden ?? []), [data?.view, hidden])
  const shownDays = view === 'week' && !weekends ? days.slice(0, 5) : days

  const setView = (v: CalendarViewKind): void => usePrefs.getState().set({ calendarView: v })
  const go = (d: number): void => setCalendarDate(accountId, d)

  return (
    <main className="center calendar">
      <div className="cal-toolbar">
        <button className="btn btn-tertiary small" onClick={() => go(startOfDay(Date.now()))}>
          Today
        </button>
        <button className="icon-btn" title="Previous" onClick={() => go(stepDate(view, date, -1))}>
          <ChevronLeft size={18} />
        </button>
        <button className="icon-btn" title="Next" onClick={() => go(stepDate(view, date, 1))}>
          <ChevronRight size={18} />
        </button>
        <h2 className="cal-title">{viewTitle(view, date, shownDays)}</h2>
        {data?.loading && <span className="spinner small" />}
        <span className="cal-toolbar-end">
          {view === 'week' && (
            <label className="cal-weekends">
              <input
                type="checkbox"
                checked={weekends}
                onChange={(e) => usePrefs.getState().set({ calendarWeekends: e.target.checked })}
              />
              Weekends
            </label>
          )}
          <button
            className="icon-btn"
            title="Check for changes now"
            onClick={() => void refreshCalendars(accountId, true)}
          >
            <RefreshCw size={16} />
          </button>
          <span className="cal-views" role="radiogroup" aria-label="View">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                role="radio"
                aria-checked={view === v.value}
                className={view === v.value ? 'selected' : ''}
                onClick={() => setView(v.value)}
              >
                {v.label}
              </button>
            ))}
          </span>
        </span>
      </div>

      {data?.error && !data.calendars ? (
        <div className="empty-state">
          <CalendarX2 size={48} strokeWidth={1.5} />
          <h2>Your calendars couldn’t be loaded</h2>
          <p>{data.error}</p>
        </div>
      ) : view === 'month' ? (
        <MonthGrid
          accountId={accountId}
          date={date}
          days={days}
          events={events}
          calendars={calendars}
          selected={selected}
        />
      ) : view === 'agenda' ? (
        <Agenda accountId={accountId} days={days} events={events} calendars={calendars} selected={selected} />
      ) : (
        <TimeGrid
          accountId={accountId}
          days={shownDays}
          events={events}
          calendars={calendars}
          selected={selected}
        />
      )}
    </main>
  )
}

interface GridProps {
  accountId: string
  days: number[]
  events: CalendarEvent[]
  calendars: Record<string, CalendarInfo>
  selected: string | null
}

const colorOf = (calendars: Record<string, CalendarInfo>, e: CalendarEvent): string =>
  calendars[e.calendarHref]?.color ?? 'var(--button-bg)'

const eventClass = (e: CalendarEvent, selected: string | null): string =>
  [
    'cal-event',
    e.myAnswer === 'NEEDS-ACTION' ? 'unanswered' : '',
    e.myAnswer === 'DECLINED' ? 'declined' : '',
    e.status === 'TENTATIVE' || e.myAnswer === 'TENTATIVE' ? 'tentative' : '',
    e.id === selected ? 'selected' : ''
  ]
    .filter(Boolean)
    .join(' ')

const eventTitle = (e: CalendarEvent): string =>
  [e.title, formatEventTime(e), e.location, e.myAnswer === 'NEEDS-ACTION' ? 'Not answered yet' : '']
    .filter(Boolean)
    .join('\n')

/** Day and week: a column per day, with all-day events on top and the hours below */
function TimeGrid({ accountId, days, events, calendars, selected }: GridProps) {
  const now = useNow()
  const weeks = usePrefs((s) => s.calendarWeekNumbers)
  const scroller = useRef<HTMLDivElement>(null)
  const firstDay = days[0]
  const allDay = (day: number): CalendarEvent[] => events.filter((e) => e.allDay && onDay(e, day))
  const hasAllDay = days.some((d) => allDay(d).length > 0)

  // The earliest hour a meeting on screen starts, so early meetings aren't above the visible part
  const earliest = Math.min(
    24,
    ...events
      .filter((e) => !e.allDay && days.some((d) => onDay(e, d)))
      .map((e) => (days.some((d) => isSameDay(d, e.start)) ? new Date(e.start).getHours() : 0))
  )

  // Start around the working day, or earlier for an early meeting or an hour before now
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const today = days.find((d) => isSameDay(d, now))
    let hour = Math.min(8, earliest)
    if (today) hour = Math.min(hour, Math.max(0, new Date(now).getHours() - 1))
    el.scrollTop = hour * HOUR_PX - 8
    // Only when the shown days or the earliest meeting change, not every minute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, days.length, earliest])

  const columns = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }
  return (
    <div className="cal-time">
      <div className="cal-days" style={columns}>
        {weeks ? (
          <span className="cal-weeknum" title={`Week ${isoWeek(days[0])}`}>
            W{isoWeek(days[0])}
          </span>
        ) : (
          <span />
        )}
        {days.map((d) => (
          <button
            key={d}
            className={`cal-day-head${isSameDay(d, now) ? ' today' : ''}`}
            title="Show this day"
            onClick={() => {
              usePrefs.getState().set({ calendarView: 'day' })
              setCalendarDate(accountId, d)
            }}
          >
            <span>{new Date(d).toLocaleDateString(undefined, { weekday: 'short' })}</span>
            <b>{new Date(d).getDate()}</b>
          </button>
        ))}
      </div>
      {hasAllDay && (
        <div className="cal-allday" style={columns}>
          <span className="cal-allday-label">all day</span>
          {days.map((d) => (
            <div
              key={d}
              className="cal-allday-cell"
              title="New all-day event"
              onClick={(e) => {
                if (e.target === e.currentTarget) newEvent(accountId, d, addDays(d, 1), true)
              }}
            >
              {allDay(d).map((e) => (
                <button
                  key={e.id}
                  className={`${eventClass(e, selected)} chip`}
                  style={{ ['--c' as string]: colorOf(calendars, e) }}
                  title={eventTitle(e)}
                  onClick={() => openEvent(accountId, e)}
                >
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="cal-scroll" ref={scroller}>
        <div className="cal-grid" style={{ ...columns, height: 24 * HOUR_PX }}>
          <div className="cal-hours">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} style={{ top: (i + 1) * HOUR_PX }}>
                {formatTime(new Date(2000, 0, 1, i + 1).getTime())}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div
              key={d}
              className={`cal-col${isSameDay(d, now) ? ' today' : ''}`}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return
                // The half hour that was clicked, an hour long
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top
                const start = d + Math.floor((y / HOUR_PX) * 2) * 30 * 60_000
                newEvent(accountId, start, start + 3_600_000, false)
              }}
            >
              {layoutDay(events, d).map((p) => (
                <button
                  key={p.event.id}
                  className={`${eventClass(p.event, selected)}${p.lanes >= 3 || days.length > 5 ? ' narrow' : ''}`}
                  style={{
                    ['--c' as string]: colorOf(calendars, p.event),
                    top: (p.top / 60) * HOUR_PX,
                    height: Math.max(18, (p.height / 60) * HOUR_PX - 2),
                    left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                    width: `calc(${100 / p.lanes}% - 5px)`
                  }}
                  title={eventTitle(p.event)}
                  onClick={() => openEvent(accountId, p.event)}
                >
                  <b>{p.event.title}</b>
                  {p.height >= 40 && <span className="cal-event-time">{formatEventTime(p.event)}</span>}
                  {p.event.talkToken && <Video size={12} className="cal-event-call" />}
                </button>
              ))}
              {isSameDay(d, now) && (
                <div className="cal-now" style={{ top: ((now - startOfDay(now)) / 3_600_000) * HOUR_PX }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Opens the new-event dialog at a time, in calendars the user can write to */
function newEvent(accountId: string, start: number, end: number, allDay: boolean): void {
  setApp({ modal: { type: 'event-edit', accountId, start, end, allDay } })
}

const MONTH_CHIPS = 3

function MonthGrid({ accountId, date, days, events, calendars, selected }: GridProps & { date: number }) {
  const now = useNow()
  const weeks = usePrefs((s) => s.calendarWeekNumbers)
  const showWeek = (d: number): void => {
    usePrefs.getState().set({ calendarView: 'week' })
    setCalendarDate(accountId, d)
  }
  const month = new Date(date).getMonth()
  const showDay = (d: number): void => {
    usePrefs.getState().set({ calendarView: 'day' })
    setCalendarDate(accountId, d)
  }
  return (
    <div className={`cal-month${weeks ? ' weeks' : ''}`}>
      <div className="cal-month-head">
        {weeks && <span className="cal-weeknum">W</span>}
        {days.slice(0, 7).map((d) => (
          <span key={d}>{new Date(d).toLocaleDateString(undefined, { weekday: 'short' })}</span>
        ))}
      </div>
      <div className="cal-month-grid">
        {days.map((d, i) => {
          const dayEvents = events
            .filter((e) => onDay(e, d))
            .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)
          return (
            <Fragment key={d}>
              {weeks && i % 7 === 0 && (
                <button className="cal-month-week" title="Show this week" onClick={() => showWeek(d)}>
                  {isoWeek(d)}
                </button>
              )}
              <div
                className={`cal-month-cell${new Date(d).getMonth() !== month ? ' other' : ''}${isSameDay(d, now) ? ' today' : ''}`}
              >
                <button className="cal-month-day" title="Show this day" onClick={() => showDay(d)}>
                  {new Date(d).getDate()}
                </button>
                {dayEvents.slice(0, MONTH_CHIPS).map((e) => (
                  <button
                    key={e.id}
                    className={`${eventClass(e, selected)} chip${e.allDay ? '' : ' timed'}`}
                    style={{ ['--c' as string]: colorOf(calendars, e) }}
                    title={eventTitle(e)}
                    onClick={() => openEvent(accountId, e)}
                  >
                    {!e.allDay && <span className="cal-chip-time">{formatTime(Math.max(e.start, d))}</span>}
                    {e.title}
                  </button>
                ))}
                {dayEvents.length > MONTH_CHIPS && (
                  <button className="cal-more" onClick={() => showDay(d)}>
                    {dayEvents.length - MONTH_CHIPS} more
                  </button>
                )}
              </div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function Agenda({ accountId, days, events, calendars, selected }: GridProps) {
  const now = useNow()
  const groups = days
    .map((d) => ({
      day: d,
      events: events
        .filter((e) => onDay(e, d) && !(isSameDay(d, now) && e.end <= now && !e.allDay))
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)
    }))
    .filter((g) => g.events.length)
  if (!groups.length) {
    return (
      <div className="empty-state">
        <h2>Nothing in the next {Math.round((days[days.length - 1] - days[0]) / DAY_MS) + 1} days</h2>
        <p>Events from the calendars you show appear here.</p>
      </div>
    )
  }
  return (
    <div className="cal-agenda">
      {groups.map((g) => (
        <section key={g.day} className="cal-agenda-day">
          <h3 className={isSameDay(g.day, now) ? 'today' : ''}>
            {isSameDay(g.day, now)
              ? 'Today'
              : new Date(g.day).toLocaleDateString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long'
                })}
          </h3>
          {g.events.map((e) => {
            const live = e.start - 10 * 60_000 <= now && now < e.end
            return (
              <div
                key={e.id}
                className={`cal-agenda-row${e.id === selected ? ' selected' : ''}`}
                onClick={() => openEvent(accountId, e)}
              >
                <span className="cal-agenda-time">{formatEventTime(e)}</span>
                <span className="cal-dot" style={{ background: colorOf(calendars, e) }} />
                <span className="cal-agenda-title">
                  <b className={e.myAnswer === 'DECLINED' ? 'declined' : ''}>{e.title}</b>
                  {e.myAnswer === 'NEEDS-ACTION' && <span className="cal-badge">Not answered</span>}
                  {e.location && !e.talkToken && (
                    <span className="sub">
                      <Linkified text={e.location} />
                    </span>
                  )}
                </span>
                {e.talkToken && live && (
                  <button
                    className="cal-join"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      joinEventCall(accountId, e)
                    }}
                  >
                    <Video size={13} /> Join
                  </button>
                )}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
