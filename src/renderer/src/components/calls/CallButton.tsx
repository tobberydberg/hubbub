import { AppWindow, Maximize2, Phone, PhoneOff } from 'lucide-react'
import type { Room } from '@shared/talk-types'
import { leaveCall, requestCall, setCallExpanded } from '@renderer/calls/call'
import { callUnsupportedReason } from '@renderer/calls/rules'
import type { AccountState } from '@renderer/store/app'
import { useCall } from '@renderer/store/call'
import { focusCallPopout } from './CallPopout'

/** Start, join or leave the call of a conversation, from its header. */
export function CallButton({ account, room }: { account: AccountState; room: Room }) {
  const accountId = account.info.id
  const inThisCall = useCall((s) => s.active?.accountId === accountId && s.active.token === room.token)
  const poppedOut = useCall((s) => !!s.active?.poppedOut)
  const unsupported = callUnsupportedReason(account.caps, room)

  if (inThisCall) {
    return (
      <>
        {poppedOut ? (
          <button className="icon-btn" title="Show the call window" onClick={focusCallPopout}>
            <AppWindow size={18} />
          </button>
        ) : (
          <button className="icon-btn" title="Open the call view" onClick={() => setCallExpanded(true)}>
            <Maximize2 size={18} />
          </button>
        )}
        <button className="call-btn leave" title="Leave call" onClick={() => void leaveCall()}>
          <PhoneOff size={16} />
          Leave
        </button>
      </>
    )
  }
  if (room.hasCall) {
    return (
      <button
        className="call-btn join"
        title={unsupported ? `${unsupported}. Opens in your browser.` : 'Join the call'}
        onClick={() => void requestCall(accountId, room.token)}
      >
        <Phone size={16} />
        Join call
      </button>
    )
  }
  return (
    <button
      className="icon-btn"
      title={unsupported ? `${unsupported}. Opens in your browser.` : 'Start a call'}
      onClick={() => void requestCall(accountId, room.token)}
    >
      <Phone size={18} />
    </button>
  )
}
