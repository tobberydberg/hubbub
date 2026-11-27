import { protocol } from 'electron'
import { getAccount, getCredentials } from './accounts'
import { accountSession, authHeaders } from './http'

// hubbub-media://<accountId>/<kind>/... serves avatars, file previews and what AI tasks made (images,
// speech), which require authentication, to <img> and <audio> tags in the renderer.

export const MEDIA_SCHEME = 'hubbub-media'

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

interface CacheEntry {
  body: ArrayBuffer
  type: string
  status: number
  expires: number
}

const cache = new Map<string, CacheEntry>()
const MAX_ENTRIES = 500

function remember(key: string, entry: CacheEntry): void {
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** What a kind of media may be: an image, unless it says otherwise */
const IMAGES = /^image\//

/** A file's type from its first bytes, for servers that send AI task files as octet-stream */
function sniff(body: ArrayBuffer): string | null {
  const b = new Uint8Array(body.slice(0, 12))
  const ascii = (from: number, to: number): string => String.fromCharCode(...b.slice(from, to))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (ascii(0, 4) === 'OggS') return 'audio/ogg'
  if (ascii(0, 4) === 'fLaC') return 'audio/flac'
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4'
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (ascii(0, 3) === 'GIF') return 'image/gif'
  return null
}

function resolveTarget(url: URL): { path: string; ttl: number; accept?: RegExp } | null {
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const [kind, ...rest] = parts
  if (kind === 'avatar' && rest[0] === 'user' && rest[1]) {
    const size = Math.min(Number(rest[2]) || 64, 512)
    return { path: `/index.php/avatar/${encodeURIComponent(rest[1])}/${size}`, ttl: 10 * 60_000 }
  }
  if (kind === 'avatar' && rest[0] === 'room' && rest[1]) {
    const dark = url.searchParams.get('dark') ? '/dark' : ''
    const v = url.searchParams.get('v') ?? ''
    return {
      path: `/ocs/v2.php/apps/spreed/api/v1/room/${encodeURIComponent(rest[1])}/avatar${dark}?v=${encodeURIComponent(v)}`,
      ttl: 30 * 60_000
    }
  }
  // Link preview images, fetched and kept by Nextcloud (so the page's own site never sees the user)
  if (kind === 'reference' && rest[0] && /^[a-f0-9]{16,64}$/i.test(rest[0])) {
    return { path: `/index.php/core/references/preview/${rest[0]}`, ttl: 60 * 60_000 }
  }
  // A file an AI task made: an image, or speech
  if (kind === 'task-file' && /^\d+$/.test(rest[0] ?? '') && /^\d+$/.test(rest[1] ?? '')) {
    return {
      path: `/ocs/v2.php/taskprocessing/tasks/${rest[0]}/file/${rest[1]}`,
      ttl: 60 * 60_000,
      accept: /^(image|audio)\//
    }
  }
  if (kind === 'preview' && rest[0]) {
    const size = Math.min(Number(url.searchParams.get('size')) || 600, 2048)
    return {
      path: `/index.php/core/preview?fileId=${encodeURIComponent(rest[0])}&x=${size}&y=${size}&a=1`,
      ttl: 60 * 60_000
    }
  }
  return null
}

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const accountId = url.hostname
    const target = resolveTarget(url)
    if (!target || !getAccount(accountId)) return new Response('Not found', { status: 404 })

    const key = request.url
    const hit = cache.get(key)
    if (hit && hit.expires > Date.now()) {
      return new Response(hit.body.slice(0), { status: hit.status, headers: { 'Content-Type': hit.type } })
    }

    try {
      const creds = getCredentials(accountId)
      const res = await accountSession(accountId).fetch(creds.serverUrl.replace(/\/+$/, '') + target.path, {
        headers: { ...authHeaders(creds), Accept: target.accept ? '*/*' : 'image/*' }
      })
      const body = await res.arrayBuffer()
      let type = res.headers.get('content-type') || 'application/octet-stream'
      if (target.accept && type.startsWith('application/octet-stream')) type = sniff(body) ?? type
      if (res.ok && (target.accept ?? IMAGES).test(type)) {
        remember(key, { body, type, status: res.status, expires: Date.now() + target.ttl })
        return new Response(body.slice(0), { status: res.status, headers: { 'Content-Type': type } })
      }
      return new Response('Not found', { status: res.status === 200 ? 404 : res.status })
    } catch {
      return new Response('Unavailable', { status: 502 })
    }
  })
}
