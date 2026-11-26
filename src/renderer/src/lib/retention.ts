import type { Room, TalkCapabilities } from '@shared/talk-types'
import { eventTime, OBJECT_TYPE_EVENT, OBJECT_TYPE_INSTANT_MEETING } from './events'

// Talk deletes meeting conversations by itself, chat and all: those of calendar events some days
// after the event (when nobody wrote since), instant meetings after a day without activity (the days
// are the server's settings). A moderator can keep one by unbinding it from its meeting.

export interface Expiry {
  /** Unix seconds when Talk may delete the conversation, if nobody writes in it until then */
  at: number
  /** "28 days after the meeting", "after a day without activity" */
  rule: string
}

/** When Talk will delete this conversation, or null when it doesn't */
export function expiryOf(room: Room, caps: TalkCapabilities | undefined): Expiry | null {
  const conv = caps?.config.conversations as
    { 'retention-event'?: number; 'retention-instant-meetings'?: number } | undefined
  const days = (n: number): string => (n === 1 ? 'a day' : `${n} days`)
  if (room.objectType === OBJECT_TYPE_EVENT) {
    const keep = conv?.['retention-event'] ?? 28
    const t = eventTime(room)
    if (!keep || !t) return null
    const at = Math.max(t.end, room.lastActivity) + keep * 86_400
    return { at, rule: `${days(keep)} after the meeting, when nobody writes in it` }
  }
  if (room.objectType === OBJECT_TYPE_INSTANT_MEETING) {
    const keep = conv?.['retention-instant-meetings'] ?? 1
    if (!keep) return null
    return { at: room.lastActivity + keep * 86_400, rule: `after ${days(keep)} without activity` }
  }
  return null
}
