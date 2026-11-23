import type { ChatMessage } from '@shared/talk-types'
import { talk, TalkError } from '@renderer/api/talk'
import { isDisplayable, isFullMessage, isThreadReply, UPDATE_SYSTEM_MESSAGES } from '@renderer/lib/messages'
import { chatKey, emptyChat, setApp, useApp } from '@renderer/store/app'

const PAGE_SIZE = 100

/** Merges messages from the server into a chat, applying edits/deletions/reactions carried by system messages. */
export function applyMessages(key: string, msgs: ChatMessage[]): number[] {
  const added: number[] = []
  setApp((s) => {
    const chat = (s.chats[key] ??= emptyChat())
    for (const m of msgs) {
      if (m.id > chat.newestId) chat.newestId = m.id

      if (m.systemMessage && UPDATE_SYSTEM_MESSAGES.has(m.systemMessage)) {
        if (isFullMessage(m.parent)) {
          const existing = chat.byId[m.parent.id]
          if (existing) chat.byId[m.parent.id] = { ...m.parent, parent: existing.parent }
        }
        continue
      }
      if (!isDisplayable(m)) continue

      const isNew = !chat.byId[m.id]
      chat.byId[m.id] = m
      if (isNew) {
        added.push(m.id)
        if (isThreadReply(m) && m.threadId) {
          const root = chat.byId[m.threadId]
          if (root && m.id > root.id) root.threadReplies = (root.threadReplies ?? 0) + 1
        }
      }
      if (m.referenceId && chat.pending.length) {
        chat.pending = chat.pending.filter((p) => p.referenceId !== m.referenceId)
      }
    }
    if (added.length) {
      const ids = new Set(chat.ids)
      for (const id of added) ids.add(id)
      chat.ids = [...ids].sort((a, b) => a - b)
    }
  })
  return added
}

export async function loadInitial(accountId: string, token: string, limit = PAGE_SIZE): Promise<void> {
  const key = chatKey(accountId, token)
  const room = useApp.getState().accounts[accountId]?.rooms[token]
  setApp((s) => {
    const chat = (s.chats[key] ??= emptyChat())
    chat.error = undefined
    chat.unreadFromId = room && room.unreadMessages > 0 ? room.lastReadMessage : null
  })
  try {
    const page = await talk(accountId).messages(token, { lookIntoFuture: false, limit })
    applyMessages(key, page.messages)
    setApp((s) => {
      const chat = s.chats[key]
      chat.loaded = true
      chat.oldestCursor = page.lastGiven
      chat.hasMoreOlder = !page.notModified && page.messages.length >= limit
    })
  } catch (err) {
    setApp((s) => {
      s.chats[key].error = err instanceof Error ? err.message : String(err)
      s.chats[key].loaded = true
    })
  }
}

export async function loadOlder(accountId: string, token: string): Promise<void> {
  const key = chatKey(accountId, token)
  const chat = useApp.getState().chats[key]
  if (!chat || chat.loadingOlder || !chat.hasMoreOlder || !chat.oldestCursor) return
  setApp((s) => {
    s.chats[key].loadingOlder = true
  })
  try {
    const page = await talk(accountId).messages(token, {
      lookIntoFuture: false,
      lastKnownMessageId: chat.oldestCursor,
      limit: PAGE_SIZE
    })
    applyMessages(key, page.messages)
    setApp((s) => {
      const c = s.chats[key]
      c.oldestCursor = page.lastGiven ?? c.oldestCursor
      c.hasMoreOlder = !page.notModified && page.messages.length >= PAGE_SIZE
    })
  } catch {
    // Keep hasMoreOlder so the user can retry by scrolling again
  } finally {
    setApp((s) => {
      s.chats[key].loadingOlder = false
    })
  }
}

export async function loadThread(accountId: string, token: string, threadId: number): Promise<void> {
  const key = chatKey(accountId, token)
  const api = talk(accountId)
  try {
    if (!useApp.getState().chats[key]?.byId[threadId]) {
      const ctx = await api.context(token, threadId, 1)
      applyMessages(
        key,
        ctx.filter((m) => m.id === threadId)
      )
    }
    const page = await api.messages(token, { lookIntoFuture: false, threadId, limit: 200 })
    applyMessages(key, page.messages)
    setApp((s) => {
      ;(s.chats[key] ??= emptyChat()).loadedThreads[threadId] = true
    })
  } catch (err) {
    console.warn('Failed to load thread', err)
  }
}

/** Fetches everything newer than what is loaded, without waiting for new messages. */
export async function catchUp(accountId: string, token: string): Promise<void> {
  const key = chatKey(accountId, token)
  const api = talk(accountId)
  try {
    for (let round = 0; round < 10; round++) {
      const since = useApp.getState().chats[key]?.newestId ?? 0
      const page = await api.messages(token, {
        lookIntoFuture: true,
        lastKnownMessageId: since,
        timeout: 0,
        limit: PAGE_SIZE
      })
      if (page.notModified || !page.messages.length) return
      applyMessages(key, page.messages)
      if (page.messages.length < PAGE_SIZE) return
    }
  } catch (err) {
    console.warn(`Failed to catch up ${token}`, err)
  }
}

/** Long-polls a conversation (or a single thread) for new messages. */
export class ChatPoller {
  private stopped = false
  private readonly requestId = `poll-${Math.random().toString(36).slice(2)}`

  constructor(
    readonly accountId: string,
    readonly token: string,
    readonly threadId: number | undefined,
    private readonly onNewMessages: (ids: number[]) => void
  ) {}

  async run(): Promise<void> {
    const key = chatKey(this.accountId, this.token)
    let since = useApp.getState().chats[key]?.newestId ?? 0
    let backoff = 1000
    const api = talk(this.accountId)

    while (!this.stopped) {
      try {
        const page = await api.messages(this.token, {
          lookIntoFuture: true,
          lastKnownMessageId: since,
          threadId: this.threadId,
          timeout: 30,
          requestId: this.requestId
        })
        if (this.stopped) break
        if (!page.notModified && page.messages.length) {
          const added = applyMessages(key, page.messages)
          since = Math.max(since, page.lastGiven ?? 0, ...page.messages.map((m) => m.id))
          if (added.length) this.onNewMessages(added)
        }
        backoff = 1000
      } catch (err) {
        if (this.stopped) break
        if (err instanceof TalkError && (err.status === 404 || err.status === 403)) {
          console.warn(`Stopped polling ${this.token}: HTTP ${err.status}`)
          break
        }
        await new Promise((r) => setTimeout(r, backoff))
        backoff = Math.min(backoff * 2, 30_000)
      }
    }
  }

  start(): this {
    void this.run()
    return this
  }

  stop(): void {
    this.stopped = true
    void window.hubbub.abortRequest(this.requestId)
  }
}
