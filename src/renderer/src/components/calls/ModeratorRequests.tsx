import { ShieldCheck } from 'lucide-react'
import { answerModeratorRequest, askModeratorsInChat, askToBecomeModerator } from '@renderer/calls/call'
import { RoomType } from '@shared/talk-types'
import { useApp } from '@renderer/store/app'
import type { ActiveCall } from '@renderer/store/call'
import { canModerate } from '@renderer/sync/moderation'

// Asking to become a moderator during a call, and the moderators' answer. Talk has no such request:
// it goes from Hubbub to Hubbub over the call connection, and to the chat when nobody answers.

/** For moderators: who asks, with Make moderator and Not now */
export function ModeratorRequestsBar({ call, compact }: { call: ActiveCall; compact?: boolean }) {
  if (!call.moderatorRequests.length) return null
  return (
    <div className={`mod-requests${compact ? ' compact' : ''}`}>
      {call.moderatorRequests.map((r) => (
        <div key={r.userId} className="mod-request">
          <ShieldCheck size={16} />
          <span className="mod-request-text">
            <b>{r.name}</b> asks to become a moderator
          </span>
          <button className="ev-btn" onClick={() => void answerModeratorRequest(r, true)}>
            Make moderator
          </button>
          <button className="ev-btn light" onClick={() => void answerModeratorRequest(r, false)}>
            Not now
          </button>
        </div>
      ))}
    </div>
  )
}

/** For everyone else in a channel's call: ask, and how the asking went */
export function AskToModerate({ call }: { call: ActiveCall }) {
  const room = useApp((s) => s.accounts[call.accountId]?.rooms[call.token])
  if (!room || canModerate(room) || (room.type !== RoomType.Group && room.type !== RoomType.Public))
    return null
  if (room.participantType === 4) return null // guests can't be made moderators here
  const ask = call.moderatorAsk
  return (
    <div className="ask-moderate">
      {!ask || ask.state === 'declined' ? (
        <>
          {ask?.state === 'declined' && <p className="mod-sub">A moderator said not now.</p>}
          <button className="ev-btn light" onClick={askToBecomeModerator}>
            <ShieldCheck size={15} /> Ask to become a moderator
          </button>
        </>
      ) : ask.state === 'waiting' ? (
        <p className="mod-sub">Asked the moderators. Waiting for an answer…</p>
      ) : ask.state === 'unanswered' ? (
        <>
          <p className="mod-sub">
            No moderator answered here. They may be using Talk on the web or their phone: ask in the chat,
            where they’re mentioned.
          </p>
          <button className="ev-btn light" onClick={() => void askModeratorsInChat()}>
            Ask in the chat
          </button>
        </>
      ) : ask.state === 'asked-in-chat' ? (
        <p className="mod-sub">Asked in the chat.</p>
      ) : (
        <p className="mod-sub">You’re a moderator now.</p>
      )}
    </div>
  )
}
