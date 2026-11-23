import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/talk-types'
import { isCollapsedReply } from './messages'
import { collectThreads, isThreadUnread } from './threads'

function msg(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: 1,
    token: 'abc',
    actorType: 'users',
    actorId: 'bob',
    actorDisplayName: 'Bob',
    timestamp: 1_700_000_000,
    message: '',
    messageParameters: [],
    messageType: 'comment',
    systemMessage: '',
    ...partial
  }
}

function chatOf(list: ChatMessage[]) {
  return { ids: list.map((m) => m.id), byId: Object.fromEntries(list.map((m) => [m.id, m])) }
}

describe('collapsed reply threads', () => {
  const root = msg({ id: 10, threadId: 10 })
  const reply = msg({ id: 11, threadId: 10, parent: root })
  const orphan = msg({ id: 12, threadId: 5, parent: msg({ id: 5 }) })
  const { byId } = chatOf([root, reply, orphan])

  it('hides replies whose root is loaded', () => {
    const opts = { collapseReplies: true, nativeThreads: true }
    expect(isCollapsedReply(root, byId, opts)).toBe(false)
    expect(isCollapsedReply(reply, byId, opts)).toBe(true)
    // The root is not loaded, so the reply stays visible instead of vanishing
    expect(isCollapsedReply(orphan, byId, opts)).toBe(false)
  })

  it('keeps reply chains inline when turned off, but still hides native thread replies', () => {
    const opts = { collapseReplies: false, nativeThreads: true }
    expect(isCollapsedReply(reply, byId, opts)).toBe(false)
    const native = msg({ id: 13, threadId: 10, isThread: true })
    expect(isCollapsedReply(native, byId, opts)).toBe(true)
  })

  it('walks nested replies to the root on servers without threadId', () => {
    const a = msg({ id: 1 })
    const b = msg({ id: 2, parent: a })
    const c = msg({ id: 3, parent: b })
    const chat = chatOf([a, b, c])
    expect(isCollapsedReply(c, chat.byId, { collapseReplies: true, nativeThreads: false })).toBe(true)
    const [t] = collectThreads('abc', chat, 'alice')
    expect(t.rootId).toBe(1)
    expect(t.replyCount).toBe(2)
  })
})

describe('collectThreads', () => {
  const root = msg({ id: 10, threadId: 10, actorId: 'carol', actorDisplayName: 'Carol' })
  const r1 = msg({
    id: 11,
    threadId: 10,
    actorId: 'alice',
    actorDisplayName: 'Alice',
    timestamp: 1_700_000_100
  })
  const r2 = msg({
    id: 12,
    threadId: 10,
    actorId: 'dave',
    actorDisplayName: 'Dave',
    timestamp: 1_700_000_200
  })
  const solo = msg({ id: 13, threadId: 13 })

  it('groups replies, newest repliers first, and flags involvement', () => {
    const threads = collectThreads('abc', chatOf([root, r1, r2, solo]), 'alice')
    expect(threads).toHaveLength(1)
    const [t] = threads
    expect(t.replyCount).toBe(2)
    expect(t.lastReplyId).toBe(12)
    expect(t.lastActivity).toBe(1_700_000_200)
    expect(t.participants.map((p) => p.actorId)).toEqual(['dave', 'alice'])
    expect(t.involved).toBe(true)
    expect(collectThreads('abc', chatOf([root, r2]), 'alice')[0].involved).toBe(false)
  })

  it('counts a mention of the user as involvement', () => {
    const mention = msg({
      id: 14,
      threadId: 10,
      message: 'ping {mention-user1}',
      messageParameters: { 'mention-user1': { type: 'user', id: 'alice', name: 'Alice' } }
    })
    expect(collectThreads('abc', chatOf([root, mention]), 'alice')[0].involved).toBe(true)
  })

  it('lists native thread roots even when their replies are not loaded', () => {
    const native = msg({ id: 20, threadId: 20, isThread: true, threadTitle: 'Plans', threadReplies: 4 })
    const [t] = collectThreads('abc', chatOf([native]), 'alice')
    expect(t).toMatchObject({ rootId: 20, native: true, replyCount: 4, title: 'Plans' })
  })

  it('is unread only for newer replies by others', () => {
    const [t] = collectThreads('abc', chatOf([root, r1, r2]), 'alice')
    expect(isThreadUnread(t, undefined, 0, 'alice')).toBe(true)
    expect(isThreadUnread(t, 12, 0, 'alice')).toBe(false)
    expect(isThreadUnread(t, undefined, 12, 'alice')).toBe(false)
    const [own] = collectThreads('abc', chatOf([root, r2, msg({ ...r1, id: 15 })]), 'alice')
    expect(isThreadUnread(own, 12, 0, 'alice')).toBe(false)
  })
})
