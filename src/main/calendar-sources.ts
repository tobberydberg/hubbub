import { createHash, randomBytes } from 'node:crypto'
import { session } from 'electron'
import type {
  BusyBlocking,
  CalendarSourceConfig,
  CalendarSourceInput,
  CalendarSourceKind,
  CalendarSourceTest
} from '@shared/ipc'
import { withCertificateTrust } from './certificates'
import { userAgent } from './http'
import { decryptSecret, encryptSecret, readJson, writeJson } from './storage'

// Calendars from elsewhere that Hubbub reads itself, so private calendars never pass through your
// Nextcloud: a calendar link (Google's secret address, an iCloud or Outlook published calendar) or a
// CalDAV account (iCloud with an app-specific password, Fastmail, another Nextcloud). A link is as
// good as a password: both are kept encrypted like the app passwords, and neither goes to the
// window. Read-only: nothing is ever written to these calendars.

const FILE = 'calendar-sources.json'
const ICLOUD = 'https://caldav.icloud.com/'
const TIMEOUT = 30_000
/** Google's secret address holds the whole history; anything beyond this isn't a calendar */
const MAX_SIZE = 25 * 1024 * 1024

interface Secret {
  value: string
  encrypted: boolean
}

interface Stored {
  id: string
  accountId: string
  kind: CalendarSourceKind
  name: string
  color: string
  where: string
  username?: string
  busy: BusyBlocking | null
  /** A link's address */
  link?: Secret
  password?: Secret
  /** CalDAV: the server as entered, and the calendar home found there */
  server?: string
  home?: string
}

const load = (): Stored[] => readJson<Stored[]>(FILE, [])

const configOf = ({
  link: _l,
  password: _p,
  server: _s,
  home: _h,
  ...config
}: Stored): CalendarSourceConfig => config

export function listSources(): CalendarSourceConfig[] {
  return load().map(configOf)
}

export function removeSource(id: string): CalendarSourceConfig[] {
  writeJson(
    FILE,
    load().filter((s) => s.id !== id)
  )
  feeds.delete(id)
  return listSources()
}

export function removeSourcesOf(accountId: string): void {
  const all = load()
  for (const s of all) if (s.accountId === accountId) feeds.delete(s.id)
  writeJson(
    FILE,
    all.filter((s) => s.accountId !== accountId)
  )
}

/** A calendar link as an https URL (webcal:// is how calendar apps are told to subscribe) */
function linkUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input.trim().replace(/^webcals?:\/\//i, 'https://'))
  } catch {
    throw new Error('That isn’t a web address')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('That isn’t a web address')
  return url
}

