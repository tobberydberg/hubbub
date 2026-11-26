import { app, session, type Session } from 'electron'
import { cleanEtag } from '@shared/etag'
import type { OcsRequest, OcsResponse, QueryValue } from '@shared/ipc'
import { withCertificateTrust } from './certificates'

export interface Credentials {
  id: string
  serverUrl: string
  loginName: string
  appPassword: string
}

const inflight = new Map<string, AbortController>()

export function userAgent(): string {
  const os =
    { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform as string] ?? process.platform
  return `Hubbub/${app.getVersion()} (${os})`
}

/** Each account gets its own in-memory session so cookies never leak between accounts on the same server. */
export function accountSession(accountId: string): Session {
  return withCertificateTrust(session.fromPartition(`hubbub-account-${accountId}`))
}

export function buildUrl(serverUrl: string, path: string, query?: Record<string, QueryValue>): string {
  if (!path.startsWith('/') || path.includes('://') || path.includes('..')) {
    throw new Error(`Invalid request path: ${path}`)
  }
  const url = new URL(serverUrl.replace(/\/+$/, '') + path)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(`${key}[]`, String(v))
    } else {
      url.searchParams.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
    }
  }
  return url.toString()
}

export function authHeaders(creds: Credentials): Record<string, string> {
  const token = Buffer.from(`${creds.loginName}:${creds.appPassword}`, 'utf8').toString('base64')
  return {
    Authorization: `Basic ${token}`,
    'OCS-APIRequest': 'true',
    Accept: 'application/json',
    'User-Agent': userAgent()
  }
}

/** Performs an authenticated request against the account's server, unwrapping the OCS envelope. */
export async function ocsRequest(creds: Credentials, req: OcsRequest): Promise<OcsResponse> {
  const controller = new AbortController()
  if (req.requestId) inflight.set(req.requestId, controller)
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 30_000)

  try {
    const headers = authHeaders(creds)
    if (req.ifNoneMatch) headers['If-None-Match'] = req.ifNoneMatch
    let body: string | undefined
    if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(req.body)
    }
    const res = await accountSession(creds.id).fetch(buildUrl(creds.serverUrl, req.path, req.query), {
      method: req.method,
      headers,
      body,
      signal: controller.signal
    })

    const outHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      if (k.startsWith('x-') || k === 'etag') outHeaders[k] = v
    })

    if (res.status === 304) return { ok: true, status: 304, data: null, headers: outHeaders }

    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // Non-JSON response (e.g. HTML error page from a proxy)
    }
    const ocs = (json as { ocs?: { data?: unknown; meta?: { message?: string } } } | null)?.ocs
    const data = ocs ? (ocs.data ?? null) : json
    const ok = res.status >= 200 && res.status < 300
    let error: string | undefined
    if (!ok) {
      error =
        res.status === 401
          ? 'unauthorized'
          : ocs?.meta?.message ||
            (data && typeof data === 'object' && 'error' in data ? String(data.error) : '') ||
            `HTTP ${res.status}`
    }
    return { ok, status: res.status, data, headers: outHeaders, error }
  } catch (err) {
    const aborted = controller.signal.aborted
    return {
      ok: false,
      status: 0,
      data: null,
      headers: {},
      error: aborted ? 'aborted' : err instanceof Error ? err.message : String(err)
    }
  } finally {
    clearTimeout(timer)
    if (req.requestId) inflight.delete(req.requestId)
  }
}

export function abortRequest(requestId: string): void {
  inflight.get(requestId)?.abort()
}

