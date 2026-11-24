import { Phone, PhoneOff } from 'lucide-react'
import { RoomType } from '@shared/talk-types'
import { startCall } from '@renderer/calls/call'
import { dismissIncoming } from '@renderer/calls/ringing'
import { openRoom, selectAccount } from '@renderer/sync/actions'
import { useApp } from '@renderer/store/app'
import { useCall, type IncomingCall } from '@renderer/store/call'
import { RoomIcon } from '../sidebar/Sidebar'
import { roomTitle } from '@renderer/lib/rooms'

export function IncomingCalls() {
  const incoming = useCall((s) => s.incoming)
  if (!incoming.length) return null
  return (
    <div className="incoming-calls">
      {incoming.map((c) => (
        <Card key={`${c.accountId}/${c.token}`} call={c} />
      ))}
    </div>
  )
}

function Card({ call }: { call: IncomingCall }) {
  const account = useApp((s) => s.accounts[call.accountId])
  const multi = useApp((s) => s.accountOrder.length > 1)
  const room = account?.rooms[call.token]
  if (!account || !room) return null
  const direct = room.type === RoomType.OneToOne
  const name = roomTitle(room, account.user?.displayname)
  const title = direct ? name : call.caller || name
  const sub = direct ? 'is calling you' : call.caller ? `started a call in ${name}` : 'Call started'

  return (
    <div className="incoming-call" role="alertdialog" aria-label={`${title} ${sub}`}>
      <span className="ic-avatar">
        <RoomIcon accountId={call.accountId} room={room} />
      </span>
      <div className="ic-text">
        <div className="ic-title">{title}</div>
        <div className="ic-sub">
          {sub}
          {multi && ` · ${account.info.label}`}
        </div>
      </div>
      <button
        className="ic-btn decline"
        title="Decline"
        onClick={() => dismissIncoming(call.accountId, call.token)}
      >
        <PhoneOff size={18} />
      </button>
      <button
        className="ic-btn join"
        title="Join the call"
        onClick={() => {
          dismissIncoming(call.accountId, call.token)
          // With the call view open, the new call takes its place there; otherwise show its conversation
          if (!useCall.getState().active?.expanded) {
            selectAccount(call.accountId)
            openRoom(call.accountId, call.token)
          }
          void startCall(call.accountId, call.token)
        }}
      >
        <Phone size={18} />
        Join
      </button>
    </div>
  )
}
