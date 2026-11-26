import { useState } from 'react'
import { Link2, X } from 'lucide-react'
import { ParticipantType, type Room } from '@shared/talk-types'
import type { AccountState } from '@renderer/store/app'
import { stayInConversation } from '@renderer/sync/visited'

// You're in this conversation through its link, not invited: Talk removes you when you leave it, and
// it drops off your list (in every app). Offers to stay, or to ask the moderators to add you.

export function SelfJoinedBar({ account, room }: { account: AccountState; room: Room }) {
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  if (hidden || room.participantType !== ParticipantType.UserSelfJoined) return null
  const listed = (room.listable ?? 0) >= 1
  return (
    <div className="keep-bar">
      <Link2 size={16} />
      <span className="keep-text">
        You joined through the link: Talk takes you out of this conversation when you leave, and it disappears
        from your list. Hubbub remembers it (Cmd+K finds it).
      </span>
      <button
        className="ev-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await stayInConversation(account.info.id, room)
          setBusy(false)
        }}
      >
        {listed ? 'Join permanently' : 'Ask to be added'}
      </button>
      <button className="icon-btn small" title="Hide" onClick={() => setHidden(true)}>
        <X size={15} />
      </button>
    </div>
  )
}
