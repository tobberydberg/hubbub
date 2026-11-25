import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type CallStatus = 'connecting' | 'connected' | 'reconnecting'

export interface CallParticipant {
  /** Signaling session id */
  sessionId: string
  name: string
  userId?: string
  inCall: number
  muted: boolean
  videoOn: boolean
  speaking: boolean
  /** Their media reaches us */
  connected: boolean
  joinedAt: number
  /** When they last started speaking, in ms */
  lastSpokeAt: number
  /** When they raised their hand, in ms; 0 when lowered */
  handRaisedAt: number
  /** They share their screen (stream: callStream(screenKey(sessionId))) */
  screen: boolean
  screenSince: number
  /** Bumped when their media stream changes (see callStream) */
  streamVersion: number
}

export interface CallReaction {
  id: number
  /** Signaling session id, or 'self' */
  from: string
  name: string
  emoji: string
}

export interface ActiveCall {
  accountId: string
  token: string
  status: CallStatus
  /** When we joined, in ms */
  joinedAt: number
  muted: boolean
  speaking: boolean
  /** Joined without a microphone (none found or access denied) */
  listenOnly: boolean
  videoOn: boolean
  cameraAvailable: boolean
  /** The call view is shown instead of the conversation */
  expanded: boolean
  /** The call view is in its own window */
  poppedOut: boolean
  /** We share our screen */
  sharing: boolean
  canShareScreen: boolean
  /** The screen picker is open */
  screenPicker: boolean
  /** The "add people" dialog is open */
  addPeople: boolean
  handRaised: boolean
  /** Recent emoji reactions, shown for a few seconds */
  reactions: CallReaction[]
  selfStreamVersion: number
  participants: Record<string, CallParticipant>
  /** Live captions are on for us (needs the live_transcription app on the server) */
  captionsOn: boolean
  /** The latest live captions, oldest first */
  captions: Caption[]
}

export interface Caption {
  id: number
  /** The speaker's signaling session */
  sessionId: string
  name: string
  text: string
  /** False while the speaker is still in the middle of the sentence */
  final: boolean
}

export interface IncomingCall {
  accountId: string
  token: string
  /** Who started it, for one-to-one calls the other person */
  caller: string
  since: number
}

interface CallStore {
  active: ActiveCall | null
  incoming: IncomingCall[]
}

export const useCall = create<CallStore>()(immer(() => ({ active: null, incoming: [] })))

export function updateCall(fn: (c: ActiveCall) => void): void {
  useCall.setState((s) => {
    if (s.active) fn(s.active)
  })
}

export function isInCall(accountId: string, token: string): boolean {
  const a = useCall.getState().active
  return !!a && a.accountId === accountId && a.token === token
}
