import { useEffect, useState } from 'react'
import { Pin, X } from 'lucide-react'
import { ParticipantType, RoomType, type ChatMessage, type Room } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { toPlainText } from '@renderer/lib/messages'
import { chatKey, useApp } from '@renderer/store/app'
import { jumpToMessage } from '@renderer/sync/actions'
import { hidePinned, unpinMessage } from '@renderer/sync/messaging'

/** The conversation's last pinned message, at the top, unless we hid it. */
export function PinnedBar({ accountId, room }: { accountId: string; room: Room }) {
  const id = room.lastPinnedId && room.lastPinnedId !== room.hiddenPinnedId ? room.lastPinnedId : 0
  const loaded = useApp((s) => (id ? s.chats[chatKey(accountId, room.token)]?.byId[id] : undefined))
  const [fetched, setFetched] = useState<ChatMessage | null>(null)

  useEffect(() => {
    setFetched(null)
    if (!id || loaded) return
    // Older than what is loaded: fetch just that message
    void talk(accountId)
      .context(room.token, id, 1)
      .then((list) => setFetched(list.find((m) => m.id === id) ?? null))
      .catch(() => undefined)
  }, [accountId, room.token, id, loaded])

  const msg = loaded ?? fetched
  if (!id || !msg) return null
  const canUnpin =
    room.type === RoomType.OneToOne ||
    room.type === RoomType.NoteToSelf ||
    room.participantType === ParticipantType.Owner ||
    room.participantType === ParticipantType.Moderator
  return (
    <div className="pinned-bar">
      <Pin size={14} className="pinned-icon" />
      <button
        className="pinned-text"
        title="Go to the message"
        onClick={() => void jumpToMessage(accountId, room.token, id)}
      >
        <b>{msg.actorDisplayName}:</b> {toPlainText(msg)}
      </button>
      {msg.metaData?.pinnedActorDisplayName && (
        <span className="pinned-by">Pinned by {msg.metaData.pinnedActorDisplayName}</span>
      )}
      {canUnpin && (
        <button
          className="btn btn-tertiary small"
          onClick={() => void unpinMessage(accountId, room.token, id)}
        >
          Unpin
        </button>
      )}
      <button
        className="icon-btn small"
        title="Hide for me"
        onClick={() => void hidePinned(accountId, room.token, id)}
      >
        <X size={14} />
      </button>
    </div>
  )
}
