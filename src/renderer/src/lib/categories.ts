import { RoomType, type ConversationTag, type Room } from '@shared/talk-types'
import { isGroupMessage } from './rooms'
import type { LocalCategory, SortMode } from '@renderer/store/prefs'
import { isMeeting, isSoon, meetingEnd, sortMeetings } from './events'

export type CategoryKind = 'favorites' | 'custom' | 'channels' | 'meetings' | 'dms' | 'archived'

export interface SidebarCategory {
  id: string
  name: string
  kind: CategoryKind
  rooms: Room[]
  collapsed: boolean
  sortMode: SortMode
  /** Server-side conversation tag id, when the category is backed by Talk conversation tags */
  tagId?: string
}

export interface CategoryInput {
  rooms: Room[]
  tags: ConversationTag[]
  useServerTags: boolean
  localCategories: LocalCategory[]
  collapsed: Record<string, boolean>
  sortModes: Record<string, SortMode>
  showArchived: boolean
  /** Meetings that ended before this time (unix seconds) are left out unless unread or open; null shows all */
  hideMeetingsBefore: number | null
  /** The user's own "is a meeting" choices by token */
  meetingOverrides?: Record<string, boolean>
  activeToken?: string | null
  now?: number
}

export const isDirect = (r: Room): boolean =>
  r.type === RoomType.OneToOne ||
  r.type === RoomType.OneToOneFormer ||
  r.type === RoomType.NoteToSelf ||
  isGroupMessage(r)

export function sortRooms(rooms: Room[], mode: SortMode): Room[] {
  const copy = [...rooms]
  if (mode === 'alpha') {
    copy.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
  } else {
    copy.sort((a, b) => b.lastActivity - a.lastActivity)
  }
  return copy
}

/** Groups conversations into Mattermost-style sidebar categories. */
export function buildCategories(input: CategoryInput): SidebarCategory[] {
  const { rooms, tags, useServerTags, localCategories, collapsed, sortModes, showArchived } = input
  const now = input.now ?? Date.now() / 1000
  // Breakout rooms show under their conversation, not in the sidebar
  const listed = rooms.filter((r) => r.objectType !== 'room')
  const active = listed.filter((r) => !r.isArchived)
  const archived = listed.filter((r) => r.isArchived)

  const favorites: Room[] = []
  const channels: Room[] = []
  const dms: Room[] = []
  const meetings: Room[] = []
  const custom = new Map<string, Room[]>()

  const customTags = useServerTags
    ? tags.filter((t) => t.type === 'custom').sort((a, b) => a.sortOrder - b.sortOrder)
    : []
  const tagIds = new Set(customTags.map((t) => t.id))
  const localByToken = new Map<string, string>()
  if (!useServerTags) {
    for (const c of localCategories) for (const t of c.tokens) localByToken.set(t, c.id)
  }

  for (const r of active) {
    if (r.isFavorite) {
      favorites.push(r)
      continue
    }
    const catId = useServerTags ? r.tagIds?.find((id) => tagIds.has(id)) : localByToken.get(r.token)
    if (catId) {
      const list = custom.get(catId) ?? []
      list.push(r)
      custom.set(catId, list)
    } else if (isMeeting(r, input.meetingOverrides)) {
      // Conversations the user marked as meetings have no end time (often recurring syncs), so never hide them
      const hidden =
        input.meetingOverrides?.[r.token] !== true &&
        input.hideMeetingsBefore !== null &&
        meetingEnd(r) < input.hideMeetingsBefore &&
        r.unreadMessages === 0 &&
        r.token !== input.activeToken
      if (!hidden) meetings.push(r)
    } else if (isDirect(r)) {
      dms.push(r)
    } else {
      channels.push(r)
    }
  }

  const mode = (id: string, fallback: SortMode): SortMode => sortModes[id] ?? fallback
  const result: SidebarCategory[] = []

  if (favorites.length) {
    result.push({
      id: 'favorites',
      name: 'Favorites',
      kind: 'favorites',
      rooms: sortRooms(favorites, mode('favorites', 'alpha')),
      collapsed: !!collapsed.favorites,
      sortMode: mode('favorites', 'alpha')
    })
  }

  if (useServerTags) {
    for (const t of customTags) {
      result.push({
        id: `tag:${t.id}`,
        name: t.name,
        kind: 'custom',
        tagId: t.id,
        rooms: sortRooms(custom.get(t.id) ?? [], mode(`tag:${t.id}`, 'alpha')),
        collapsed: t.collapsed,
        sortMode: mode(`tag:${t.id}`, 'alpha')
      })
    }
  } else {
    for (const c of localCategories) {
      result.push({
        id: c.id,
        name: c.name,
        kind: 'custom',
        rooms: sortRooms(custom.get(c.id) ?? [], mode(c.id, 'alpha')),
        collapsed: !!collapsed[c.id],
        sortMode: mode(c.id, 'alpha')
      })
    }
  }

  result.push({
    id: 'channels',
    name: 'Channels',
    kind: 'channels',
    rooms: sortRooms(channels, mode('channels', 'alpha')),
    collapsed: !!collapsed.channels,
    sortMode: mode('channels', 'alpha')
  })
  if (meetings.length) {
    result.push({
      id: 'meetings',
      name: 'Meetings',
      kind: 'meetings',
      rooms: sortMeetings(meetings, now),
      collapsed: collapsed.meetings ?? true,
      sortMode: 'recent'
    })
  }
  result.push({
    id: 'dms',
    name: 'Direct Messages',
    kind: 'dms',
    rooms: sortRooms(dms, mode('dms', 'recent')),
    collapsed: !!collapsed.dms,
    sortMode: mode('dms', 'recent')
  })

  if (showArchived && archived.length) {
    result.push({
      id: 'archived',
      name: 'Archived',
      kind: 'archived',
      rooms: sortRooms(archived, 'recent'),
      collapsed: collapsed.archived ?? true,
      sortMode: 'recent'
    })
  }
  return result
}

/**
 * Rooms shown for a category: collapsed categories still show unread and active rooms, like Mattermost,
 * and collapsed Meetings also show meetings that are running or about to start.
 */
export function visibleRooms(
  cat: SidebarCategory,
  activeToken: string | null,
  now = Date.now() / 1000
): Room[] {
  if (!cat.collapsed) return cat.rooms
  return cat.rooms.filter(
    (r) =>
      r.token === activeToken ||
      r.unreadMessages > 0 ||
      r.unreadMention ||
      (cat.kind === 'meetings' && isSoon(r, now))
  )
}
