import type { CalendarSourceConfig, CalendarSourceInput } from '@shared/ipc'
import { parseCalendarList, utcStamp, type CalendarEvent, type CalendarInfo } from '@renderer/lib/caldav'
import { addDays, startOfDay } from '@renderer/lib/calendar-time'
import { decode, element, text } from '@renderer/lib/calendars'
import { expandCalendar, parseCalendarObjects, type ParsedCalendar } from '@renderer/lib/ics-expand'
import { useApp } from '@renderer/store/app'
import { updateCalendars, useCalendar } from '@renderer/store/calendar'
import { setSourceStatus, useExternal } from '@renderer/store/external'
import { clearBusy, syncBusy } from './busy-time'

// Calendars from elsewhere that Hubbub reads itself (a calendar link, iCloud, another CalDAV
// server), shown in one server's calendar. They're fetched here, on this computer, and never pass
// through Nextcloud. Their events go into the same sets as the server's (under calendar paths that
// start with "ext:"), so the views, Today and the next-meeting strip show them like any other.

/** A link is checked every quarter of an hour, a CalDAV account (cheap when unchanged) every 5 minutes */
const LINK_EVERY = 15 * 60_000
const CALDAV_EVERY = 5 * 60_000
/** Coming back to the app checks sooner, but not more often than this */
const FOCUS_EVERY = 2 * 60_000
/** A CalDAV account's events are fetched for this span around today */
const PAST_DAYS = 400
const FUTURE_DAYS = 800

/** A calendar from elsewhere, as Hubbub refers to it */
export const externalHref = (sourceId: string, key: string): string => `ext:${sourceId}:${key}`
export const isExternal = (href: string): boolean => href.startsWith('ext:')

/** Each calendar's events, parsed once per change, by its ext: path */
const parsed = new Map<string, ParsedCalendar>()
/** What each calendar was last fetched as (a link's hash, a CalDAV calendar's change tag) */
const tags = new Map<string, string>()
/** Each source's calendars as last found */
const found = new Map<string, CalendarInfo[]>()
/** Expanded occurrences per calendar version and range */
const expanded = new WeakMap<ParsedCalendar, Map<string, CalendarEvent[]>>()
const lastTry = new Map<string, number>()
const running = new Map<string, Promise<void>>()

/** A source's calendars as the views know them */
export function sourceCalendars(sourceId: string): CalendarInfo[] {
  return found.get(sourceId) ?? []
}

/** The events of a source's calendars between two times (ms), hidden ones included */
export function sourceEvents(sourceId: string, start: number, end: number): CalendarEvent[] {
  return sourceCalendars(sourceId).flatMap((c) => occurrences(c, start, end))
}

function occurrences(calendar: CalendarInfo, start: number, end: number): CalendarEvent[] {
  const data = parsed.get(calendar.href)
  if (!data) return []
  let cache = expanded.get(data)
  if (!cache) expanded.set(data, (cache = new Map()))
  const key = `${start}|${end}`
  let events = cache.get(key)
  if (!events) {
    const source = useExternal.getState().sources.find((s) => s.id === calendar.source?.id)
    const serverUrl = source ? (useApp.getState().accounts[source.accountId]?.info.serverUrl ?? '') : ''
    events = expandCalendar(data, start, end, { calendarHref: calendar.href, serverUrl, myEmails: [] })
    // A few ranges per calendar are in use at a time (the view, the next day, Today)
    if (cache.size > 12) cache.clear()
    cache.set(key, events)
  }
  return events
}

/** The events of a server's calendars from elsewhere between two times, by calendar */
export function externalEventsIn(
  accountId: string,
  start: number,
  end: number
): Record<string, CalendarEvent[]> {
  const out: Record<string, CalendarEvent[]> = {}
  for (const source of useExternal.getState().sources) {
    if (source.accountId !== accountId) continue
    for (const c of sourceCalendars(source.id)) out[c.href] = occurrences(c, start, end)
  }
  return out
}

/** Whether a source still exists (its busy copies are then hidden in favour of the real events) */
export function knownSource(id: string): boolean {
  return useExternal.getState().sources.some((s) => s.id === id)
}

/** Puts a server's calendars from elsewhere, and their events, into its calendar state */
function publish(accountId: string): void {
  const sources = useExternal.getState().sources.filter((s) => s.accountId === accountId)
  const calendars = sources.flatMap((s) => sourceCalendars(s.id))
  updateCalendars(accountId, (a) => {
    a.external = calendars
    for (const set of [a.view, a.upcoming]) {
      if (!set) continue
      for (const href of Object.keys(set.byCalendar)) if (isExternal(href)) delete set.byCalendar[href]
      Object.assign(set.byCalendar, externalEventsIn(accountId, set.start, set.end))
    }
  })
}

const errorText = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  )

/** The calendar objects in a CalDAV REPORT answer */
function objectsIn(xml: string): { href: string; ics: string }[] {
  return element('response', xml)
    .map((response) => ({
      href: decode(text('href', response)),
      ics: decode(text('calendar-data', response).replace(/^<!\[CDATA\[|\]\]>$/g, ''))
    }))
    .filter((o) => o.ics.includes('BEGIN:VCALENDAR'))
}

