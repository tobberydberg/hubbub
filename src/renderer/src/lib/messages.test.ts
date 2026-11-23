import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/talk-types'
import {
  belongsTo,
  continuesGroup,
  formatBytes,
  initials,
  isDisplayable,
  isEmojiOnly,
  isThreadReply,
  isThreadRoot,
  newReferenceId,
  rootOf,
  toEditableText,
  toPlainText,
  toRenderable
} from './messages'

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

describe('toRenderable', () => {
  it('turns mentions into mention links and flags self mentions', () => {
    const r = toRenderable(
      msg({
        message: 'Hi {mention-user1} and {mention-user2}',
        messageParameters: {
          'mention-user1': { type: 'user', id: 'alice', name: 'Alice A' },
          'mention-user2': { type: 'user', id: 'carol', name: 'Carol [C]' }
        }
      }),
      'alice'
    )
    expect(r.markdown).toBe(
      'Hi [@Alice A](hubbub-mention:user/alice/self) and [@Carol \\[C\\]](hubbub-mention:user/carol)'
    )
    expect(r.mentionsSelf).toBe(true)
  })

  it('treats @all as a self mention', () => {
    const r = toRenderable(
      msg({
        message: '{mention-call1} hello',
        messageParameters: { 'mention-call1': { type: 'call', id: 'x', name: 'Room' } }
      }),
      'alice'
    )
    expect(r.mentionsSelf).toBe(true)
  })

  it('extracts files from the text and keeps captions', () => {
    const file = { type: 'file', id: '42', name: 'a.png', mimetype: 'image/png' }
    expect(toRenderable(msg({ message: '{file}', messageParameters: { file } }), 'a')).toMatchObject({
      markdown: '',
      files: [file]
    })
    expect(toRenderable(msg({ message: 'Look at this', messageParameters: { file } }), 'a')).toMatchObject({
      markdown: 'Look at this',
      files: [file]
    })
  })

  it('leaves unknown placeholders untouched', () => {
    expect(toRenderable(msg({ message: 'code {notaparam}' }), 'a').markdown).toBe('code {notaparam}')
  })
})

describe('toPlainText / toEditableText', () => {
  const m = msg({
    message: 'Ping {mention-user1} about {file}',
    messageParameters: {
      'mention-user1': { type: 'user', id: 'jane doe', name: 'Jane' },
      file: { type: 'file', id: '1', name: 'doc.pdf' }
    }
  })

  it('renders plain text with names', () => {
    expect(toPlainText(m)).toBe('Ping @Jane about doc.pdf')
  })

  it('refuses to edit messages with files', () => {
    expect(toEditableText(m)).toBeNull()
  })

  it('converts mentions back to ids, quoting ids with spaces', () => {
    const e = msg({
      message: 'Ping {mention-user1} and {mention-call1}',
      messageParameters: {
        'mention-user1': { type: 'user', id: 'jane doe', name: 'Jane' },
        'mention-call1': { type: 'call', id: 'room', name: 'Room' }
      }
    })
    expect(toEditableText(e)).toBe('Ping @"jane doe" and @all')
  })
})

describe('threads', () => {
  it('distinguishes native thread roots, thread replies and plain replies', () => {
    const root = msg({ id: 10, threadId: 10, isThread: true, threadTitle: 'T' })
    const reply = msg({ id: 11, threadId: 10, isThread: true })
    const plainReply = msg({ id: 12, threadId: 5, parent: msg({ id: 5 }) })
    const standalone = msg({ id: 13, threadId: 13 })

    expect(isThreadRoot(root)).toBe(true)
    expect(isThreadReply(root)).toBe(false)
    expect(isThreadReply(reply)).toBe(true)
    expect(isThreadReply(plainReply)).toBe(false)
    expect(isThreadRoot(standalone)).toBe(false)

    expect(rootOf(reply)).toBe(10)
    expect(rootOf(plainReply)).toBe(5)
    expect(rootOf(standalone)).toBe(13)
    expect(belongsTo(reply, 10)).toBe(true)
    expect(belongsTo(root, 10)).toBe(false)
  })

  it('falls back to the parent on servers without threadId', () => {
    const reply = msg({ id: 3, parent: msg({ id: 2 }) })
    expect(rootOf(reply)).toBe(2)
    expect(belongsTo(reply, 2)).toBe(true)
  })
})

describe('display rules', () => {
  it('hides update-only and noisy system messages', () => {
    expect(isDisplayable(msg({ systemMessage: 'reaction' }))).toBe(false)
    expect(isDisplayable(msg({ systemMessage: 'call_joined' }))).toBe(false)
    expect(isDisplayable(msg({ systemMessage: 'conversation_created' }))).toBe(true)
    expect(isDisplayable(msg({ expirationTimestamp: 1 }))).toBe(false)
  })

  it('groups consecutive posts from the same author within five minutes', () => {
    const a = msg({ id: 1, timestamp: 1000 })
    expect(continuesGroup(a, msg({ id: 2, timestamp: 1100 }))).toBe(true)
    expect(continuesGroup(a, msg({ id: 2, timestamp: 1000 + 301 }))).toBe(false)
    expect(continuesGroup(a, msg({ id: 2, timestamp: 1100, actorId: 'carol' }))).toBe(false)
    expect(continuesGroup(a, msg({ id: 2, timestamp: 1100, parent: msg({ id: 1 }) }))).toBe(false)
  })

  it('detects emoji-only messages', () => {
    expect(isEmojiOnly('🎉')).toBe(true)
    expect(isEmojiOnly('👍🏽 ❤️')).toBe(true)
    expect(isEmojiOnly('ok 👍')).toBe(false)
    expect(isEmojiOnly('123')).toBe(false)
  })
})

describe('helpers', () => {
  it('formats sizes and initials', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(undefined)).toBe('')
    expect(initials('Alice Andersson')).toBe('AA')
    expect(initials('bob')).toBe('BO')
  })

  it('creates 64 character reference ids', () => {
    expect(newReferenceId()).toMatch(/^[0-9a-f]{64}$/)
  })
})
