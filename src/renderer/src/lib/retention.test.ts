import { describe, expect, it } from 'vitest'
import type { Room, TalkCapabilities } from '@shared/talk-types'
import { expiryOf } from './retention'

const caps = (event?: number, instant?: number): TalkCapabilities => ({
  features: [],
  config: { conversations: { 'retention-event': event, 'retention-instant-meetings': instant } }
})
const room = (over: Partial<Room>): Room => ({ lastActivity: 1_000_000, ...over }) as Room

describe('expiryOf', () => {
  it('deletes event conversations days after the meeting or the last message', () => {
    const r = room({ objectType: 'event', objectId: '900000#950000', lastActivity: 960_000 })
    expect(expiryOf(r, caps(28))).toEqual({
      at: 960_000 + 28 * 86_400,
      rule: '28 days after the meeting, when nobody writes in it'
    })
  })

  it('deletes instant meetings a day after the last activity', () => {
    expect(expiryOf(room({ objectType: 'instant_meeting' }), caps(28, 1))?.rule).toBe(
      'after a day without activity'
    )
  })

  it('keeps everything else, and meetings when the server keeps them', () => {
    expect(expiryOf(room({ objectType: '' }), caps(28, 1))).toBeNull()
    expect(expiryOf(room({ objectType: 'event', objectId: '1#2' }), caps(0))).toBeNull()
  })
})
