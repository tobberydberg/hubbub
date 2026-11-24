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
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:current-user-privilege-set/>
    <c:supported-calendar-component-set/>
    <a:calendar-color/>
  </d:prop>
</d:propfind>`

/** The user's calendars as CalDAV XML (PROPFIND, depth 1); read-only. */
export async function davCalendars(creds: Credentials, userId: string): Promise<string> {
  const url = `${creds.serverUrl.replace(/\/+$/, '')}/remote.php/dav/calendars/${encodeURIComponent(userId)}/`
  const res = await accountSession(creds.id).fetch(url, {
    method: 'PROPFIND',
    headers: { ...authHeaders(creds), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: CALENDARS_PROPFIND
  })
  if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`)
  return res.text()
}
