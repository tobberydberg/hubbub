import { useMemo } from 'react'
import { NotificationLevel, type ThreadInfo } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import {
  collectThreads,
  fromThreadInfo,
  isThreadUnread,
  mergeThread,
  threadKey,
  type ThreadSummary
} from '@renderer/lib/threads'
import { chatKey, setApp, showToast, useApp, type AccountState, type ChatState } from '@renderer/store/app'
import { useThreadPrefs } from '@renderer/store/threads'
import { catchUp, loadInitial } from './chat'

/** How far back and how wide the Threads view looks for reply chains the user took part in. */
const SCAN_MAX_ROOMS = 30
const SCAN_MAX_AGE = 30 * 86_400
const SCAN_PAGE = 200
const SCAN_CONCURRENCY = 3

export interface ThreadEntry extends ThreadSummary {
  key: string
  following: boolean
  unread: boolean
}

function hasThreads(a: AccountState | undefined): boolean {
  return !!a?.caps?.features.includes('threads')
}

/** Replies that existed before Hubbub started tracking threads should not all show up as unread. */
export function initThreadBaseline(accountId: string): void {
  const a = useApp.getState().accounts[accountId]
  if (!a?.roomsLoaded) return
  let newest = 0
  for (const r of Object.values(a.rooms)) {
    if (r.lastMessage && !Array.isArray(r.lastMessage)) newest = Math.max(newest, r.lastMessage.id)
  }
  useThreadPrefs.getState().initBaseline(accountId, newest)
}

/** Loads the native threads the user follows (Talk 22+). */
export async function refreshSubscribedThreads(accountId: string): Promise<void> {
  if (!hasThreads(useApp.getState().accounts[accountId])) return
  try {
    const list = await talk(accountId).subscribedThreads(100)
    setApp((s) => {
      const a = s.accounts[accountId]
      if (a) a.subscribedThreads = list
    })
  } catch (err) {
    console.warn('Failed to load followed threads', err)
  }
}

let scanning: Promise<void> | null = null

/**
 * Fetches recent history of recently active conversations (read-only: no read markers are set) so
 * reply chains the user took part in can be listed. Conversations already loaded are only caught up.
 */
export function scanRecentConversations(accountId: string): Promise<void> {
  scanning ??= (async () => {
    const s = useApp.getState()
    const a = s.accounts[accountId]
    if (!a) return
    const cutoff = Date.now() / 1000 - SCAN_MAX_AGE
    const rooms = Object.values(a.rooms)
      .filter((r) => !r.isArchived && r.lastActivity > cutoff)
      .sort((x, y) => y.lastActivity - x.lastActivity)
      .slice(0, SCAN_MAX_ROOMS)
      .filter((r) => {
        const chat = s.chats[chatKey(accountId, r.token)]
        const newest = r.lastMessage && !Array.isArray(r.lastMessage) ? r.lastMessage.id : 0
        return !chat?.loaded || newest > chat.newestId
      })
    const queue = [...rooms]
    const worker = async (): Promise<void> => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const chat = useApp.getState().chats[chatKey(accountId, r.token)]
        if (chat?.loaded) await catchUp(accountId, r.token)
        else await loadInitial(accountId, r.token, SCAN_PAGE)
      }
    }
    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker))
  })().finally(() => {
    scanning = null
  })
  return scanning
}

// Collecting threads walks every loaded message; cache per chat object (immer keeps unchanged ones).
const threadCache = new WeakMap<ChatState, { selfId?: string; threads: ThreadSummary[] }>()

function threadsOf(token: string, chat: ChatState, selfId: string | undefined): ThreadSummary[] {
  const hit = threadCache.get(chat)
  if (hit && hit.selfId === selfId) return hit.threads
  const threads = collectThreads(token, chat, selfId)
  threadCache.set(chat, { selfId, threads })
  return threads
}

