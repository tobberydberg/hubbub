import { useState } from 'react'
import { Archive } from 'lucide-react'
import type { Room } from '@shared/talk-types'
import { expiryOf } from '@renderer/lib/retention'
import { formatAt } from '@renderer/lib/time'
import type { AccountState } from '@renderer/store/app'
import { keepConversation } from '@renderer/sync/moderation'
import { canKeep } from '../channel/KeepBar'

/** In a meeting conversation's Info panel: when Talk deletes it, and keeping it */
export function RetentionInfo({ account, room }: { account: AccountState; room: Room }) {
  const [busy, setBusy] = useState(false)
  const expiry = expiryOf(room, account.caps)
  if (!expiry) return null
  return (
    <div className="info-block">
      <div className="label">
        <Archive size={12} /> Kept until
      </div>
      <div>
        Talk deletes this meeting conversation and its chat {expiry.rule}: around {formatAt(expiry.at)}.
      </div>
      {canKeep(account, room) ? (
        <button
          className="btn btn-tertiary small"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await keepConversation(account.info.id, room)
            setBusy(false)
          }}
        >
          <Archive size={14} /> Keep this conversation
        </button>
      ) : (
        <div className="mod-sub" style={{ marginTop: 6 }}>
          A moderator can keep it.
        </div>
      )}
    </div>
  )
}
