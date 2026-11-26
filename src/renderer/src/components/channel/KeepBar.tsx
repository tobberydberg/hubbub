import { useState } from 'react'
import { Archive, X } from 'lucide-react'
import type { Room } from '@shared/talk-types'
import { formatAt } from '@renderer/lib/time'
import { expiryOf } from '@renderer/lib/retention'
import { hasFeature, type AccountState } from '@renderer/store/app'
import { canModerate, keepConversation } from '@renderer/sync/moderation'

// Talk deletes meeting conversations by itself some time after the meeting, chat and all. Moderators
// get a bar to keep one, once the meeting is over.

/** Whether you can keep this conversation from being deleted */
export function canKeep(account: AccountState, room: Room): boolean {
  return hasFeature(account, 'unbind-conversation') && canModerate(room) && !!expiryOf(room, account.caps)
}

export function KeepBar({ account, room }: { account: AccountState; room: Room }) {
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const expiry = expiryOf(room, account.caps)
  const over =
    expiry && (room.objectType === 'instant_meeting' || expiry.at - Date.now() / 1000 < 14 * 86_400)
  if (hidden || !expiry || !over || !canKeep(account, room)) return null
  return (
    <div className="keep-bar">
      <Archive size={16} />
      <span className="keep-text">
        Talk deletes this conversation and its chat {expiry.rule}
        <span className="keep-when"> (around {formatAt(expiry.at)})</span>
      </span>
      <button
        className="ev-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await keepConversation(account.info.id, room)
          setBusy(false)
        }}
      >
        Keep it
      </button>
      <button className="icon-btn small" title="Hide" onClick={() => setHidden(true)}>
        <X size={15} />
      </button>
    </div>
  )
}
