import { useMemo, useState, type DragEvent } from 'react'
import {
  BellOff,
  CalendarDays,
  DoorClosed,
  ExternalLink,
  Files,
  Info,
  Sparkles,
  Star,
  Users,
  X
} from 'lucide-react'
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
import { AbsenceBanner } from './AbsenceBanner'
import { BreakoutBanner } from '../rhs/BreakoutRooms'
import { KeepBar } from './KeepBar'
import { SelfJoinedBar } from './SelfJoinedBar'
import { inLobby } from '@renderer/sync/moderation'
import { canSummarizeChat } from '@renderer/sync/ai'
import { formatAt } from '@renderer/lib/time'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { PinnedBar } from './PinnedBar'
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
  const lobby = inLobby(room)
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
      <PinnedBar accountId={account.info.id} room={room} />
      <BreakoutBanner account={account} room={room} />
      {!lobby && <SummaryBar account={account} room={room} />}
      <KeepBar account={account} room={room} />
      <SelfJoinedBar account={account} room={room} />
      {lobby ? (
        <div className="empty-state lobby">
          <DoorClosed size={40} />
          <h2>You’re in the lobby</h2>
          <p>
            {room.lobbyTimer
              ? `The conversation opens ${formatAt(room.lobbyTimer).replace(/^(Today|Tomorrow)/, (d) => d.toLowerCase())}, or when a moderator lets everyone in.`
              : 'A moderator will let you in. You can wait here; the conversation opens by itself.'}
          </p>
        </div>
      ) : !chat.loaded ? (
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
      {room.type === RoomType.OneToOne && (
        <AbsenceBanner accountId={accountId} userId={room.name} name={room.displayName} />
      )}
      {!lobby && (
        <Composer accountId={accountId} token={room.token} placeholder={placeholder} disabled={readOnly} />
      )}
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
  const toggleRhs = (type: 'members' | 'info' | 'shared'): void =>
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
      {canSummarizeChat(accountId) && room.type !== RoomType.NoteToSelf && (
        <button
          className={`icon-btn${rhs?.type === 'summary' ? ' active' : ''}`}
          title={
            room.unreadMessages ? 'Summarize what you missed, with AI' : 'Summarize the last day, with AI'
          }
          onClick={() => openSummary(accountId, room)}
        >
          <Sparkles size={18} />
        </button>
      )}
      <button
        className={`icon-btn${rhs?.type === 'shared' ? ' active' : ''}`}
        title="Shared items"
        onClick={() => toggleRhs('shared')}
      >
        <Files size={18} />
      </button>
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

/** The AI summary of what you missed, or of the last day when you're up to date */
function openSummary(accountId: string, room: Room): void {
  let from = room.unreadMessages > 0 ? room.lastReadMessage : 0
  if (!from) {
    const chat = useApp.getState().chats[chatKey(accountId, room.token)]
    const dayAgo = Date.now() / 1000 - 86_400
    const first = chat?.ids.find((id) => (chat.byId[id]?.timestamp ?? 0) >= dayAgo)
    from = first ? first - 1 : (chat?.ids[0] ?? 1) - 1
  }
  setApp({ rhs: { type: 'summary', accountId, token: room.token, fromMessageId: Math.max(0, from) } })
}

/** Many unread messages: offer Talk's summary of them, as Talk on the web does */
function SummaryBar({ account, room }: { account: AccountState; room: Room }) {
  const accountId = account.info.id
  const [hidden, setHidden] = useState(false)
  const threshold = account.caps?.config.chat?.['summary-threshold'] ?? 100
  if (hidden || !canSummarizeChat(accountId) || room.unreadMessages < threshold) return null
  return (
    <div className="summary-bar">
      <Sparkles size={16} />
      <span>{room.unreadMessages} unread messages</span>
      <button className="ev-btn" onClick={() => openSummary(accountId, room)}>
        Summarize them
      </button>
      <button className="icon-btn small" title="Hide" onClick={() => setHidden(true)}>
        <X size={15} />
      </button>
    </div>
  )
}
