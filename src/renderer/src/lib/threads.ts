import type { ChatMessage, ThreadInfo } from '@shared/talk-types'
import { isThreadRoot, params, rootOf } from './messages'

export interface ThreadActor {
  actorType: string
  actorId: string
  name: string
}

/** A thread (native Talk thread or reply chain) as shown in the Threads view and under its root post. */
export interface ThreadSummary {
  token: string
  rootId: number
  root?: ChatMessage
  title?: string
  replyCount: number
  lastReplyId: number
  /** Unix seconds of the newest reply (or the root when there are none) */
  lastActivity: number
  last?: ChatMessage
  /** Distinct repliers, most recent first */
  participants: ThreadActor[]
  /** Native Talk thread (Talk 22+), which has server-side follow state */
  native: boolean
  /** The user started it, replied to it or was mentioned in it */
  involved: boolean
}

export const threadKey = (token: string, rootId: number): string => `${token}#${rootId}`

function isSelf(m: ChatMessage, selfId: string | undefined): boolean {
  return !!selfId && m.actorType === 'users' && m.actorId === selfId
}

function mentions(m: ChatMessage, selfId: string | undefined): boolean {
  return !!selfId && Object.values(params(m)).some((p) => p.type === 'user' && p.id === selfId)
}

/** Groups the loaded messages of one conversation into threads that have at least one reply. */
export function collectThreads(
  token: string,
  chat: { ids: number[]; byId: Record<number, ChatMessage> },
  selfId: string | undefined
): ThreadSummary[] {
  const byRoot = new Map<number, ThreadSummary>()
  const repliers = new Map<number, ChatMessage[]>()
  const entry = (rootId: number, native: boolean): ThreadSummary => {
    let t = byRoot.get(rootId)
    if (!t) {
      const root = chat.byId[rootId]
      t = {
        token,
        rootId,
        root,
        title: root && isThreadRoot(root) ? root.threadTitle : undefined,
        replyCount: 0,
        lastReplyId: 0,
        lastActivity: root?.timestamp ?? 0,
        participants: [],
        native: native || !!root?.isThread,
        involved: !!root && (isSelf(root, selfId) || mentions(root, selfId))
      }
      byRoot.set(rootId, t)
    }
    return t
  }
  for (const id of chat.ids) {
    const m = chat.byId[id]
    if (!m || m.systemMessage) continue
    // Native thread roots carry a reply count even when their replies are not loaded
    if (isThreadRoot(m) && m.threadReplies) entry(m.id, true)
    const rootId = rootOf(m, chat.byId)
    if (rootId === m.id) continue
    const t = entry(rootId, !!m.isThread)
    t.replyCount++
    const list = repliers.get(rootId)
    if (list) list.push(m)
    else repliers.set(rootId, [m])
    if (m.id > t.lastReplyId) {
      t.lastReplyId = m.id
      t.last = m
      t.lastActivity = Math.max(t.lastActivity, m.timestamp)
    }
    if (isSelf(m, selfId) || mentions(m, selfId)) t.involved = true
  }
  for (const t of byRoot.values()) {
    // Native roots know their total reply count even when not every reply is loaded
    if (t.root?.threadReplies) t.replyCount = Math.max(t.replyCount, t.root.threadReplies)
    const seen = new Set<string>()
    for (const m of (repliers.get(t.rootId) ?? []).reverse()) {
      const k = `${m.actorType}/${m.actorId}`
      if (seen.has(k)) continue
      seen.add(k)
      t.participants.push({ actorType: m.actorType, actorId: m.actorId, name: m.actorDisplayName })
      if (t.participants.length === 5) break
    }
  }
  return [...byRoot.values()]
}

/** Converts a native thread from the subscribed-threads endpoint. */
export function fromThreadInfo(info: ThreadInfo): ThreadSummary {
  const last = info.last && info.last.id !== info.thread.id ? info.last : undefined
  return {
    token: info.thread.roomToken,
    rootId: info.thread.id,
    root: info.first ?? undefined,
    title: info.thread.title,
    replyCount: info.thread.numReplies,
    lastReplyId: info.thread.numReplies > 0 ? info.thread.lastMessageId : 0,
    lastActivity: info.thread.lastActivity,
    last,
    participants: last
      ? [{ actorType: last.actorType, actorId: last.actorId, name: last.actorDisplayName }]
      : [],
    native: true,
    involved: true
  }
}

/** Merges two views of the same thread, preferring whichever has seen more of it. */
export function mergeThread(a: ThreadSummary, b: ThreadSummary): ThreadSummary {
  const [newer, older] = b.lastReplyId > a.lastReplyId ? [b, a] : [a, b]
  return {
    ...newer,
    root: a.root ?? b.root,
    title: a.title ?? b.title,
    replyCount: Math.max(a.replyCount, b.replyCount),
    participants:
      newer.participants.length >= older.participants.length ? newer.participants : older.participants,
    native: a.native || b.native,
    involved: a.involved || b.involved
  }
}

/** A thread is unread when someone else replied after the newest reply the user has seen. */
export function isThreadUnread(
  t: ThreadSummary,
  seenId: number | undefined,
  baseline: number,
  selfId: string | undefined
): boolean {
  if (!t.lastReplyId || t.lastReplyId <= Math.max(seenId ?? 0, baseline)) return false
  return !(t.last && isSelf(t.last, selfId))
}
