import { describe, expect, it } from 'vitest'
import { RoomType, type ChatMessage, type Room, type TalkCapabilities } from '@shared/talk-types'
import { callUnsupportedReason, shouldRing } from './rules'

function room(partial: Partial<Room> = {}): Room {
  return {
    id: 1,
    token: 'abc',
    type: RoomType.OneToOne,
    name: 'bob',
    displayName: 'Bob',
    description: '',
    isFavorite: false,
    readOnly: 0,
    unreadMessages: 0,
    unreadMention: false,
    unreadMentionDirect: false,
    lastActivity: 0,
    lastReadMessage: 0,
    notificationLevel: 0,
    participantType: 3,
    permissions: 0,
    ...partial
  }
}

function callStarted(actorId: string, partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 10,
    token: 'abc',
    actorType: 'users',
    actorId,
    actorDisplayName: actorId,
    timestamp: 0,
    message: '{actor} started a call',
    messageParameters: {},
    systemMessage: 'call_started',
    messageType: 'system',
    ...partial
  } as ChatMessage
}

const caps = (config: Record<string, unknown> = {}, features = ['signaling-v3']): TalkCapabilities => ({
  features,
  config: { call: { enabled: true, ...config } }
})

describe('callUnsupportedReason', () => {
  it('allows calls on a regular server', () => {
    expect(callUnsupportedReason(caps(), room())).toBeNull()
  })

  it('falls back for encrypted, federated and disabled calls and old servers', () => {
    expect(callUnsupportedReason(caps({ 'end-to-end-encryption': true }), room())).toMatch(/encrypted/)
    expect(callUnsupportedReason(caps(), room({ remoteServer: 'https://other.example' }))).toMatch(
      /other servers/
    )
    expect(callUnsupportedReason(caps({ enabled: false }), room())).toMatch(/turned off/)
    expect(callUnsupportedReason(caps({}, []), room())).toMatch(/newer Talk/)
    expect(callUnsupportedReason(undefined, room())).toMatch(/Not connected/)
  })
})

describe('shouldRing', () => {
  const before = room({ hasCall: false })

  it('rings when someone else starts a call', () => {
    expect(shouldRing(before, room({ hasCall: true, lastMessage: callStarted('bob') }), 'alice')).toBe(true)
  })

  it('rings when the start message is not the last one', () => {
    expect(shouldRing(before, room({ hasCall: true, lastMessage: [] }), 'alice')).toBe(true)
  })

  it('does not ring for our own, silent, ongoing or muted calls', () => {
    expect(shouldRing(before, room({ hasCall: true, lastMessage: callStarted('alice') }), 'alice')).toBe(
      false
    )
    expect(
      shouldRing(before, room({ hasCall: true, lastMessage: callStarted('bob', { silent: true }) }), 'alice')
    ).toBe(false)
    expect(shouldRing(room({ hasCall: true }), room({ hasCall: true }), 'alice')).toBe(false)
    expect(shouldRing(before, room({ hasCall: true, notificationCalling: 0 }), 'alice')).toBe(false)
    expect(shouldRing(before, room({ hasCall: false }), 'alice')).toBe(false)
  })
})
