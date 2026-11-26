import { talk, TalkError } from '@renderer/api/talk'
import { ParticipantType, type Room } from '@shared/talk-types'
import { showToast, useApp } from '@renderer/store/app'
import { usePrefs, type VisitedRoom } from '@renderer/store/prefs'
import { joinListedRoom, sendMessage } from './actions'

// Conversations you joined through their link without being invited ("self-joined"). Talk removes
// you from those as soon as you leave, so they vanish from your list, although the conversation
// and its chat are still there. Hubbub remembers them, so they can be found and opened again.

const KEEP = 100

/** Notes the conversations you're in through their link */
export function rememberVisited(accountId: string, rooms: Room[]): void {
  const joined = rooms.filter((r) => r.participantType === ParticipantType.UserSelfJoined)
  if (!joined.length) return
  const prefs = usePrefs.getState()
  const before = prefs.visitedRooms[accountId] ?? []
  const fresh: VisitedRoom[] = joined.map((r) => ({
    token: r.token,
    name: r.name,
    displayName: r.displayName,
    type: r.type,
    objectType: r.objectType,
    objectId: r.objectId,
    lastActivity: r.lastActivity
  }))
  const same = fresh.every((f) =>
    before.some(
      (b) => b.token === f.token && b.lastActivity === f.lastActivity && b.displayName === f.displayName
    )
  )
  if (same) return
  const tokens = new Set(fresh.map((f) => f.token))
  prefs.set({
    visitedRooms: {
      ...prefs.visitedRooms,
      [accountId]: [...fresh, ...before.filter((b) => !tokens.has(b.token))].slice(0, KEEP)
    }
  })
}

/** Conversations joined through their link that you've left (not in your list any more) */
export function leftVisited(accountId: string): VisitedRoom[] {
  const rooms = useApp.getState().accounts[accountId]?.rooms ?? {}
  return (usePrefs.getState().visitedRooms[accountId] ?? []).filter((v) => !rooms[v.token])
}

export function forgetVisited(accountId: string, token: string): void {
  const prefs = usePrefs.getState()
  prefs.set({
    visitedRooms: {
      ...prefs.visitedRooms,
      [accountId]: (prefs.visitedRooms[accountId] ?? []).filter((v) => v.token !== token)
    }
  })
}

/** Opens a conversation through its link again (you're in it while it's open), chat and all */
export async function reopenByLink(accountId: string, token: string, name?: string): Promise<boolean> {
  try {
    await joinListedRoom(accountId, token)
    return true
  } catch (err) {
    if (err instanceof TalkError && err.status === 404) {
      forgetVisited(accountId, token)
      showToast(`${name ?? 'The conversation'} doesn’t exist any more: it was deleted`, 'error')
    } else if (err instanceof TalkError && (err.status === 403 || err.status === 401)) {
      showToast(
        `You can’t join ${name ?? 'the conversation'} any more (it may need a password, or you were removed)`,
        'error'
      )
    } else {
      showToast(
        `${name ?? 'The conversation'} couldn’t be opened: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      )
    }
    return false
  }
}

/**
 * Makes you a permanent member of a conversation you're in through its link, so it stays in your
 * list. Possible when it's open to users of the server (listed): leaving and joining again from
 * the list makes you a member. Otherwise the moderators are asked in the chat to add you.
 */
export async function stayInConversation(accountId: string, room: Room): Promise<void> {
  const api = talk(accountId)
  try {
    if ((room.listable ?? 0) >= 1) {
      await api.leave(room.token)
      await joinListedRoom(accountId, room.token)
      showToast(`You’re now a member of ${room.displayName}: it stays in your list`)
      return
    }
    const selfId = useApp.getState().accounts[accountId]?.user?.id
    const moderators = (await api.participants(room.token)).filter(
      (m) =>
        m.actorType === 'users' &&
        m.actorId !== selfId &&
        (m.participantType === 1 || m.participantType === 2)
    )
    const mentions = moderators.map((m) => `@"${m.actorId}"`).join(' ')
    await sendMessage(
      accountId,
      room.token,
      `Could you add me to this conversation, so that it stays in my list after I leave? ${mentions}`.trim()
    )
    showToast('Asked the moderators to add you')
  } catch (err) {
    showToast(`That didn’t work: ${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}
