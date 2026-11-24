import { ParticipantType, RoomType, type Participant, type Room } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { groupMessageName, isGroupMessage } from '@renderer/lib/rooms'
import { hasFeature, type AccountState } from '@renderer/store/app'
import { useCall } from '@renderer/store/call'
import { callPeople, type PersonRef } from '@renderer/sync/actions'
import { handOverCall } from './call'

// Bringing more people into a running call.

export function isModerator(room: Room): boolean {
  return (
    room.participantType === ParticipantType.Owner ||
    room.participantType === ParticipantType.Moderator ||
    room.participantType === ParticipantType.GuestModerator
  )
}

/**
 * How people are added to this call:
 * - add: rung and, if needed, added to the conversation (moderators)
 * - move: the call moves to a group message with everyone (one-to-ones, which can't take more people,
 *   and group messages we may not add people to)
 * - none: only moderators can add people to this conversation
 */
export function inviteMode(account: AccountState, room: Room): 'add' | 'move' | 'none' {
  if (room.type === RoomType.OneToOne) return 'move'
  if (isModerator(room) && hasFeature(account, 'send-call-notification')) return 'add'
  return isGroupMessage(room) ? 'move' : 'none'
}

/** Conversation members who could be rung: users who aren't in the call. */
export async function notInCall(accountId: string, token: string, selfId: string): Promise<Participant[]> {
  const members = await talk(accountId).participants(token)
  return members.filter((m) => m.actorType === 'users' && m.actorId !== selfId && !(m.inCall & 1))
}

export function ring(accountId: string, token: string, attendeeId: number): Promise<unknown> {
  return talk(accountId).ring(token, attendeeId)
}

/** Adds people to the conversation (if they aren't members yet) and rings them. */
export async function addAndRing(accountId: string, room: Room, people: PersonRef[]): Promise<void> {
  const api = talk(accountId)
  const token = room.token
  let members = await api.participants(token)
  const missing = people.filter((p) => !members.some((m) => m.actorType === 'users' && m.actorId === p.id))
  for (const p of missing) await api.addParticipant(token, p.id)
  if (missing.length) members = await api.participants(token)
  // A group message is named after its people
  if (missing.length && isGroupMessage(room)) {
    await api
      .rename(token, groupMessageName([...room.displayName.split(', '), ...missing.map((p) => p.name)]))
      .catch(() => undefined)
  }
  for (const p of people) {
    const m = members.find((x) => x.actorType === 'users' && x.actorId === p.id)
    if (m && !(m.inCall & 1)) await api.ring(token, m.attendeeId)
  }
}

/**
 * Moves this call to the group message with everyone in it plus `people`, and rings them there. Our
 * microphone, camera, screen share and the call view carry over.
 */
export async function moveCall(
  accountId: string,
  token: string,
  selfId: string,
  people: PersonRef[]
): Promise<void> {
  const members = await talk(accountId).participants(token)
  const current = members
    .filter((m) => m.actorType === 'users' && m.actorId !== selfId)
    .map((m) => ({ id: m.actorId, name: m.displayName }))
  const everyone = [...current, ...people.filter((p) => !current.some((c) => c.id === p.id))]
  const active = useCall.getState().active
  const view = { expanded: !!active?.expanded, poppedOut: !!active?.poppedOut }
  // The group message is found or created first, so we leave this call only when the next is ready
  await callPeople(accountId, everyone, () => handOverCall(view))
}