function serverUrl(input: string): string {
  const url = linkUrl(/^[a-z]+:\/\//i.test(input.trim()) ? input : `https://${input.trim()}`)
  return url.href
}

function clean(input: CalendarSourceInput): Pick<Stored, 'name' | 'color' | 'busy'> {
  const name = input.name.trim()
  if (!name) throw new Error('The calendar needs a name')
  const color = /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#7a7a7a'
  const busy = input.busy
    ? {
        calendarHref: String(input.busy.calendarHref),
        title: input.busy.title.trim().slice(0, 100) || 'Busy',
        allDay: !!input.busy.allDay
      }
    : null
  return { name, color, busy }
}

/** What a source would be with this input: the stored one changed, or a new one */
function resolve(input: CalendarSourceInput, stored?: Stored): Stored {
  const base: Stored = stored ?? {
    id: randomBytes(6).toString('hex'),
    accountId: input.accountId,
    kind: input.kind,
    name: '',
    color: '',
    where: '',
    busy: null
  }
  if (stored && stored.kind !== input.kind) throw new Error('A source can’t change its kind')
  const next: Stored = { ...base, ...clean(input) }
  if (input.kind === 'link') {
    if (input.url?.trim()) {
      const url = linkUrl(input.url)
      next.link = encryptSecret(url.href)
      next.where = url.host
    }
    if (!next.link) throw new Error('Paste the calendar’s link')
  } else {
    if (input.kind === 'icloud') next.server = ICLOUD
    else if (input.url?.trim()) next.server = serverUrl(input.url)
    if (!next.server) throw new Error('Enter the CalDAV server')
    next.where = new URL(next.server).host
    if (input.username !== undefined) next.username = input.username.trim()
    if (!next.username) throw new Error('Enter the user name')
    if (input.password) next.password = encryptSecret(input.password)
    if (!next.password) throw new Error('Enter the password')
  }
  return next
}

const secret = (s: Secret | undefined): string => (s ? decryptSecret(s.value, s.encrypted) : '')

export async function testSource(input: CalendarSourceInput): Promise<CalendarSourceTest> {
  try {
    const stored = input.id ? load().find((s) => s.id === input.id) : undefined
    const source = resolve(input, stored)
    if (source.kind === 'link') {
      const fetched = await fetchLink(secret(source.link))
      return { ok: true, kind: 'link', text: fetched!.text }
    }
    const home = await discover(source.server!, source.username!, secret(source.password))
    return { ok: true, kind: 'caldav', calendarsXml: await listCalendars({ ...source, home }) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function saveSource(input: CalendarSourceInput): Promise<CalendarSourceConfig[]> {
  const all = load()
  const at = input.id ? all.findIndex((s) => s.id === input.id) : -1
  if (input.id && at < 0) throw new Error('That calendar was removed meanwhile')
  const stored = at >= 0 ? all[at] : undefined
  const next = resolve(input, stored)
  if (next.kind !== 'link') {
    const changed =
      !stored ||
      stored.server !== next.server ||
      stored.username !== next.username ||
      !!input.password ||
      !stored.home
    if (changed) next.home = await discover(next.server!, next.username!, secret(next.password))
  }
  if (at >= 0) all[at] = next
  else all.push(next)
  writeJson(FILE, all)
  feeds.delete(next.id)
  return listSources()
}

function get(id: string): Stored {
  const s = load().find((x) => x.id === id)
  if (!s) throw new Error('Unknown calendar')
  return s
}

// --- HTTP ---------------------------------------------------------------------------------------

const net = (): Electron.Session => withCertificateTrust(session.fromPartition('hubbub-calendar-sources'))

async function request(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  auth?: { username: string; password: string }
): Promise<Response> {
  const headers: Record<string, string> = { 'User-Agent': userAgent(), ...init.headers }
  if (auth) {
    headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`
  }
  try {
    return await net().fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT)
    })
  } catch (err) {
    // Never the address itself: a calendar link is secret
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new Error(
      timedOut ? `${new URL(url).host} didn’t answer` : `${new URL(url).host} couldn’t be reached`
    )
  }
}

async function readText(res: Response): Promise<string> {
  const size = Number(res.headers.get('content-length'))
  if (size > MAX_SIZE) throw new Error('The calendar is too big')
  const text = await res.text()
  if (text.length > MAX_SIZE) throw new Error('The calendar is too big')
  return text
}

// --- Calendar links -----------------------------------------------------------------------------

/** The last version of each link, so an unchanged calendar is neither downloaded nor parsed again */
const feeds = new Map<string, { tag: string; text: string; etag?: string; modified?: string }>()

async function fetchLink(
  link: string,
  known?: { etag?: string; modified?: string }
): Promise<{ text: string; etag?: string; modified?: string } | null> {
  const headers: Record<string, string> = { Accept: 'text/calendar, */*;q=0.5', 'Cache-Control': 'no-cache' }
  if (known?.etag) headers['If-None-Match'] = known.etag
  if (known?.modified) headers['If-Modified-Since'] = known.modified
  const res = await request(link, { headers })
  if (res.status === 304 && known) return null
  if (res.status === 401 || res.status === 403)
    throw new Error('The link doesn’t give access (any more): it may have been reset')
  if (res.status === 404) throw new Error('Nothing at that link (any more): it may have been reset')
  if (!res.ok) throw new Error(`The calendar link answered with HTTP ${res.status}`)
  const text = await readText(res)
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That link doesn’t lead to a calendar')
  return {
    text,
    etag: res.headers.get('etag') ?? undefined,
    modified: res.headers.get('last-modified') ?? undefined
  }
}

export async function sourceFeed(id: string, tag?: string): Promise<{ tag: string; text: string | null }> {
  const source = get(id)
  if (source.kind !== 'link') throw new Error('Not a calendar link')
  const cached = feeds.get(id)
  const fresh = await fetchLink(secret(source.link), cached)
  if (fresh) {
    const next = {
      tag: createHash('sha256').update(fresh.text).digest('hex').slice(0, 16),
      text: fresh.text,
      etag: fresh.etag,
      modified: fresh.modified
    }
    feeds.set(id, next)
    return { tag: next.tag, text: next.tag === tag ? null : next.text }
  }
  // Unchanged on the server
  return { tag: cached!.tag, text: cached!.tag === tag ? null : cached!.text }
}

// --- CalDAV -------------------------------------------------------------------------------------

const decodeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** The href inside a property of a PROPFIND answer, e.g. calendar-home-set */
function hrefIn(xml: string, prop: string): string | null {
  const m = new RegExp(`<(?:[\\w-]+:)?${prop}\\b[^>]*>\\s*<(?:[\\w-]+:)?href\\b[^>]*>([^<]+)<`, 'i').exec(xml)
  return m ? decodeXml(m[1].trim()) : null
}

const auth = (s: { username?: string; password?: Secret }): { username: string; password: string } => ({
  username: s.username ?? '',
  password: secret(s.password)
})

async function propfind(
  url: string,
  depth: 0 | 1,
  props: string,
  credentials: { username: string; password: string }
): Promise<Response> {
  return request(
    url,
    {
      method: 'PROPFIND',
      headers: { Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' },
      body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/"><d:prop>${props}</d:prop></d:propfind>`
    },
    credentials
  )
}

/**
 * Finds the calendars of a CalDAV account (RFC 6764): the address given, or the server's
 * /.well-known/caldav, names the user's principal, which names the calendar home. iCloud answers at
 * caldav.icloud.com and keeps the calendars on a server of its own (pNN-caldav.icloud.com).
 */
async function discover(server: string, username: string, password: string): Promise<string> {
  const credentials = { username, password }
  const tries = [server]
  const wellKnown = new URL('/.well-known/caldav', server).href
  if (!tries.includes(wellKnown)) tries.push(wellKnown)
  let reached = false
  for (const url of tries) {
    let res: Response
    try {
      res = await propfind(url, 0, '<d:current-user-principal/><c:calendar-home-set/>', credentials)
    } catch (err) {
      if (url === server) throw err
      continue
    }
    reached = true
    if (res.status === 401) throw new Error('The server didn’t accept the user name and password')
    if (res.status !== 207) continue
    const base = res.url || url
    const xml = await res.text()
    const home = hrefIn(xml, 'calendar-home-set')
    if (home) return new URL(home, base).href
    const principal = hrefIn(xml, 'current-user-principal')
    if (!principal) continue
    const principalUrl = new URL(principal, base).href
    const res2 = await propfind(principalUrl, 0, '<c:calendar-home-set/>', credentials)
    if (res2.status === 401) throw new Error('The server didn’t accept the user name and password')
    if (res2.status !== 207) continue
    const home2 = hrefIn(await res2.text(), 'calendar-home-set')
    if (home2) return new URL(home2, res2.url || principalUrl).href
  }
  throw new Error(reached ? 'No calendars found at that address' : 'The server couldn’t be reached')
}

const CALENDAR_PROPS =
  '<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><a:calendar-color/><a:calendar-order/><cs:getctag/><d:sync-token/>'

async function listCalendars(source: Stored): Promise<string> {
  if (!source.home) throw new Error('The calendars weren’t found yet')
  const res = await propfind(source.home, 1, CALENDAR_PROPS, auth(source))
  if (res.status === 401) throw new Error('The server didn’t accept the user name and password (any more)')
  if (res.status !== 207) throw new Error(`The server answered with HTTP ${res.status}`)
  return readText(res)
}

export async function sourceCalendars(id: string): Promise<string> {
  const source = get(id)
  if (source.kind === 'link') throw new Error('Not a CalDAV account')
  return listCalendars(source)
}

const UTC_STAMP = /^\d{8}T\d{6}Z$/

/** A calendar's events in a time range, repeating ones as they are (the window expands them) */
export async function sourceEvents(id: string, href: string, start: string, end: string): Promise<string> {
  const source = get(id)
  if (source.kind === 'link' || !source.home) throw new Error('Not a CalDAV account')
  if (!UTC_STAMP.test(start) || !UTC_STAMP.test(end)) throw new Error('Invalid time range')
  const home = new URL(source.home)
  const url = new URL(href, home)
  // Only calendars in this account's calendar home
  if (
    url.origin !== home.origin ||
    !url.pathname.startsWith(home.pathname) ||
    url.pathname.includes('/../')
  ) {
    throw new Error('Not one of this account’s calendars')
  }
  const range = `start="${start}" end="${end}"`
  const res = await request(
    url.href,
    {
      method: 'REPORT',
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: `<?xml version="1.0"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`
    },
    auth(source)
  )
  if (res.status === 401) throw new Error('The server didn’t accept the user name and password (any more)')
  if (res.status !== 207) throw new Error(`The server answered with HTTP ${res.status}`)
  return readText(res)
}
