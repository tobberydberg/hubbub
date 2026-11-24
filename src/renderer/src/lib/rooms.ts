import { RoomType, type Room } from '@shared/talk-types'

// Group messages (Mattermost's name for direct messages with several people) are Talk group
// conversations created the way Talk extends a one-to-one conversation with more people.

export const GROUP_MESSAGE = 'extended_conversation'

export function isGroupMessage(room: Room): boolean {
  return room.type === RoomType.Group && room.objectType === GROUP_MESSAGE
}

/** Name for a new group message: everyone's names, separated by commas. */
export function groupMessageName(names: string[]): string {
  return names.join(', ').slice(0, 255)
}

/** The conversation's title as shown to us: group messages leave out our own name, like Mattermost. */
export function roomTitle(room: Room, selfName?: string): string {
  if (!isGroupMessage(room) || !selfName) return room.displayName
  const others = room.displayName.split(', ').filter((n) => n !== selfName)
  return others.length ? others.join(', ') : room.displayName
}
