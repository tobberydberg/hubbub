import { ImapFlow, type MessageStructureObject } from 'imapflow'
import type { ImapConfig, ImapInvitation, ImapSettings, ImapTestResult } from '@shared/ipc'
import { decryptSecret, encryptSecret, readJson, writeJson } from './storage'

// Meeting invitations straight from a mail server (IMAP), for those who don't use Nextcloud Mail.
// The mailbox is opened read-only (EXAMINE), so nothing in it changes: mails stay unread. The
// password is kept like the app passwords, encrypted with the system's keychain, and never goes to
// the window.

const FILE = 'imap.json'

interface Stored extends ImapSettings {
  password?: { value: string; encrypted: boolean }
}

const load = (): Record<string, Stored> => readJson<Record<string, Stored>>(FILE, {})

export function getImapSettings(accountId: string): ImapConfig | null {
  const s = load()[accountId]
  if (!s) return null
  const { password, ...settings } = s
  return { ...settings, hasPassword: !!password }
}

/** Saves the settings; `password` undefined keeps the stored one */
export function setImapSettings(accountId: string, settings: ImapSettings, password?: string): void {
  const all = load()
  const before = all[accountId]
  all[accountId] = {
    ...clean(settings),
    password: password !== undefined ? encryptSecret(password) : before?.password
  }
  writeJson(FILE, all)
}

export function removeImapSettings(accountId: string): void {
  const all = load()
  delete all[accountId]
  writeJson(FILE, all)
}

function clean(s: ImapSettings): ImapSettings {
  const port = Math.round(Number(s.port))
  if (!s.host.trim() || /[\s/]/.test(s.host.trim())) throw new Error('Invalid server name')
  if (!(port > 0 && port < 65536)) throw new Error('Invalid port')
  if (!['tls', 'starttls', 'none'].includes(s.security)) throw new Error('Invalid security')
  return {
    host: s.host.trim(),
    port,
    security: s.security,
    username: s.username.trim(),
    folder: s.folder.trim() || 'INBOX'
  }
}

function client(s: ImapSettings, password: string): ImapFlow {
  return new ImapFlow({
    host: s.host,
    port: s.port,
    secure: s.security === 'tls',
    // Plain connections only when chosen; STARTTLS is required then, not just tried
    doSTARTTLS: s.security === 'starttls' ? true : s.security === 'none' ? false : undefined,
    auth: { user: s.username, pass: password },
    tls: { rejectUnauthorized: true, servername: s.host },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000
  })
}

function credentials(accountId: string): { settings: ImapSettings; password: string } {
  const s = load()[accountId]
  if (!s?.password) throw new Error('No mail server is set up')
  const { password, ...settings } = s
  return { settings, password: decryptSecret(password.value, password.encrypted) }
}

const describe = (err: unknown): string => {
  const e = err as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string }
  if (e?.authenticationFailed) return 'The user name or password was not accepted'
  if (e?.code === 'ENOTFOUND') return 'The server wasn’t found'
  if (e?.code === 'ECONNREFUSED') return 'The server refused the connection; check the port'
  if (e?.code === 'ETIMEDOUT' || e?.code === 'CONNECT_TIMEOUT') return 'The server didn’t answer'
  if (e?.code && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(e.code))
    return 'The server’s certificate isn’t trusted'
  return e?.responseText || e?.message || String(err)
}

/**
 * Tries the settings (with a new password, or the stored one): connects, signs in and opens the
 * folder read-only. Lists the folders for choosing.
 */
export async function testImap(
  accountId: string,
  settings: ImapSettings,
  password?: string
): Promise<ImapTestResult> {
  let s: ImapSettings
  try {
    s = clean(settings)
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
  const pass = password ?? (load()[accountId]?.password ? credentials(accountId).password : '')
  const c = client(s, pass)
  try {
    await c.connect()
    const folders = (await c.list()).map((f) => f.path)
    const lock = await c.getMailboxLock(s.folder, { readOnly: true })
    lock.release()
    return { ok: true, folders }
  } catch (err) {
    return { ok: false, error: describe(err) }
  } finally {
    await c.logout().catch(() => c.close())
  }
}

/** The calendar parts of a message: text/calendar and .ics attachments, also in forwarded mails */
function calendarParts(
  node: MessageStructureObject | undefined,
  out: { part: string; method?: string }[] = []
) {
  if (!node) return out
  const type = node.type?.toLowerCase() ?? ''
  const name = String(node.parameters?.name ?? node.dispositionParameters?.filename ?? '').toLowerCase()
  if (
    type === 'text/calendar' ||
    type === 'application/ics' ||
    (type === 'application/octet-stream' && name.endsWith('.ics'))
  ) {
    out.push({ part: node.part || '1', method: node.parameters?.method })
  }
  for (const child of node.childNodes ?? []) calendarParts(child, out)
  return out
}

async function text(stream: NodeJS.ReadableStream | undefined): Promise<string> {
  if (!stream) return ''
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Invitations in the configured folder from the last days, newest first, leaving out the messages
 * already handled (`skip`, as returned in `id`). At most `limit` messages are read per check.
 */
export async function imapInvitations(
  accountId: string,
  opts: { sinceDays: number; skip: string[]; limit?: number }
): Promise<ImapInvitation[]> {
  const { settings, password } = credentials(accountId)
  const c = client(settings, password)
  const found: ImapInvitation[] = []
  try {
    await c.connect()
    const lock = await c.getMailboxLock(settings.folder, { readOnly: true })
    try {
      const mailbox = c.mailbox
      const validity = mailbox && typeof mailbox === 'object' ? String(mailbox.uidValidity) : '0'
      const skip = new Set(opts.skip)
      const since = new Date(Date.now() - opts.sinceDays * 86_400_000)
      const uids = ((await c.search({ since }, { uid: true })) || [])
        .filter((uid) => !skip.has(`${validity}:${uid}`))
        .sort((a, b) => b - a)
        .slice(0, opts.limit ?? 300)
      if (!uids.length) return []

      // First find the messages with calendar parts, then read those parts (one command at a time)
      const candidates: {
        uid: number
        to: string[]
        subject?: string
        date?: number
        parts: { part: string; method?: string }[]
      }[] = []
      for await (const msg of c.fetch(
        uids.join(','),
        { uid: true, bodyStructure: true, envelope: true },
        { uid: true }
      )) {
        candidates.push({
          uid: msg.uid,
          to: [...(msg.envelope?.to ?? []), ...(msg.envelope?.cc ?? [])]
            .map((a) => a.address?.toLowerCase())
            .filter((a): a is string => !!a),
          subject: msg.envelope?.subject,
          date: msg.envelope?.date ? new Date(msg.envelope.date).getTime() : undefined,
          parts: calendarParts(msg.bodyStructure)
        })
      }
      // Oldest first, so that a later update or cancellation has the last word
      candidates.sort((a, b) => a.uid - b.uid)
      for (const m of candidates) {
        const parts = []
        for (const p of m.parts) {
          const { content } = await c.download(String(m.uid), p.part, { uid: true })
          const ics = await text(content)
          const method = (p.method ?? /^METHOD:(\w+)/im.exec(ics)?.[1] ?? '').toUpperCase()
          parts.push({ method, ics })
        }
        found.push({ id: `${validity}:${m.uid}`, subject: m.subject, date: m.date, to: m.to, parts })
      }
    } finally {
      lock.release()
    }
    return found
  } catch (err) {
    throw new Error(describe(err))
  } finally {
    await c.logout().catch(() => c.close())
  }
}