/** Whether the user follows a thread: an explicit choice wins, then the server's state, then involvement. */
export function isFollowing(
  a: AccountState,
  t: Pick<ThreadSummary, 'token' | 'rootId' | 'native' | 'involved'>,
  overrides: Record<string, boolean> | undefined
): boolean {
  const key = threadKey(t.token, t.rootId)
  const explicit = overrides?.[key]
  if (explicit !== undefined) return explicit
  if (t.native && a.subscribedThreads) {
    return a.subscribedThreads.some((x) => x.thread.roomToken === t.token && x.thread.id === t.rootId)
  }
  return t.involved
}

/** All known threads of an account (followed or not), newest activity first. */
export function useThreads(account: AccountState | undefined): ThreadEntry[] {
  const accountId = account?.info.id ?? ''
  const prefix = `${accountId}/`
  const chats = useApp((s) => s.chats)
  const follows = useThreadPrefs((s) => s.follows[accountId])
  const seen = useThreadPrefs((s) => s.seen[accountId])
  const baseline = useThreadPrefs((s) => s.baseline[accountId] ?? 0)

  return useMemo(() => {
    if (!account) return []
    const selfId = account.user?.id
    const byKey = new Map<string, ThreadSummary>()
    const add = (t: ThreadSummary): void => {
      const k = threadKey(t.token, t.rootId)
      const prev = byKey.get(k)
      byKey.set(k, prev ? mergeThread(prev, t) : t)
    }
    for (const info of account.subscribedThreads ?? []) add(fromThreadInfo(info))
    for (const [key, chat] of Object.entries(chats)) {
      if (!key.startsWith(prefix)) continue
      const token = key.slice(prefix.length)
      if (!account.rooms[token]) continue
      for (const t of threadsOf(token, chat, selfId)) add(t)
    }
    return [...byKey.entries()]
      .filter(([, t]) => account.rooms[t.token])
      .map(([key, t]) => ({
        ...t,
        key,
        following: isFollowing(account, t, follows),
        unread: isThreadUnread(t, seen?.[key], baseline, selfId)
      }))
      .sort((x, y) => y.lastActivity - x.lastActivity || y.lastReplyId - x.lastReplyId)
  }, [account, chats, prefix, follows, seen, baseline])
}

/** Remembers the newest reply the user has seen in a thread. */
export function markThreadSeen(accountId: string, token: string, rootId: number, replyId: number): void {
  if (replyId > 0) useThreadPrefs.getState().markSeen(accountId, threadKey(token, rootId), replyId)
}

/**
 * Follows or unfollows a thread. Native Talk threads store this on the server (the thread's
 * notification level); reply chains are followed locally.
 */
export async function setThreadFollow(
  accountId: string,
  t: { token: string; rootId: number; native: boolean },
  follow: boolean
): Promise<void> {
  const key = threadKey(t.token, t.rootId)
  const prefs = useThreadPrefs.getState()
  prefs.setFollow(accountId, key, follow)
  if (!t.native) return
  try {
    const level = follow ? NotificationLevel.Default : NotificationLevel.Never
    const info: ThreadInfo = await talk(accountId).setThreadNotificationLevel(t.token, t.rootId, level)
    setApp((s) => {
      const a = s.accounts[accountId]
      if (!a?.subscribedThreads) return
      const rest = a.subscribedThreads.filter(
        (x) => !(x.thread.roomToken === t.token && x.thread.id === t.rootId)
      )
      a.subscribedThreads = follow ? [info, ...rest] : rest
    })
    // The server is now the source of truth again
    useThreadPrefs.getState().setFollow(accountId, key, null)
  } catch (err) {
    prefs.setFollow(accountId, key, null)
    showToast(
      `Could not ${follow ? 'follow' : 'unfollow'} the thread: ${err instanceof Error ? err.message : err}`,
      'error'
    )
  }
}

/** Replying to a reply chain follows it again, like in Mattermost (native threads keep the server's choice). */
export function followAfterReply(accountId: string, token: string, rootId: number): void {
  const key = threadKey(token, rootId)
  if (useThreadPrefs.getState().follows[accountId]?.[key] === false) {
    useThreadPrefs.getState().setFollow(accountId, key, null)
  }
}