async function fetchSource(source: CalendarSourceConfig): Promise<void> {
  const api = window.hubbub.calendarSources
  if (source.kind === 'link') {
    const href = externalHref(source.id, 'feed')
    const { tag, text: body } = await api.feed(source.id, parsed.has(href) ? tags.get(href) : undefined)
    if (body !== null) {
      parsed.set(href, parseCalendarObjects([{ href: 'feed', ics: body }]))
      tags.set(href, tag)
    }
    found.set(source.id, [
      {
        href,
        name: source.name,
        color: source.color,
        order: 0,
        writable: false,
        ctag: tag,
        source: { id: source.id, name: source.name }
      }
    ])
    return
  }
  const list = parseCalendarList(await api.calendars(source.id), '')
  const today = startOfDay(Date.now())
  const [from, to] = [utcStamp(addDays(today, -PAST_DAYS)), utcStamp(addDays(today, FUTURE_DAYS))]
  const calendars: CalendarInfo[] = []
  for (const c of list) {
    const href = externalHref(source.id, c.href)
    // Unchanged since the last time: kept as it is (a server without change tags is asked every time)
    if (!c.ctag || tags.get(href) !== c.ctag || !parsed.has(href)) {
      parsed.set(href, parseCalendarObjects(objectsIn(await api.events(source.id, c.href, from, to))))
      tags.set(href, c.ctag)
    }
    calendars.push({
      ...c,
      href,
      writable: false,
      sharedBy: undefined,
      source: { id: source.id, name: source.name }
    })
  }
  // Calendars removed on the server are forgotten
  for (const old of found.get(source.id) ?? []) {
    if (!calendars.some((c) => c.href === old.href)) {
      parsed.delete(old.href)
      tags.delete(old.href)
    }
  }
  found.set(source.id, calendars)
}

/** Fetches one source (again), shows what changed, and brings its busy time up to date */
export function refreshSource(id: string): Promise<void> {
  const busy = running.get(id)
  if (busy) return busy
  const run = (async () => {
    const source = useExternal.getState().sources.find((s) => s.id === id)
    if (!source) return
    lastTry.set(id, Date.now())
    try {
      await fetchSource(source)
      const count = sourceCalendars(id).reduce((n, c) => n + (parsed.get(c.href)?.series.length ?? 0), 0)
      setSourceStatus(id, { checkedAt: Date.now(), error: undefined, calendars: count })
    } catch (err) {
      setSourceStatus(id, { error: errorText(err) })
    }
    publish(source.accountId)
    if (source.busy && sourceCalendars(id).length) await syncBusy(source)
  })().finally(() => running.delete(id))
  running.set(id, run)
  return run
}

/** Loads the sources from main, shows what's known of them, and fetches them */
export async function loadSources(): Promise<void> {
  const sources = await window.hubbub.calendarSources.list().catch(() => [])
  setSources(sources)
  await Promise.all(sources.map((s) => refreshSource(s.id)))
}

function setSources(sources: CalendarSourceConfig[]): void {
  const before = useExternal.getState().sources
  useExternal.setState({ sources })
  for (const old of before) {
    if (sources.some((s) => s.id === old.id)) continue
    for (const c of found.get(old.id) ?? []) {
      parsed.delete(c.href)
      tags.delete(c.href)
    }
    found.delete(old.id)
  }
  // A changed name or color shows right away
  for (const s of sources) {
    const calendars = found.get(s.id)
    if (!calendars) continue
    found.set(
      s.id,
      calendars.map((c) => ({
        ...c,
        ...(s.kind === 'link' ? { name: s.name, color: s.color } : {}),
        source: { id: s.id, name: s.name }
      }))
    )
  }
  const accounts = new Set([...before, ...sources].map((s) => s.accountId))
  for (const accountId of accounts) if (useCalendar.getState().accounts[accountId]) publish(accountId)
}

/** Adds or changes a source; busy time moves along when its settings change */
export async function saveSource(input: CalendarSourceInput): Promise<CalendarSourceConfig> {
  const before = input.id ? useExternal.getState().sources.find((s) => s.id === input.id) : undefined
  const sources = await window.hubbub.calendarSources.save(input)
  const saved = input.id
    ? sources.find((s) => s.id === input.id)!
    : sources.find((s) => !useExternal.getState().sources.some((o) => o.id === s.id))!
  // Busy time turned off, or going into another calendar: the copies made so far are removed
  if (before?.busy && before.busy.calendarHref !== saved.busy?.calendarHref) {
    await clearBusy(before.accountId, before.busy.calendarHref, before.id).catch(() => undefined)
  }
  setSources(sources)
  // A changed link or account is fetched from scratch
  if (input.url || input.password) for (const c of found.get(saved.id) ?? []) tags.delete(c.href)
  await refreshSource(saved.id)
  return saved
}

/** Removes a source, and the busy time it put into Nextcloud */
export async function removeSource(id: string): Promise<{ busyLeft: boolean }> {
  const source = useExternal.getState().sources.find((s) => s.id === id)
  let busyLeft = false
  if (source?.busy) {
    busyLeft = !(await clearBusy(source.accountId, source.busy.calendarHref, id)
      .then(() => true)
      .catch(() => false))
  }
  setSources(await window.hubbub.calendarSources.remove(id))
  useExternal.setState((s) => void delete s.status[id])
  return { busyLeft }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Starts keeping the calendars from elsewhere current (once) */
export function startExternalSync(): void {
  if (timer) return
  const due = (minimum?: number): void => {
    const now = Date.now()
    for (const s of useExternal.getState().sources) {
      if (useApp.getState().accounts[s.accountId]?.status !== 'online') continue
      const every = minimum ?? (s.kind === 'link' ? LINK_EVERY : CALDAV_EVERY)
      if (now - (lastTry.get(s.id) ?? 0) >= every) void refreshSource(s.id)
    }
  }
  timer = setInterval(() => due(), 60_000)
  window.addEventListener('focus', () => due(FOCUS_EVERY))
  void loadSources()
}
