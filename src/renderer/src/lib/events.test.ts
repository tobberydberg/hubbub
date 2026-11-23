import { describe, expect, it } from 'vitest'
import { RoomType, type Room } from '@shared/talk-types'
import { eventTime, formatEventTime, isMeeting } from './events'

const room = (partial: Partial<Room>): Room =>
  ({ token: 't', type: RoomType.Group, displayName: 'x', lastActivity: 0, ...partial }) as Room

describe('event conversations', () => {
  it('reads the time range from objectId', () => {
    expect(eventTime(room({ objectType: 'event', objectId: '100#200' }))).toEqual({ start: 100, end: 200 })
    expect(eventTime(room({ objectType: 'event', objectId: 'garbage' }))).toBeNull()
    expect(eventTime(room({ objectType: 'file', objectId: '100#200' }))).toBeNull()
  })

  it('treats instant meetings as meetings without a time', () => {
    const r = room({ objectType: 'instant_meeting', objectId: '' })
    expect(isMeeting(r)).toBe(true)
    expect(formatEventTime(r)).toBeNull()
  })

  it('labels running, today and tomorrow meetings', () => {
    const now = new Date(2026, 10, 24, 12, 0).getTime() / 1000
    const at = (h: number, dayOffset = 0): number => new Date(2026, 10, 24 + dayOffset, h, 0).getTime() / 1000
    const ev = (start: number, end: number): Room =>
      room({ objectType: 'event', objectId: `${start}#${end}` })
    expect(formatEventTime(ev(at(11), at(13)), now)).toBe('Now')
    expect(formatEventTime(ev(at(15), at(16)), now)).toMatch(/^Today \d/)
    expect(formatEventTime(ev(at(9, 1), at(10, 1)), now)).toMatch(/^Tomorrow \d/)
    expect(formatEventTime(ev(at(9, -1), at(10, -1)), now)).toBe('Yesterday')
  })
})
