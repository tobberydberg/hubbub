import { useEffect, type ReactNode } from 'react'
import {
  AtSign,
  Bell,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  MessagesSquare,
  Smile,
  Video
} from 'lucide-react'
import { RoomType, type Room } from '@shared/talk-types'
import type { Answer, CalendarEvent } from '@renderer/lib/caldav'
import { formatEventTime } from '@renderer/lib/calendar-time'
import { toPlainText } from '@renderer/lib/messages'
import { isGroupMessage, roomTitle } from '@renderer/lib/rooms'
import { formatUntil } from '@renderer/lib/status'
import { setApp, type AccountState } from '@renderer/store/app'
import { allCalendars, useCalendar } from '@renderer/store/calendar'
import { usePrefs } from '@renderer/store/prefs'
import { openRoom, showThreadsView } from '@renderer/sync/actions'
import { absentToday } from '@renderer/sync/absence'
import {
  joinEventCall,
  openEvent,
  openInvitations,
  refreshCalendars,
  showCalendar
} from '@renderer/sync/calendar'
import { answerInvitation } from '@renderer/sync/calendar-edit'
import { openNotification } from '@renderer/sync/notifications'
import { useThreads } from '@renderer/sync/threads'
import { RoomIcon } from '../sidebar/Sidebar'

// "Today" for one server: your day at a glance. Meetings still to come today and tomorrow's first
// ones, what's waiting for you in the chat (mentions, direct messages, followed threads), invitations
// you haven't answered and the server's latest notifications, with your status at the top.

const SHOWN = 6

const greeting = (h: number): string =>
  h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'

const dayStart = (ms: number, add = 0): number => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add).getTime()
}

export function TodayView({ account }: { account: AccountState }) {
  const accountId = account.info.id
  const cal = useCalendar((s) => s.accounts[accountId])
  const hidden = usePrefs((s) => s.hiddenCalendars[accountId])
  const threads = useThreads(account).filter((t) => t.following && t.unread)
  // Re-render when the minute changes, for "now" and greetings
  const now = Date.now()

  useEffect(() => {
    void refreshCalendars(accountId)
  }, [accountId])

  const colorOf = (e: CalendarEvent): string | undefined =>
    allCalendars(cal).find((c) => c.href === e.calendarHref)?.color
  const first = account.user?.displayname?.split(' ')[0] ?? account.info.displayName.split(' ')[0]

  // Meetings: the rest of today, and tomorrow's
  const events = Object.entries(cal?.upcoming?.byCalendar ?? {})
    .filter(([href]) => !(hidden ?? []).includes(href))
    .flatMap(([, list]) => list)
    .filter((e) => e.end > now && e.start < dayStart(now, 2) && e.status !== 'CANCELLED')
    .sort((a, b) => a.start - b.start)
  const today = events.filter((e) => e.start < dayStart(now, 1))
  const tomorrow = events.filter((e) => e.start >= dayStart(now, 1))

  // Chat: mentions and direct messages first, then the rest with unread messages
  const rooms = Object.values(account.rooms)
  const waiting = rooms
    .filter((r) => r.unreadMention || (isDirect(r) && r.unreadMessages > 0))
    .sort((a, b) => b.lastActivity - a.lastActivity)
  const otherUnread = rooms.filter((r) => r.unreadMessages > 0 && !waiting.includes(r)).length

  const invitations = cal?.invitations ? openInvitations(accountId) : []
  const notifications = (account.notifications ?? []).filter((n) => n.app !== 'spreed').slice(0, 5)
  const status = account.ownStatus
  const away = absentToday(account.ownAbsence) ? account.ownAbsence : null

  return (
    <main className="center">
      <div className="today-view">
        <header className="today-head">
          <div>
            <h1>
              {greeting(new Date(now).getHours())}, {first}
            </h1>
            <p className="today-date">
              {new Date(now).toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long'
              })}{' '}
              · {account.info.label}
            </p>
          </div>
          <div className="today-me">
            {away && (
              <button
                className="today-chip away"
                onClick={() => setApp({ modal: { type: 'out-of-office', accountId } })}
              >
                <CalendarOff size={15} /> Out of office until {shortDay(away.lastDay)}
              </button>
            )}
            <button className="today-chip" onClick={() => setApp({ modal: { type: 'status', accountId } })}>
              {status?.icon ? <span>{status.icon}</span> : <Smile size={15} />}
              {status?.message ? (
                <>
                  {status.message}
                  {status.clearAt ? (
                    <span className="today-chip-sub">{formatUntil(status.clearAt)}</span>
                  ) : null}
                </>
              ) : (
                'Set a status'
              )}
            </button>
          </div>
        </header>

        <div className="today-grid">
          <Card
            icon={<CalendarDays size={18} />}
            title="Meetings"
            action={
              <button className="link-btn" onClick={() => showCalendar(accountId, true)}>
                Open calendar
              </button>
            }
          >
            {!cal?.upcoming ? (
              <p className="today-empty">Loading your calendar…</p>
            ) : today.length === 0 ? (
              <p className="today-empty">No more meetings today.</p>
            ) : (
              today
                .slice(0, SHOWN)
                .map((e) => <EventRow key={e.id} accountId={accountId} e={e} now={now} color={colorOf(e)} />)
            )}
            {tomorrow.length > 0 && (
              <>
                <div className="today-sub">Tomorrow</div>
                {tomorrow.slice(0, 3).map((e) => (
                  <EventRow key={e.id} accountId={accountId} e={e} now={now} color={colorOf(e)} />
                ))}
              </>
            )}
          </Card>

          <Card icon={<AtSign size={18} />} title="Waiting for you">
            {waiting.length === 0 && threads.length === 0 ? (
              <p className="today-empty">
                Nothing waiting for you.
                {otherUnread > 0 &&
                  ` ${otherUnread} ${otherUnread === 1 ? 'conversation has' : 'conversations have'} new messages.`}
              </p>
            ) : (
              <>
                {waiting.slice(0, SHOWN).map((r) => (
                  <button key={r.token} className="today-row" onClick={() => openRoom(accountId, r.token)}>
                    <RoomIcon accountId={accountId} room={r} />
                    <span className="today-row-text">
                      <span className="today-row-title">{roomTitle(r, account.user?.displayname)}</span>
                      <span className="today-row-sub">{preview(r)}</span>
                    </span>
                    <span className={`today-badge${r.unreadMention ? ' mention' : ''}`}>
                      {r.unreadMention ? '@' : r.unreadMessages}
                    </span>
                  </button>
                ))}
                {threads.length > 0 && (
                  <button className="today-row" onClick={() => showThreadsView(accountId)}>
                    <span className="today-row-icon">
                      <MessagesSquare size={18} />
                    </span>
                    <span className="today-row-text">
                      <span className="today-row-title">
                        {threads.length} {threads.length === 1 ? 'thread has' : 'threads have'} new replies
                      </span>
                    </span>
                  </button>
                )}
                {otherUnread > 0 && (
                  <p className="today-note">
                    And {otherUnread} more {otherUnread === 1 ? 'conversation' : 'conversations'} with new
                    messages.
                  </p>
                )}
              </>
            )}
          </Card>

          {invitations.length > 0 && (
            <Card icon={<CalendarCheck size={18} />} title={`Invitations · ${invitations.length}`}>
              {invitations.slice(0, 4).map((e) => (
                <InvitationRow key={e.uid} accountId={accountId} e={e} />
              ))}
            </Card>
          )}

          <Card icon={<Bell size={18} />} title="Notifications">
            {notifications.length === 0 ? (
              <p className="today-empty">No other notifications.</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.notification_id}
                  className="today-row"
                  onClick={() => openNotification(accountId, n)}
                >
                  <span className="today-row-text">
                    <span className="today-row-title">{n.subject}</span>
                    {n.message && <span className="today-row-sub">{n.message}</span>}
                  </span>
                </button>
              ))
            )}
          </Card>
        </div>
      </div>
    </main>
  )
}

