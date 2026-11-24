import type { Room, TalkCapabilities } from '@shared/talk-types'

/** Why calls in this conversation can't be made in Hubbub, or null if they can. */
export function callUnsupportedReason(caps: TalkCapabilities | undefined, room: Room): string | null {
  if (!caps) return 'Not connected to the server'
  const config = caps.config.call as { enabled?: boolean; 'end-to-end-encryption'?: boolean } | undefined
  if (config?.enabled === false) return 'Calls are turned off on this server'
  if (!caps.features.includes('signaling-v3')) return 'Calls in Hubbub need a newer Talk version'
  if (config?.['end-to-end-encryption']) return 'End-to-end encrypted calls are not supported in Hubbub yet'
  if (room.remoteServer) return 'Calls in conversations on other servers are not supported in Hubbub yet'
  return null
}

/**
 * Whether a call that started in `room` since the last refresh should ring. Calls we started
 * ourselves, silent calls and conversations with call notifications off don't ring.
 */
export function shouldRing(before: Room | undefined, room: Room, selfId: string | undefined): boolean {
  if (!room.hasCall || before?.hasCall) return false
  if (room.notificationCalling === 0) return false
  const last = Array.isArray(room.lastMessage) ? undefined : room.lastMessage
  if (last?.systemMessage !== 'call_started') return true
  if (last.silent) return false
  return !(last.actorType === 'users' && last.actorId === selfId)
}
