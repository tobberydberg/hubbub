import { describe, expect, it } from 'vitest'
import { RoomType, type Room } from '@shared/talk-types'
import { buildCategories, visibleRooms, type CategoryInput } from './categories'

function room(token: string, partial: Partial<Room> = {}): Room {
  return {
    id: 1,
    token,
    type: RoomType.Group,
    name: token,
    displayName: token,
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

const base: CategoryInput = {
  rooms: [],
  tags: [],
  useServerTags: false,
  localCategories: [],
  collapsed: {},
  sortModes: {},
  showArchived: false,
  hideMeetingsBefore: null
}

describe('buildCategories', () => {
  it('splits favorites, channels and direct messages', () => {
    const cats = buildCategories({
      ...base,
      rooms: [
        room('b-chan'),
        room('a-chan'),
        room('fav', { isFavorite: true }),
        room('dm-old', { type: RoomType.OneToOne, lastActivity: 1 }),
        room('dm-new', { type: RoomType.OneToOne, lastActivity: 2 }),
        room('archived', { isArchived: true })
      ]
    })
    expect(cats.map((c) => c.id)).toEqual(['favorites', 'channels', 'dms'])
    expect(cats[1].rooms.map((r) => r.token)).toEqual(['a-chan', 'b-chan'])
    // Direct messages default to most recent first
    expect(cats[2].rooms.map((r) => r.token)).toEqual(['dm-new', 'dm-old'])
  })

  it('uses server conversation tags as custom categories', () => {
    const cats = buildCategories({
      ...base,
      useServerTags: true,
      tags: [
        { id: '2', name: 'Second', sortOrder: 1, collapsed: true, type: 'custom' },
        { id: '1', name: 'First', sortOrder: 0, collapsed: false, type: 'custom' },
        { id: 'f', name: 'Favorites', sortOrder: 0, collapsed: false, type: 'favorites' }
      ],
      rooms: [room('x', { tagIds: ['2'] }), room('y')]
    })
    expect(cats.map((c) => c.name)).toEqual(['First', 'Second', 'Channels', 'Direct Messages'])
    expect(cats[1].rooms.map((r) => r.token)).toEqual(['x'])
    expect(cats[1].collapsed).toBe(true)
  })

  it('uses local categories when the server has no tags', () => {
    const cats = buildCategories({
      ...base,
      localCategories: [{ id: 'local:1', name: 'Customers', tokens: ['c'] }],
      rooms: [room('c'), room('d')]
    })
    expect(cats[0]).toMatchObject({ name: 'Customers', kind: 'custom' })
    expect(cats[0].rooms.map((r) => r.token)).toEqual(['c'])
  })

  it('shows archived conversations only when enabled', () => {
    const cats = buildCategories({ ...base, showArchived: true, rooms: [room('old', { isArchived: true })] })
    expect(cats.at(-1)).toMatchObject({ id: 'archived', collapsed: true })
  })
})

describe('visibleRooms', () => {
  it('keeps unread and active rooms visible in collapsed categories', () => {
    const [channels] = buildCategories({
      ...base,
      collapsed: { channels: true },
      rooms: [room('read'), room('unread', { unreadMessages: 2 }), room('active')]
    })
    expect(visibleRooms(channels, 'active').map((r) => r.token)).toEqual(['active', 'unread'])
  })
})

describe('meetings', () => {
  const now = 1_800_000_000
  const event = (token: string, start: number, end: number, partial: Partial<Room> = {}): Room =>
    room(token, { objectType: 'event', objectId: `${start}#${end}`, ...partial })
  const upcoming = event('tomorrow', now + 86_400, now + 90_000)
  const running = event('running', now - 600, now + 600)
  const soon = event('soon', now + 600, now + 4200)
  const recent = event('yesterday', now - 86_400, now - 82_800)
  const old = event('old', now - 30 * 86_400, now - 30 * 86_400 + 3600)

  it('groups event conversations in a collapsed Meetings category, upcoming first', () => {
    const cats = buildCategories({
      ...base,
      now,
      rooms: [room('general'), old, recent, upcoming, running, soon],
      hideMeetingsBefore: null
    })
    const meetings = cats.find((c) => c.kind === 'meetings')
    expect(meetings?.collapsed).toBe(true)
    expect(meetings?.rooms.map((r) => r.token)).toEqual(['running', 'soon', 'tomorrow', 'yesterday', 'old'])
    expect(cats.find((c) => c.kind === 'channels')?.rooms.map((r) => r.token)).toEqual(['general'])
  })

  it('hides past meetings unless unread or open', () => {
    const unreadOld = event('unread-old', now - 40 * 86_400, now - 40 * 86_400 + 60, { unreadMessages: 2 })
    const openOld = event('open-old', now - 50 * 86_400, now - 50 * 86_400 + 60)
    const cats = buildCategories({
      ...base,
      now,
      rooms: [old, recent, unreadOld, openOld],
      hideMeetingsBefore: now - 3 * 86_400,
      activeToken: 'open-old'
    })
    const tokens = cats.find((c) => c.kind === 'meetings')?.rooms.map((r) => r.token)
    expect(tokens).toEqual(['yesterday', 'unread-old', 'open-old'])
  })

  it('keeps favorites and custom categories over Meetings', () => {
    const fav = event('fav', now + 100, now + 200, { isFavorite: true })
    const cats = buildCategories({ ...base, now, rooms: [fav] })
    expect(cats.find((c) => c.kind === 'meetings')).toBeUndefined()
    expect(cats[0].rooms.map((r) => r.token)).toEqual(['fav'])
  })

  it('shows running and soon-starting meetings when collapsed', () => {
    const [meetings] = buildCategories({ ...base, now, rooms: [upcoming, running, soon] }).filter(
      (c) => c.kind === 'meetings'
    )
    expect(visibleRooms(meetings, null, now).map((r) => r.token)).toEqual(['running', 'soon'])
  })

  it("follows the user's own meeting choices over Talk's", () => {
    const sync = room('roadmap-sync', { lastActivity: now - 60 * 86_400 })
    const cats = buildCategories({
      ...base,
      now,
      rooms: [sync, upcoming, room('general')],
      meetingOverrides: { 'roadmap-sync': true, tomorrow: false },
      // Marked by the user, so not hidden even though its last activity is long ago
      hideMeetingsBefore: now
    })
    expect(cats.find((c) => c.kind === 'meetings')?.rooms.map((r) => r.token)).toEqual(['roadmap-sync'])
    expect(cats.find((c) => c.kind === 'channels')?.rooms.map((r) => r.token)).toEqual([
      'general',
      'tomorrow'
    ])
  })
})
