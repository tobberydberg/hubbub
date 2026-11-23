import { useState } from 'react'
import { media } from '@shared/ipc'
import { colorFor, initials } from '@renderer/lib/messages'

interface Props {
  accountId: string
  name: string
  size?: number
  /** Nextcloud user id; when omitted only initials are shown */
  userId?: string
  /** Room token; shows the conversation avatar instead of a user avatar */
  roomToken?: string
  roomVersion?: string
  status?: string | null
  square?: boolean
  dark?: boolean
}

export function Avatar({
  accountId,
  name,
  size = 32,
  userId,
  roomToken,
  roomVersion,
  status,
  square,
  dark
}: Props) {
  const src = roomToken
    ? media.roomAvatar(accountId, roomToken, roomVersion, dark)
    : userId
      ? media.userAvatar(accountId, userId, size > 48 ? 128 : 64)
      : null
  const [failed, setFailed] = useState<string | null>(null)
  const showImage = src && failed !== src

  return (
    <span className={`avatar${square ? ' square' : ''}`} style={{ width: size, height: size }}>
      {showImage ? (
        <img src={src} alt="" draggable={false} onError={() => setFailed(src)} />
      ) : (
        <span
          className="avatar-fallback"
          style={{ background: colorFor(userId ?? name), fontSize: size * 0.4 }}
        >
          {initials(name)}
        </span>
      )}
      {status !== undefined && status !== null && <span className={`status-dot ${status}`} />}
    </span>
  )
}
