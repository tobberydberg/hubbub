import {
  parseCalendarList,
  parseEvents,
  utcStamp,
  type CalendarEvent,
  type CalendarInfo
} from '@renderer/lib/caldav'
import { addDays, startOfDay, viewRange } from '@renderer/lib/calendar-time'
import { setApp, useApp } from '@renderer/store/app'
import { updateCalendars, useCalendar, type EventSet } from '@renderer/store/calendar'
import { usePrefs } from '@renderer/store/prefs'
import { requestCall } from '@renderer/calls/call'
import { openRoom } from './actions'

// Keeps each server's calendars and events current: the calendar list (cheap) every 30 seconds, and
// events again only for calendars whose change tag moved, so edits in Nextcloud Calendar or on a
// phone show up within half a minute. The next day's events are kept for the next-meeting strip.

const POLL = 30_000
const UPCOMING_HOURS = 24

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const addresses = new Map<string, string[]>()

/**
 * Your email addresses as your calendar knows them: the main one and the additional ones from your
 * Nextcloud personal settings. Invitations to these are yours, and answers go out from them.
 */
export function myAddresses(accountId: string): string[] {
  const email = useApp.getState().accounts[accountId]?.user?.email
  const known = addresses.get(accountId) ?? []
  return [...new Set([...(email ? [email.toLowerCase()] : []), ...known])]
}

/** Loads your calendar addresses (once per server and session, again after a failure) */
async function loadMyAddresses(accountId: string): Promise<void> {
  if (addresses.has(accountId)) return
  const userId = useApp.getState().accounts[accountId]?.info.userId
  if (!userId) return
  try {
    const list = await window.hubbub.calendarAddresses(accountId, userId)
    addresses.set(
      accountId,
      list.map((a) => a.replace(/^mailto:/i, '').toLowerCase()).filter((a) => a.includes('@'))
    )
  } catch {
    // The main address is enough for now
  }
}

function context(accountId: string, calendarHref: string): Parameters<typeof parseEvents>[1] {
  const account = useApp.getState().accounts[accountId]
  return {
    calendarHref,
    serverUrl: account?.info.serverUrl ?? '',
    myEmails: myAddresses(accountId)
  }
}

type SetName = 'view' | 'upcoming' | 'invitations'

async function fetchEvents(
  accountId: string,
  calendar: CalendarInfo,
  start: number,
  end: number,
  unanswered = false
): Promise<CalendarEvent[]> {
  const xml = await window.hubbub.calendarEvents(
    accountId,
    calendar.href,
    utcStamp(start),
    utcStamp(end),
    unanswered
  )
  return parseEvents(xml, context(accountId, calendar.href)).filter((e) => e.status !== 'CANCELLED')
}

/** Fetches a range for the given calendars (all when omitted), keeping the others as they are. */
async function fill(
  accountId: string,
  which: SetName,
  start: number,
  end: number,
  only?: CalendarInfo[]
): Promise<void> {
  const calendars = only ?? useCalendar.getState().accounts[accountId]?.calendars ?? []
  const results = await Promise.all(
    calendars.map(async (c) => {
      try {
        return [c, await fetchEvents(accountId, c, start, end, which === 'invitations')] as const
      } catch {
        return [c, null] as const
      }
    })
  )
  updateCalendars(accountId, (a) => {
    const prev = a[which]
    const set: EventSet =
      prev && prev.start === start && prev.end === end && only
        ? prev
        : { start, end, byCalendar: {}, ctags: {} }
    for (const [c, events] of results) {
      if (!events) continue
      set.byCalendar[c.href] = events
      set.ctags[c.href] = c.ctag
    }
    a[which] = set
  })
}

/** Reloads the calendar list; returns it, or null if that failed. */
async function loadCalendarList(accountId: string): Promise<CalendarInfo[] | null> {
  const account = useApp.getState().accounts[accountId]
  if (!account) return null
  try {
    const calendars = parseCalendarList(await window.hubbub.calendars(accountId), account.info.userId)
    updateCalendars(accountId, (a) => {
      a.calendars = calendars
      a.error = undefined
    })
    return calendars
  } catch (err) {
    updateCalendars(accountId, (a) => void (a.error = errorText(err)))
    return null
  }
}

const upcomingRange = (): [number, number] => {
  const now = Date.now()
  // Whole quarter hours, so the range stays the same between polls
  const start = now - (now % 900_000) - 3_600_000
  return [start, start + UPCOMING_HOURS * 3_600_000]
}

const INVITATION_DAYS = 90

const invitationRange = (): [number, number] => {
  const today = startOfDay(Date.now())
  return [today, addDays(today, INVITATION_DAYS)]
}

/**
 * Invitations the user hasn't answered, from today on: each event once (its next occurrence),
 * whichever calendar it is in, even a hidden one, since they wait for an answer.
 */
export function openInvitations(accountId: string): CalendarEvent[] {
  const set = useCalendar.getState().accounts[accountId]?.invitations
  if (!set) return []
  const now = Date.now()
  const seen = new Set<string>()
  return Object.values(set.byCalendar)
    .flat()
    .filter((e) => e.myAnswer === 'NEEDS-ACTION' && e.end > now)
    .sort((a, b) => a.start - b.start)
    .filter((e) => (seen.has(e.uid) ? false : (seen.add(e.uid), true)))
}