function Card({
  icon,
  title,
  action,
  children
}: {
  icon: ReactNode
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="today-card">
      <div className="today-card-head">
        <span className="today-card-icon">{icon}</span>
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function EventRow({
  accountId,
  e,
  now,
  color
}: {
  accountId: string
  e: CalendarEvent
  now: number
  color?: string
}) {
  const live = e.start - 10 * 60_000 <= now && now < e.end
  const joinable = !!e.talkToken || !!e.onlineMeeting
  return (
    <div className={`today-row today-event${live ? ' live' : ''}`} onClick={() => openEvent(accountId, e)}>
      <span className="today-event-time">{timeLabel(e, now)}</span>
      <span className="today-event-bar" style={{ ['--c' as string]: color ?? 'var(--button-bg)' }} />
      <span className="today-row-text">
        <span className="today-row-title">{e.title}</span>
        <span className="today-row-sub">{formatEventTime(e)}</span>
      </span>
      {joinable && (
        <button
          className={`ev-btn${live ? '' : ' light'}`}
          onClick={(ev) => {
            ev.stopPropagation()
            if (e.talkToken) joinEventCall(accountId, e)
            else if (e.onlineMeeting) void window.hubbub.app.openExternal(e.onlineMeeting.url)
          }}
        >
          <Video size={15} /> Join
        </button>
      )}
    </div>
  )
}

const ANSWERS: { answer: Answer; label: string }[] = [
  { answer: 'ACCEPTED', label: 'Yes' },
  { answer: 'TENTATIVE', label: 'Maybe' },
  { answer: 'DECLINED', label: 'No' }
]

function InvitationRow({ accountId, e }: { accountId: string; e: CalendarEvent }) {
  return (
    <div className="today-row today-invite">
      <span className="today-row-text" onClick={() => openEvent(accountId, e)}>
        <span className="today-row-title">{e.title}</span>
        <span className="today-row-sub">
          {new Date(e.start).toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short'
          })}{' '}
          · {formatEventTime(e)}
          {e.organizer ? ` · ${e.organizer.name || e.organizer.email}` : ''}
        </span>
      </span>
      <span className="today-rsvp">
        {ANSWERS.map((a) => (
          <button
            key={a.answer}
            className="ev-btn light"
            onClick={() => void answerInvitation(accountId, e, a.answer)}
          >
            {a.label}
          </button>
        ))}
      </span>
    </div>
  )
}

/** One-to-one conversations and group messages */
const isDirect = (r: Room): boolean => r.type === RoomType.OneToOne || isGroupMessage(r)

function preview(r: Room): string {
  const m = r.lastMessage
  if (!m || Array.isArray(m)) return ''
  const who = m.actorDisplayName ? `${m.actorDisplayName.split(' ')[0]}: ` : ''
  return `${who}${toPlainText(m)}`.slice(0, 120)
}

function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })
}

/** "09:00", "All day", or "Now" for something that started on an earlier day */
function timeLabel(e: CalendarEvent, now: number): string {
  if (e.allDay || e.end - e.start >= 20 * 3_600_000) return 'All day'
  if (e.start < dayStart(now)) return 'Now'
  return new Date(e.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