/** Uploads a file to the user's files over WebDAV. */
export async function davUpload(
  creds: Credentials,
  userId: string,
  remotePath: string,
  data: ArrayBuffer,
  contentType?: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  // If-None-Match: * makes the server refuse to overwrite an existing file (412)
  const encoded = remotePath
    .split('/')
    .filter(Boolean)
    .map((p) => encodeURIComponent(p))
    .join('/')
  const url = `${creds.serverUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(userId)}/${encoded}`
  try {
    const res = await accountSession(creds.id).fetch(url, {
      method: 'PUT',
      headers: {
        ...authHeaders(creds),
        'Content-Type': contentType || 'application/octet-stream',
        'If-None-Match': '*'
      },
      body: Buffer.from(data)
    })
    return {
      ok: res.ok,
      status: res.status,
      error: res.ok ? undefined : `Upload failed (HTTP ${res.status})`
    }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Creates a folder over WebDAV; succeeds silently if it already exists. */
export async function davMkcol(creds: Credentials, userId: string, remotePath: string): Promise<void> {
  const parts = remotePath.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current += '/' + encodeURIComponent(part)
    const url = `${creds.serverUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(userId)}${current}`
    await accountSession(creds.id)
      .fetch(url, { method: 'MKCOL', headers: authHeaders(creds) })
      .catch(() => undefined)
  }
}

const FILES_PROPFIND = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:getcontenttype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <oc:fileid/>
    <oc:size/>
    <nc:has-preview/>
    <oc:permissions/>
  </d:prop>
</d:propfind>`

/** A folder of the user's files (PROPFIND, depth 1) as WebDAV XML; read-only. */
export async function davFolder(creds: Credentials, userId: string, path: string): Promise<string> {
  const parts = path.split('/').filter(Boolean)
  if (parts.some((p) => p === '..' || p === '.')) throw new Error('Invalid path')
  const encoded = parts.map((p) => encodeURIComponent(p)).join('/')
  const url = `${creds.serverUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(userId)}/${encoded}${encoded ? '/' : ''}`
  const res = await accountSession(creds.id).fetch(url, {
    method: 'PROPFIND',
    headers: { ...authHeaders(creds), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: FILES_PROPFIND
  })
  if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

const addressBookHome = (creds: Credentials, userId: string): string =>
  `${creds.serverUrl.replace(/\/+$/, '')}/remote.php/dav/addressbooks/users/${encodeURIComponent(userId)}/`

/** The user's address books (PROPFIND, depth 1) as CardDAV XML; read-only. */
export async function davAddressBooks(creds: Credentials, userId: string): Promise<string> {
  const res = await accountSession(creds.id).fetch(addressBookHome(creds, userId), {
    method: 'PROPFIND',
    headers: { ...authHeaders(creds), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:prop><d:displayname/><d:resourcetype/><cs:getctag/></d:prop></d:propfind>`
  })
  if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** All contacts (vCards) of one of the user's address books as CardDAV XML; read-only. */
