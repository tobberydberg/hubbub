import { useMemo, useState, type DragEvent } from 'react'
import { BellOff, CalendarDays, ExternalLink, Info, Star, Users } from 'lucide-react'
import { NotificationLevel, RoomType, type Room } from '@shared/talk-types'
import { formatEventRange } from '@renderer/lib/events'
import { isCollapsedReply } from '@renderer/lib/messages'
import { chatKey, emptyChat, hasFeature, setApp, useApp, type AccountState } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import { toggleFavorite, uploadFiles } from '@renderer/sync/actions'
import { loadOlder } from '@renderer/sync/chat'
import { useThreads, type ThreadEntry } from '@renderer/sync/threads'
import { CallButton } from '../calls/CallButton'
import { RoomIcon } from '../sidebar/Sidebar'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { roomTitle } from '@renderer/lib/rooms'

export function ChannelView({ account, room }: { account: AccountState; room: Room }) {
  const accountId = account.info.id
  const key = chatKey(accountId, room.token)
  const chat = useApp((s) => s.chats[key]) ?? emptyChat()
  const threadsEnabled = hasFeature(account, 'threads')
  const [dragOver, setDragOver] = useState(false)
  const highlightId = useApp((s) => (s.jumpTo?.chatKey === key ? s.jumpTo.id : undefined))

  const collapseReplies = usePrefs((s) => s.collapsedThreads)
  const messages = useMemo(() => {
    const opts = { collapseReplies, nativeThreads: threadsEnabled }
    return chat.ids.map((id) => chat.byId[id]).filter((m) => !isCollapsedReply(m, chat.byId, opts))
  }, [chat.ids, chat.byId, collapseReplies, threadsEnabled])
  const allThreads = useThreads(account)
  const threads = useMemo(() => {
    const map = new Map<number, ThreadEntry>()
    for (const t of allThreads) if (t.token === room.token) map.set(t.rootId, t)
    return map
  }, [allThreads, room.token])
  const pending = useMemo(() => chat.pending.filter((p) => !p.threadId), [chat.pending])

  const readOnly = room.readOnly === 1
  const placeholder =
    room.type === RoomType.OneToOne
      ? `Write to ${room.displayName}`
      : room.type === RoomType.NoteToSelf
        ? 'Write a note to yourself'
        : `Write to ${room.displayName}`

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length && !readOnly) void uploadFiles(accountId, room.token, files)
  }

  return (
    <main
      className="center"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node))
          setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <ChannelHeader account={account} room={room} />
      {!chat.loaded ? (
        <div className="empty-state">
          <div className="spinner" />
        </div>
      ) : chat.error && !messages.length ? (
        <div className="empty-state">
          <h2>Could not load messages</h2>
          <p>{chat.error}</p>
        </div>
      ) : (
        <MessageList
          accountId={accountId}
          token={room.token}
          messages={messages}
          pending={pending}
          selfId={account.user?.id}
          selfName={account.user?.displayname}
          participantType={room.participantType}
          canEdit={hasFeature(account, 'edit-messages')}
          unreadFromId={chat.unreadFromId}
          hasMoreOlder={chat.hasMoreOlder}
          loadingOlder={chat.loadingOlder}
          onLoadOlder={() => void loadOlder(accountId, room.token)}
          threads={threads}
          intro={<ChannelIntro accountId={accountId} room={room} />}
          highlightId={highlightId}
        />
      )}
      <Composer accountId={accountId} token={room.token} placeholder={placeholder} disabled={readOnly} />
      {dragOver && <div className="drop-overlay">Drop files to upload to {room.displayName}</div>}
    </main>
  )
}

function ChannelIntro({ accountId, room }: { accountId: string; room: Room }) {
  const isDm = room.type === RoomType.OneToOne
  return (
    <div className="channel-intro">
      <RoomIcon accountId={accountId} room={room} size={40} />
      <h2>{isDm ? room.displayName : `Beginning of ${room.displayName}`}</h2>
      <p>
        {isDm
          ? `This is the start of your direct message history with ${room.displayName}.`
          : room.description || `Welcome to ${room.displayName}.`}
      </p>
    </div>
  )
}

function ChannelHeader({ account, room }: { account: AccountState; room: Room }) {
  const accountId = account.info.id
  const rhs = useApp((s) => s.rhs)
  const muted = room.notificationLevel === NotificationLevel.Never
  const toggleRhs = (type: 'members' | 'info'): void =>
    setApp({
      rhs:
        rhs?.type === type && 'token' in rhs && rhs.token === room.token
          ? null
          : { type, accountId, token: room.token }
    })
  const webUrl = `${account.info.serverUrl}/index.php/call/${room.token}`
  const isDm = room.type === RoomType.OneToOne
  const eventRange = formatEventRange(room)

  return (
    <header className="channel-header">
      <div className="ch-main">
        <div className="ch-title-row">
          <span className="ch-title">{roomTitle(room, account.user?.displayname)}</span>
          <button
            className={`icon-btn small star-btn${room.isFavorite ? ' on' : ''}`}
            title={room.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => void toggleFavorite(accountId, room.token)}
          >
            <Star size={16} />
          </button>
          {muted && <BellOff size={14} style={{ opacity: 0.5 }} />}
        </div>
        <div className="ch-meta">
          {eventRange && (
            <span className="ch-event">
              <CalendarDays size={14} /> {eventRange}
            </span>
          )}
          {!isDm && room.type !== RoomType.NoteToSelf && (
            <button onClick={() => toggleRhs('members')} title="Members">
              <Users size={14} /> Members
            </button>
          )}
          {isDm && room.statusMessage ? (
            <span className="ch-desc">
              {room.statusIcon} {room.statusMessage}
            </span>
          ) : (
            room.description && <span className="ch-desc">{room.description.split('\n')[0]}</span>
          )}
        </div>
      </div>
      {room.type !== RoomType.NoteToSelf && <CallButton account={account} room={room} />}
      {!isDm && room.type !== RoomType.NoteToSelf && (
        <button
          className={`icon-btn${rhs?.type === 'members' ? ' active' : ''}`}
          title="Members"
          onClick={() => toggleRhs('members')}
        >
          <Users size={18} />
        </button>
      )}
      <button
        className={`icon-btn${rhs?.type === 'info' ? ' active' : ''}`}
        title="Info"
        onClick={() => toggleRhs('info')}
      >
        <Info size={18} />
      </button>
      <button
        className="icon-btn"
        title="Open in browser"
        onClick={() => void window.hubbub.app.openExternal(webUrl)}
      >
        <ExternalLink size={18} />
      </button>
    </header>
  )
}
