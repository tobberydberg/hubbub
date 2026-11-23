import type { ChatMessage, RichObjectParameter } from '@shared/talk-types'

/** System messages that only carry an update to another message and must not be displayed. */
export const UPDATE_SYSTEM_MESSAGES = new Set([
  'message_deleted',
  'message_edited',
  'reaction',
  'reaction_deleted',
  'reaction_revoked',
  'poll_voted',
  'thread_created',
  'thread_renamed',
  'message_pinned',
  'message_unpinned'
])

/** System messages that are noise in a Mattermost-style timeline. */
export const QUIET_SYSTEM_MESSAGES = new Set(['call_joined', 'call_left', 'history_cleared'])

export const MENTION_SCHEME = 'hubbub-mention:'

export function params(m: ChatMessage): Record<string, RichObjectParameter> {
  return Array.isArray(m.messageParameters) ? {} : m.messageParameters
}

export function reactions(m: ChatMessage): Record<string, number> {
  return Array.isArray(m.reactions) || !m.reactions ? {} : m.reactions
}

export function isExpired(m: ChatMessage, now = Date.now() / 1000): boolean {
  return !!m.expirationTimestamp && m.expirationTimestamp > 0 && m.expirationTimestamp < now
}

/** Whether the message should appear in a timeline at all. */
export function isDisplayable(m: ChatMessage): boolean {
  if (
    m.systemMessage &&
    (UPDATE_SYSTEM_MESSAGES.has(m.systemMessage) || QUIET_SYSTEM_MESSAGES.has(m.systemMessage))
  ) {
    return false
  }
  return !isExpired(m)
}

// Talk sets threadId on every message (the topmost parent's id, or its own id) and isThread on
// every message that belongs to a native thread (Talk 22+), root included.

/** True for replies inside a native Talk thread (which belong in the thread panel, not the channel). */
export function isThreadReply(m: ChatMessage): boolean {
  return !!m.isThread && !!m.threadId && m.threadId !== m.id
}

/** True for the first message of a native Talk thread. */
export function isThreadRoot(m: ChatMessage): boolean {
  return !!m.isThread && (!m.threadId || m.threadId === m.id)
}

/**
 * The message a reply chain or thread starts from. Talk 22+ sends the topmost parent as threadId;
 * older servers only send the direct parent, so walk up through `byId` when it is given.
 */
export function rootOf(m: ChatMessage, byId?: Record<number, ChatMessage>): number {
  let cur = m
  for (let depth = 0; depth < 50; depth++) {
    if (cur.threadId) return cur.threadId
    if (!isFullMessage(cur.parent)) return cur.id
    const up: ChatMessage | undefined = byId?.[cur.parent.id]
    if (!up) return cur.parent.id
    cur = up
  }
  return cur.id
}

/** Whether `m` belongs to the reply chain or thread started by `rootId` (excluding the root itself). */
export function belongsTo(m: ChatMessage, rootId: number, byId?: Record<number, ChatMessage>): boolean {
  return m.id !== rootId && rootOf(m, byId) === rootId
}

/**
 * Whether a message is hidden from the channel because it is shown in a thread instead.
 * With collapsed reply threads every reply is collapsed, as long as its root is loaded (so it can carry
 * the "N replies" footer); otherwise only replies inside native Talk threads are.
 */
export function isCollapsedReply(
  m: ChatMessage,
  byId: Record<number, ChatMessage>,
  opts: { collapseReplies: boolean; nativeThreads: boolean }
): boolean {
  if (opts.nativeThreads && isThreadReply(m)) return true
  if (!opts.collapseReplies || m.systemMessage) return false
  const root = rootOf(m, byId)
  return root !== m.id && !!byId[root]
}

export function isFullMessage(p: ChatMessage['parent']): p is ChatMessage {
  return !!p && !('deleted' in p && p.deleted === true && !('message' in p))
}

const PLACEHOLDER = /\{([a-z0-9_-]+)\}/gi

const MENTION_TYPES = new Set([
  'user',
  'guest',
  'user-group',
  'group',
  'call',
  'federated_user',
  'circle',
  'email'
])