export async function davContacts(creds: Credentials, userId: string, href: string): Promise<string> {
  const home = new URL(addressBookHome(creds, userId))
  const url = new URL(href, home)
  if (
    url.origin !== home.origin ||
    !url.pathname.startsWith(home.pathname) ||
    url.pathname.includes('/../')
  ) {
    throw new Error('Not one of your address books')
  }
  const res = await accountSession(creds.id).fetch(url.toString(), {
    method: 'REPORT',
    headers: { ...authHeaders(creds), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0"?><card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><card:address-data/></d:prop></card:addressbook-query>`
  })
  if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

const CALENDARS_PROPFIND = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"
  xmlns:cs="http://calendarserver.org/ns/" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.com/ns">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:current-user-privilege-set/>
    <c:supported-calendar-component-set/>
    <a:calendar-color/>
    <a:calendar-order/>
    <cs:getctag/>
    <oc:owner-principal/>
    <nc:owner-displayname/>
    <oc:read-only/>
  </d:prop>
</d:propfind>`

const calendarHome = (creds: Credentials, userId: string): string =>
  `${creds.serverUrl.replace(/\/+$/, '')}/remote.php/dav/calendars/${encodeURIComponent(userId)}/`

/** The user's calendars as CalDAV XML (PROPFIND, depth 1); read-only. */
export async function davCalendars(creds: Credentials, userId: string): Promise<string> {
  const res = await accountSession(creds.id).fetch(calendarHome(creds, userId), {
    method: 'PROPFIND',
    headers: { ...authHeaders(creds), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: CALENDARS_PROPFIND
  })
  if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** A path inside the user's calendar home as a full URL, or an error for anything else */
function calendarUrl(creds: Credentials, userId: string, href: string): string {
  const home = new URL(calendarHome(creds, userId))
  const url = new URL(href, home)
  if (
    url.origin !== home.origin ||
    !url.pathname.startsWith(home.pathname) ||
    url.pathname.includes('/../')
  ) {
    throw new Error('Not one of your calendars')
  }
  return url.toString()
}

export interface DavObject {
  status: number
  body: string
  etag: string | null
}

/**
 * Reads, writes or deletes one event (.ics) in the user's own calendars. Writes carry the ETag the
 * event was read with (If-Match), or If-None-Match for a new one, so a change made elsewhere in the
 * meantime is never overwritten.
 */
export async function davObject(
  creds: Credentials,
  userId: string,
  req: {
    method: 'GET' | 'PUT' | 'DELETE' | 'MOVE'
    href: string
    body?: string
    etag?: string | null
    /** MOVE: the calendar the event goes to */
    destination?: string
  }
): Promise<DavObject> {
  const url = calendarUrl(creds, userId, req.href)
  if (!url.endsWith('.ics')) throw new Error('Not an event')
  const headers: Record<string, string> = { ...authHeaders(creds) }
  if (req.method === 'MOVE') {
    // Into another of the user's calendars under the same name. Nextcloud moves it as it is, without
    // telling the organizer or the invited people anything.
    const target = calendarUrl(creds, userId, req.destination ?? '')
    headers.Destination = `${target.replace(/\/?$/, '/')}${url.split('/').pop()}`
    headers.Overwrite = 'F'
    if (req.etag) headers['If-Match'] = req.etag
  } else if (req.method === 'PUT') {
    headers['Content-Type'] = 'text/calendar; charset=utf-8'
    if (req.etag) headers['If-Match'] = req.etag
    else headers['If-None-Match'] = '*'
  } else if (req.method === 'DELETE' && req.etag) {
    headers['If-Match'] = req.etag
  }
  // Always checked with the server: the calendar sends no caching rules, so Chromium would keep an
  // event for a while by guessing, and a change would then be made to an old version (412 on saving)
  if (req.method === 'GET') headers['Cache-Control'] = 'no-cache'
  const res = await accountSession(creds.id).fetch(url, { method: req.method, headers, body: req.body })
  const body = req.method === 'GET' ? await res.text() : ''
  let etag = cleanEtag(res.headers.get('etag'))
  // The ETag a GET reports can be altered on the way (Apache's compression appends -gzip, which the
  // next If-Match then never matches): for writing back, take the one the calendar itself keeps
  if (req.method === 'GET' && res.status === 200) etag = (await davEtag(creds, url)) ?? etag
  return { status: res.status, body, etag }
}

/** An event's ETag as its calendar keeps it (PROPFIND getetag) */
async function davEtag(creds: Credentials, url: string): Promise<string | null> {
  try {
    const res = await accountSession(creds.id).fetch(url, {
      method: 'PROPFIND',
      headers: { ...authHeaders(creds), Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>'
    })
    if (res.status !== 207) return null
    const value = /<(?:[\w-]+:)?getetag>([^<]+)</.exec(await res.text())?.[1]
    return value ? cleanEtag(value.replace(/&quot;/g, '"')) : null
  } catch {
    return null
  }
}

/** Someone's calendar addresses (mailto:…), as other calendar apps look them up for invitations */
export async function davPrincipalAddresses(creds: Credentials, otherUserId: string): Promise<string[]> {
  if (!/^[^/\\]+$/.test(otherUserId)) throw new Error('Invalid user')
  const url = `${creds.serverUrl.replace(/\/+$/, '')}/remote.php/dav/principals/users/${encodeURIComponent(otherUserId)}/`
  const res = await accountSession(creds.id).fetch(url, {
    method: 'PROPFIND',
    headers: { ...authHeaders(creds), Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-user-address-set/></d:prop></d:propfind>`
  })
  if (!res.ok && res.status !== 207) return []
  const xml = await res.text()
  return [...xml.matchAll(/<(?:[\w-]+:)?href>(mailto:[^<]+)<\/(?:[\w-]+:)?href>/gi)].map((m) => m[1])
}

