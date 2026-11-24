import { app, session, type Session } from 'electron'
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
  req: { method: 'GET' | 'PUT' | 'DELETE'; href: string; body?: string; etag?: string | null }
): Promise<DavObject> {
  const url = calendarUrl(creds, userId, req.href)
  if (!url.endsWith('.ics')) throw new Error('Not an event')
  const headers: Record<string, string> = { ...authHeaders(creds) }
  if (req.method === 'PUT') {
    headers['Content-Type'] = 'text/calendar; charset=utf-8'
    if (req.etag) headers['If-Match'] = req.etag
    else headers['If-None-Match'] = '*'
  } else if (req.method === 'DELETE' && req.etag) {
    headers['If-Match'] = req.etag
  }
  const res = await accountSession(creds.id).fetch(url, { method: req.method, headers, body: req.body })
  return {
    status: res.status,
    body: req.method === 'GET' ? await res.text() : '',
    etag: res.headers.get('etag')
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
  end: string
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
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`
  })
  if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`)
  return res.text()
}
