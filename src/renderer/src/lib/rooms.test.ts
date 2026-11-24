import { describe, expect, it } from 'vitest'
import { RoomType, type Room } from '@shared/talk-types'
import { groupMessageName, isGroupMessage, roomTitle } from './rooms'

const room = (partial: Partial<Room>): Room =>
  ({ token: 't', type: RoomType.Group, name: '', displayName: '', objectType: '', ...partial }) as Room

describe('group messages', () => {
  it('are group conversations extended from a one-to-one', () => {
    expect(isGroupMessage(room({ objectType: 'extended_conversation' }))).toBe(true)
    expect(isGroupMessage(room({}))).toBe(false)
    expect(isGroupMessage(room({ type: RoomType.Public, objectType: 'extended_conversation' }))).toBe(false)
  })

  it('leave our own name out of the title', () => {
    const gm = room({ objectType: 'extended_conversation', displayName: 'Alice Test, Bob Test, Carol Test' })
    expect(roomTitle(gm, 'Bob Test')).toBe('Alice Test, Carol Test')
    expect(roomTitle(room({ displayName: 'Bob Test, Team' }), 'Bob Test')).toBe('Bob Test, Team')
  })

  it('are named after everyone in them', () => {
    expect(groupMessageName(['Alice', 'Bob'])).toBe('Alice, Bob')
  })
})