/** Brings one server's calendars up to date for the date and view on screen. */
export async function refreshCalendars(accountId: string, force = false): Promise<void> {
  await loadMyAddresses(accountId)
  const calendars = await loadCalendarList(accountId)
  if (!calendars) return
  const state = useCalendar.getState()
  const a = state.accounts[accountId]
  const showing = calendarShown(accountId)

  const sets: [SetName, number, number][] = [
    ['upcoming', ...upcomingRange()],
    ['invitations', ...invitationRange()]
  ]
  if (showing) {
    const { start, end } = viewRange(usePrefs.getState().calendarView, state.date)
    sets.push(['view', start, end])
  }
  await Promise.all(
    sets.map(([which, start, end]) => {
      const set = a?.[which]
      const sameRange = set && set.start === start && set.end === end
      if (force || !sameRange) return fill(accountId, which, start, end)
      const changed = calendars.filter((c) => set.ctags[c.href] !== c.ctag)
      return changed.length ? fill(accountId, which, start, end, changed) : undefined
    })
  )
}

/** Whether this server's calendar is on screen */
export function calendarShown(accountId: string): boolean {
  const s = useApp.getState()
  return s.activeAccountId === accountId && s.accounts[accountId]?.view === 'calendar'
}

/** Shows a server's calendar, or its chat again. */
export function showCalendar(accountId: string, on: boolean): void {
  setApp((s) => {
    const a = s.accounts[accountId]
    if (!a) return
    s.activeAccountId = accountId
    a.view = on ? 'calendar' : 'room'
    // The event panel belongs to the calendar, the rest to the chat
    if (s.rhs && (on || s.rhs.type === 'event')) s.rhs = null
  })
  if (on) void loadView(accountId)
}

/** Loads the range on screen, after the date or view changed. */
export async function loadView(accountId: string): Promise<void> {
  updateCalendars(accountId, (a) => void (a.loading = true))
  try {
    if (!useCalendar.getState().accounts[accountId]?.calendars) await loadCalendarList(accountId)
    const { start, end } = viewRange(usePrefs.getState().calendarView, useCalendar.getState().date)
    await fill(accountId, 'view', start, end)
  } finally {
    updateCalendars(accountId, (a) => void (a.loading = false))
  }
}

export function setCalendarDate(accountId: string, date: number): void {
  useCalendar.setState({ date })
  void loadView(accountId)
}

let timer: ReturnType<typeof setInterval> | null = null

/** Starts keeping every server's calendars current (once). */
export function startCalendarSync(): void {
  if (timer) return
  const tick = (): void => {
    const s = useApp.getState()
    for (const [id, account] of Object.entries(s.accounts)) {
      if (account.status === 'online') void refreshCalendars(id)
    }
  }
  timer = setInterval(tick, POLL)
  setTimeout(tick, 3_000)
  // Coming back to the app: check right away
  window.addEventListener('focus', tick)
}

/** The events of the next day in shown calendars, for strips and reminders */
export function upcomingEvents(accountId: string): CalendarEvent[] {
  const a = useCalendar.getState().accounts[accountId]
  const hidden = usePrefs.getState().hiddenCalendars[accountId] ?? []
  if (!a?.upcoming) return []
  const now = Date.now()
  return Object.entries(a.upcoming.byCalendar)
    .filter(([href]) => !hidden.includes(href))
    .flatMap(([, events]) => events)
    .filter((e) => e.end > now && e.start < addDays(now, 1))
    .sort((x, y) => x.start - y.start)
}

/** An event on screen or coming up, by id */
export function findEvent(accountId: string, id: string): CalendarEvent | undefined {
  const a = useCalendar.getState().accounts[accountId]
  for (const set of [a?.view, a?.upcoming]) {
    for (const events of Object.values(set?.byCalendar ?? {})) {
      const found = events.find((e) => e.id === id)
      if (found) return found
    }
  }
  return undefined
}

export function openEvent(accountId: string, event: CalendarEvent): void {
  setApp({ rhs: { type: 'event', accountId, eventId: event.id } })
}

/** Joins the event's Talk call in Hubbub, or opens it in the browser for a conversation we're not in. */
export function joinEventCall(accountId: string, event: CalendarEvent): void {
  const token = event.talkToken
  const account = useApp.getState().accounts[accountId]
  if (!token || !account) return
  if (account.rooms[token]) void requestCall(accountId, token)
  else
    void window.hubbub.app.openExternal(
      `${account.info.serverUrl.replace(/\/+$/, '')}/index.php/call/${token}`
    )
}

/** Opens the event's Talk conversation in the chat. */
export function openEventChat(accountId: string, event: CalendarEvent): void {
  const token = event.talkToken
  if (!token) return
  showCalendar(accountId, false)
  openRoom(accountId, token)
}

/** The event in Nextcloud Calendar on the web (its day) */
export function nextcloudCalendarUrl(accountId: string, day: number): string {
  const server = useApp.getState().accounts[accountId]?.info.serverUrl.replace(/\/+$/, '') ?? ''
  const d = new Date(day)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${server}/index.php/apps/calendar/timeGridDay/${date}`
}