function escapeMarkdownLabel(s: string): string {
  return s.replace(/[[\]\\*_`]/g, (c) => `\\${c}`)
}

export interface RenderableMessage {
  /** Markdown with mentions turned into hubbub-mention: links */
  markdown: string
  /** File attachments referenced by the message */
  files: RichObjectParameter[]
  /** Whether the current user (or everyone) is mentioned */
  mentionsSelf: boolean
}

export function toRenderable(m: ChatMessage, selfId: string | undefined): RenderableMessage {
  const p = params(m)
  const files: RichObjectParameter[] = []
  let mentionsSelf = false

  const markdown = m.message.replace(PLACEHOLDER, (whole, key: string) => {
    const param = p[key]
    if (!param) return whole
    if (param.type === 'file') {
      files.push(param)
      return ''
    }
    if (MENTION_TYPES.has(param.type)) {
      const isSelf = (param.type === 'user' && param.id === selfId) || param.type === 'call'
      if (isSelf) mentionsSelf = true
      const href = `${MENTION_SCHEME}${param.type}/${encodeURIComponent(param.id)}${isSelf ? '/self' : ''}`
      return `[@${escapeMarkdownLabel(param.name)}](${href})`
    }
    if (param.link) return `[${escapeMarkdownLabel(param.name)}](${param.link})`
    return param.name
  })

  // Captions arrive as messages without a {file} placeholder but with a file parameter
  for (const param of Object.values(p)) {
    if (param.type === 'file' && !files.includes(param)) files.push(param)
  }

  return { markdown: markdown.trim(), files, mentionsSelf }
}

/** Plain text rendering for notifications, previews and system messages. */
export function toPlainText(m: ChatMessage): string {
  const p = params(m)
  return m.message
    .replace(PLACEHOLDER, (whole, key: string) => {
      const param = p[key]
      if (!param) return whole
      return MENTION_TYPES.has(param.type) && m.systemMessage === '' ? `@${param.name}` : param.name
    })
    .trim()
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u

export function isEmojiOnly(text: string): boolean {
  const t = text.trim()
  if (!t || /^[\d#*\s]+$/.test(t)) return false
  return EMOJI_ONLY.test(t) && [...t.replace(/\s/g, '')].length <= 24
}

const GROUP_WINDOW_SECONDS = 5 * 60

/** Mattermost collapses consecutive posts from the same author into one block. */
export function continuesGroup(prev: ChatMessage | undefined, cur: ChatMessage): boolean {
  if (!prev) return false
  if (prev.systemMessage || cur.systemMessage) return false
  if (prev.actorType !== cur.actorType || prev.actorId !== cur.actorId) return false
  if (cur.timestamp - prev.timestamp > GROUP_WINDOW_SECONDS) return false
  if (isFullMessage(cur.parent) && !isThreadReply(cur)) return false
  return isSameDay(prev.timestamp, cur.timestamp)
}

export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a * 1000)
  const db = new Date(b * 1000)
  return (
    da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
  )
}

export function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function formatDateSeparator(ts: number, now = new Date()): string {
  const d = new Date(ts * 1000)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString([], opts)
}

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now / 1000 - ts)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86_400) return `${Math.floor(diff / 3600)} h ago`
  return formatDateSeparator(ts)
}

export function formatFullDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })
}

export function formatBytes(size: number | string | undefined): string {
  const n = Number(size)
  if (!Number.isFinite(n) || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

/** A random 64-character hex string, as Talk expects for referenceId. */
export function newReferenceId(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Initials for avatar placeholders. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = [
  '#1c58d9',
  '#3db887',
  '#e07315',
  '#9b4dca',
  '#d24b4e',
  '#0a8a9c',
  '#c43e8a',
  '#6b7b0c',
  '#5d6ab9'
]

export function colorFor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

/** Converts a message back to the text a user would type, e.g. for editing. Returns null if not editable. */
export function toEditableText(m: ChatMessage): string | null {
  const p = params(m)
  if (Object.values(p).some((x) => x.type === 'file')) return null
  return m.message.replace(PLACEHOLDER, (whole, key: string) => {
    const param = p[key]
    if (!param) return whole
    if (param.type === 'call') return '@all'
    if (MENTION_TYPES.has(param.type)) {
      const id = typeof param.mention === 'string' ? param.mention : param.id
      return /[\s/]/.test(id) ? `@"${id}"` : `@${id}`
    }
    return param.name
  })
}
