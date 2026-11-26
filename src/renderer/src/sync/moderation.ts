import { talk } from '@renderer/api/talk'
import { ParticipantType, RoomType, type Participant, type Room } from '@shared/talk-types'
import { setApp, showToast, useApp } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import { getSync } from './engine'

// Moderating a conversation: the lobby, read-only, disappearing messages, what everyone may do,
// moderators, removing and banning people, and clearing the history. Every change is made on the
// server, then the conversation list is refreshed so the change shows everywhere.

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Whether you moderate this conversation */
export function canModerate(room: Room | undefined): boolean {
  return (
    !!room &&
    (room.participantType === ParticipantType.Owner ||
      room.participantType === ParticipantType.Moderator ||
      room.participantType === ParticipantType.GuestModerator) &&
    room.type !== RoomType.OneToOne &&
    room.type !== RoomType.NoteToSelf &&
    room.type !== RoomType.OneToOneFormer
  )
}

export const isModeratorType = (type: number): boolean =>
  type === ParticipantType.Owner ||
  type === ParticipantType.Moderator ||
  type === ParticipantType.GuestModerator

/** Runs a change, tells the user when it fails, and refreshes the conversation; resolves with success */
export async function moderate(
  accountId: string,
  what: string,
  change: () => Promise<unknown>,
  done?: string
): Promise<boolean> {
  try {
    await change()
    if (done) showToast(done)
    void getSync(accountId)?.refreshRooms()
    return true
  } catch (err) {
    showToast(`${what} didn’t work: ${errorText(err)}`, 'error')
    return false
  }
}

export function confirmRemove(accountId: string, token: string, p: Participant, onDone: () => void): void {
  setApp({
    modal: {
      type: 'confirm',
      title: `Remove ${p.displayName || p.actorId}?`,
      body: 'They are removed from the conversation and can be added again later.',
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async () => {
        if (await moderate(accountId, 'Removing', () => talk(accountId).removeAttendee(token, p.attendeeId)))
          onDone()
      }
    }
  })
}

export function confirmClearHistory(accountId: string, token: string, name: string): void {
  setApp({
    modal: {
      type: 'confirm',
      title: `Delete all messages in ${name}?`,
      body: 'Every message, file share and poll is deleted for everyone. This cannot be undone.',
      confirmLabel: 'Delete all messages',
      danger: true,
      onConfirm: async () => {
        await moderate(
          accountId,
          'Deleting the messages',
          () => talk(accountId).clearHistory(token),
          'All messages were deleted'
        )
      }
    }
  })
}

/** Whether you can't see the chat because the lobby is on and you're not a moderator */
export function inLobby(room: Room): boolean {
  return room.lobbyState === 1 && !isModeratorType(room.participantType) && !((room.permissions ?? 0) & 8)
}

export function useRoom(accountId: string, token: string): Room | undefined {
  return useApp((s) => s.accounts[accountId]?.rooms[token])
}

/**
 * Keeps a meeting conversation that Talk would otherwise delete (with its chat) some time after the
 * meeting: it's unbound from its meeting and becomes an ordinary conversation, which Hubbub still
 * lists under Meetings.
 */
export async function keepConversation(accountId: string, room: Room): Promise<boolean> {
  const ok = await moderate(
    accountId,
    'Keeping the conversation',
    () => talk(accountId).unbindFromObject(room.token),
    `${room.displayName} is kept: Talk won't delete it`
  )
  if (ok) {
    const prefs = usePrefs.getState()
    prefs.set({
      meetingOverrides: {
        ...prefs.meetingOverrides,
        [accountId]: { ...prefs.meetingOverrides[accountId], [room.token]: true }
      }
    })
  }
  return ok
}