/** The path and ETag of the event with this UID in one of the user's calendars, or null */
export async function davFindByUid(
  creds: Credentials,
  userId: string,
  calendarHref: string,
  uid: string
): Promise<{ href: string; etag: string | null } | null> {
  const url = calendarUrl(creds, userId, calendarHref)
  const escaped = uid.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
  // CalDAV can only search for a UID containing the text, so the answers are checked for the exact UID
  const res = await accountSession(creds.id).fetch(url, {
    method: 'REPORT',
    headers: { ...authHeaders(creds), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match collation="i;octet">${escaped}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`
  })
  if (!res.ok && res.status !== 207) return null
  const xml = await res.text()
  for (const response of xml.split(/<\/(?:[\w-]+:)?response>/)) {
    const href = /<(?:[\w-]+:)?href>([^<]+\.ics)<\/(?:[\w-]+:)?href>/.exec(response)?.[1]
    const data =
      /<(?:[\w-]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?calendar-data>/.exec(response)?.[1] ?? ''
    const unfolded = decodeXml(data).replace(/\r?\n[ \t]/g, '')
    const uids = [...unfolded.matchAll(/^UID:(.*?)\r?$/gm)].map((m) => m[1].trim())
    if (!href || !uids.includes(uid)) continue
    const etag = /<(?:[\w-]+:)?getetag>([^<]+)</.exec(response)?.[1]?.replace(/&quot;/g, '"') ?? null
    return { href, etag }
  }
  return null
}

const decodeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')

const UTC_STAMP = /^\d{8}T\d{6}Z$/

/**
 * The events of one of the user's calendars between two times (CalDAV REPORT), with repeating
 * events expanded by the server into their occurrences; read-only. `href` is the calendar's path as
 * the calendar list gives it, and has to be inside the user's own calendar home.
 */
export async function davEvents(
  creds: Credentials,
  userId: string,
  href: string,
  start: string,
  end: string,
  /** Only events with someone who hasn't answered (for the list of open invitations) */
  unanswered = false
): Promise<string> {
  const url = calendarUrl(creds, userId, href)
  if (!UTC_STAMP.test(start) || !UTC_STAMP.test(end)) throw new Error('Invalid time range')
  const range = `start="${start}" end="${end}"`
  const res = await accountSession(creds.id).fetch(url, {
    method: 'REPORT',
    headers: { ...authHeaders(creds), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data><c:expand ${range}/></c:calendar-data></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/>${unanswered ? '<c:prop-filter name="ATTENDEE"><c:param-filter name="PARTSTAT"><c:text-match>NEEDS-ACTION</c:text-match></c:param-filter></c:prop-filter>' : ''}</c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`
  })
  if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/**
 * Adds an email address to the user's account (Nextcloud's "additional email"). Nextcloud wants the
 * password confirmed for this, which an app password doesn't do: with `password` (the user's login
 * password, typed for this one request and not kept) the request is made with it instead.
 */
export async function addAccountEmail(
  creds: Credentials,
  userId: string,
  email: string,
  password?: string
): Promise<{ ok: boolean; needsPassword: boolean; error?: string }> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, needsPassword: false, error: 'Invalid address' }
  let status: number
  let error = ''
  if (!password) {
    const res = await ocsRequest(creds, {
      accountId: creds.id,
      method: 'PUT',
      path: `/ocs/v2.php/cloud/users/${encodeURIComponent(userId)}`,
      body: { key: 'additional_mail', value: email }
    })
    if (res.ok) return { ok: true, needsPassword: false }
    status = res.status
    error = res.error || `HTTP ${res.status}`
  } else {
    // A connection of its own without cookies: with the account's session cookie, Nextcloud would
    // take the request as the app password's session and ignore the password
    const fresh = withCertificateTrust(session.fromPartition(`hubbub-confirm-${Date.now()}`))
    let res: Response
    try {
      res = await fresh.fetch(
        buildUrl(creds.serverUrl, `/ocs/v2.php/cloud/users/${encodeURIComponent(userId)}`),
        {
          method: 'PUT',
          headers: {
            ...authHeaders({ ...creds, appPassword: password }),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ key: 'additional_mail', value: email }),
          signal: AbortSignal.timeout(30_000)
        }
      )
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError'
      return { ok: false, needsPassword: false, error: timedOut ? 'Nextcloud didn’t answer' : String(err) }
    } finally {
      void fresh.clearStorageData().catch(() => undefined)
    }
    if (res.ok) return { ok: true, needsPassword: false }
    status = res.status
    try {
      error = ((await res.json()) as { ocs?: { meta?: { message?: string } } }).ocs?.meta?.message || ''
    } catch {
      // Not JSON
    }
    error ||= `HTTP ${status}`
  }
  const needsPassword = /password confirmation/i.test(error)
  return { ok: false, needsPassword, error: status === 401 && password ? 'Wrong password' : error }
}

/** A whole calendar as one iCalendar file (Nextcloud's ?export), as text */
export async function davExportCalendar(creds: Credentials, userId: string, href: string): Promise<string> {
  const url = calendarUrl(creds, userId, href)
  const res = await accountSession(creds.id).fetch(`${url.replace(/\/?$/, '/')}?export`, {
    headers: { ...authHeaders(creds), Accept: 'text/calendar', 'Cache-Control': 'no-cache' }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}
