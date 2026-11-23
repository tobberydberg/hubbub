import { useEffect, useMemo, useState } from 'react'
import { Bell, Copy, ExternalLink, Maximize2, Minimize2, MessageSquare, Search, X } from 'lucide-react'
import {
  NotificationLevel,
  ParticipantType,
  RoomType,
  type Participant,
  type Room,
  type UnifiedSearchEntry
} from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { belongsTo } from '@renderer/lib/messages'
import {
  chatKey,
  emptyChat,
  hasFeature,
  setApp,
  useApp,
  type AccountState,
  type RhsState
} from '@renderer/store/app'
import { closeRhs, copyText, jumpToMessage, openDirectMessage, setMuted } from '@renderer/sync/actions'
import { getSync } from '@renderer/sync/engine'
import { markThreadSeen, useThreads } from '@renderer/sync/threads'
import { Avatar } from '../common/Avatar'
import { Composer } from '../channel/Composer'
import { MessageList } from '../channel/MessageList'
import { FollowButton, Post } from '../channel/Post'

export function Rhs() {
  const rhs = useApp((s) => s.rhs)
  const account = useApp((s) => (s.rhs ? s.accounts[s.rhs.accountId] : undefined))
  const [expanded, setExpanded] = useState(false)
  const threadTitle = useApp((s) =>
    s.rhs?.type === 'thread'
      ? s.chats[chatKey(s.rhs.accountId, s.rhs.token)]?.byId[s.rhs.rootId]?.threadTitle
      : undefined
  )
  const threads = useThreads(account)
  if (!rhs || !account) return null
  const thread =
    rhs.type === 'thread' ? threads.find((t) => t.token === rhs.token && t.rootId === rhs.rootId) : undefined

  const room = 'token' in rhs ? account.rooms[rhs.token] : undefined
  const title =
    rhs.type === 'thread'
      ? 'Thread'
      : rhs.type === 'members'
        ? 'Members'
        : rhs.type === 'info'
          ? 'Info'
          : 'Search Results'
  const sub =
    rhs.type === 'search'
      ? `"${rhs.query}" on ${account.info.label}`
      : [room?.displayName, threadTitle].filter(Boolean).join(' · ')

  return (
    <aside className={`rhs${expanded ? ' expanded' : ''}`}>
      <div className="rhs-header">
        <div className="rhs-title">
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {thread && <FollowButton accountId={account.info.id} thread={thread} />}
        <button
          className="icon-btn"
          title={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button className="icon-btn" title="Close" onClick={closeRhs}>
          <X size={18} />
        </button>
      </div>
      {rhs.type === 'thread' && room && (
        <ThreadPanel
          key={`${rhs.token}#${rhs.rootId}`}
          account={account}
          room={room}
          rootId={rhs.rootId}
          lastReplyId={thread?.lastReplyId ?? 0}
        />
      )}
      {rhs.type === 'members' && room && <MembersPanel account={account} room={room} />}
      {rhs.type === 'info' && room && <InfoPanel account={account} room={room} />}
      {rhs.type === 'search' && <SearchPanel account={account} rhs={rhs} />}
      {!room && rhs.type !== 'search' && (
        <div className="empty-state">
          <p>This conversation is no longer available.</p>
        </div>
      )}
    </aside>
  )
}

function ThreadPanel({
  account,
  room,
  rootId,
  lastReplyId
}: {
  account: AccountState
  room: Room
  rootId: number
  /** Newest reply the server knows of; seen once the panel is open */
  lastReplyId: number
}) {
  const accountId = account.info.id
  const key = chatKey(accountId, room.token)
  const chat = useApp((s) => s.chats[key]) ?? emptyChat()
  const root = chat.byId[rootId]
  const native = hasFeature(account, 'threads') && (!root || !!root.isThread)
  const replies = useMemo(
    () => chat.ids.map((id) => chat.byId[id]).filter((m) => belongsTo(m, rootId, chat.byId)),
    [chat.ids, chat.byId, rootId]
  )
  const newestReply = Math.max(replies.at(-1)?.id ?? 0, lastReplyId)
  useEffect(
    () => markThreadSeen(accountId, room.token, rootId, newestReply),
    [accountId, room.token, rootId, newestReply]
  )
  const pending = useMemo(
    () => chat.pending.filter((p) => p.threadId === rootId || p.replyTo === rootId),
    [chat.pending, rootId]
  )
  const loading = native && !chat.loadedThreads[rootId]
  const canEdit = hasFeature(account, 'edit-messages')

  const header = root ? (
    <div className="rhs-root">
      <Post
        accountId={accountId}
        token={room.token}
        msg={root}
        selfId={account.user?.id}
        continuation={false}
        inThread
        participantType={room.participantType}
        canEdit={canEdit}
      />
      <div className="reply-count-sep">
        {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        {loading && <span className="spinner small" />}
      </div>
    </div>
  ) : (
    <div className="empty-state">
      <div className="spinner" />
    </div>
  )

  return (
    <>
      <MessageList
        accountId={accountId}
        token={room.token}
        messages={replies}
        pending={pending}
        selfId={account.user?.id}
        selfName={account.user?.displayname}
        participantType={room.participantType}
        canEdit={canEdit}
        inThread
        anchorTop
        header={header}
      />
      <Composer
        accountId={accountId}
        token={room.token}
        placeholder="Reply to thread…"
        thread={{ rootId, native }}
        disabled={room.readOnly === 1}
      />
    </>
  )
}

const ROLE: Record<number, string> = {
  [ParticipantType.Owner]: 'Owner',
  [ParticipantType.Moderator]: 'Moderator',
  [ParticipantType.GuestModerator]: 'Moderator',
  [ParticipantType.Guest]: 'Guest'
}

function MembersPanel({ account, room }: { account: AccountState; room: Room }) {
  const accountId = account.info.id
  const [members, setMembers] = useState<Participant[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    talk(accountId)
      .participants(room.token)
      .then((p) => !cancelled && setMembers(p))
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
    return () => {
      cancelled = true
    }
  }, [accountId, room.token])

  if (error) return <div className="empty-state">{error}</div>
  if (!members) {
    return (
      <div className="empty-state">
        <div className="spinner" />
      </div>
    )
  }
  const q = filter.toLowerCase()
  const shown = members
    .filter((m) => !q || m.displayName.toLowerCase().includes(q) || m.actorId.toLowerCase().includes(q))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
  const online = shown.filter((m) => m.status && m.status !== 'offline' && m.status !== 'invisible')
  const offline = shown.filter((m) => !online.includes(m))

  const row = (m: Participant) => (
    <div className="member-row" key={m.attendeeId}>
      <Avatar
        accountId={accountId}
        userId={m.actorType === 'users' ? m.actorId : undefined}
        name={m.displayName || m.actorId}
        size={32}
        status={m.actorType === 'users' ? (m.status ?? 'offline') : null}
      />
      <span className="name">
        {m.displayName || m.actorId}
        {m.actorId === account.user?.id && m.actorType === 'users' ? ' (you)' : ''}
        {m.statusMessage && (
          <div className="role">
            {m.statusIcon} {m.statusMessage}
          </div>
        )}
      </span>
      {ROLE[m.participantType] && <span className="role">{ROLE[m.participantType]}</span>}
      {m.actorType === 'users' && m.actorId !== account.user?.id && (
        <button
          className="icon-btn small"
          title="Send a direct message"
          onClick={() => void openDirectMessage(accountId, m.actorId)}
        >
          <MessageSquare size={16} />
        </button>
      )}
    </div>
  )

  return (
    <div className="rhs-body">
      <div style={{ padding: '12px 20px 4px' }}>
        <input
          className="input"
          placeholder="Search members"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {online.length > 0 && <div className="rhs-section-title">Online — {online.length}</div>}
      {online.map(row)}
      {offline.length > 0 && <div className="rhs-section-title">Offline — {offline.length}</div>}
      {offline.map(row)}
    </div>
  )
}

const LEVELS = [
  { value: NotificationLevel.Default, label: 'Default' },
  { value: NotificationLevel.Always, label: 'All messages' },
  { value: NotificationLevel.Mention, label: 'Mentions only' },
  { value: NotificationLevel.Never, label: 'Never (muted)' }
]

function InfoPanel({ account, room }: { account: AccountState; room: Room }) {
  const accountId = account.info.id
  const link = `${account.info.serverUrl}/index.php/call/${room.token}`
  const typeLabel =
    {
      [RoomType.OneToOne]: 'Direct message',
      [RoomType.Group]: 'Private channel',
      [RoomType.Public]: 'Public channel (anyone with the link can join)',
      [RoomType.Changelog]: 'Changelog',
      [RoomType.OneToOneFormer]: 'Former direct message',
      [RoomType.NoteToSelf]: 'Note to self'
    }[room.type] ?? 'Conversation'

  const setLevel = async (level: number): Promise<void> => {
    if (level === NotificationLevel.Never) return setMuted(accountId, room.token, true)
    await talk(accountId)
      .setNotificationLevel(room.token, level)
      .catch(() => undefined)
    void getSync(accountId)?.refreshRooms()
  }

  return (
    <div className="rhs-body">
      <div className="info-block" style={{ paddingTop: 20 }}>
        <div className="label">Type</div>
        <div>{typeLabel}</div>
      </div>
      {room.description && (
        <div className="info-block">
          <div className="label">Description</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{room.description}</div>
        </div>
      )}
      <div className="info-block">
        <div className="label">
          <Bell size={12} /> Notifications
        </div>
        <select
          className="input"
          value={room.notificationLevel}
          onChange={(e) => void setLevel(Number(e.target.value))}
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <div className="info-block">
        <div className="label">Link</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-tertiary small"
            onClick={() => void copyText(link, 'Link copied to clipboard')}
          >
            <Copy size={14} /> Copy link
          </button>
          <button
            className="btn btn-tertiary small"
            onClick={() => void window.hubbub.app.openExternal(link)}
          >
            <ExternalLink size={14} /> Open in browser
          </button>
        </div>
      </div>
    </div>
  )
}

function parseEntry(e: UnifiedSearchEntry): { token: string; messageId: number } | null {
  const token = e.attributes?.conversation
  const id = Number(e.attributes?.messageId)
  if (token && id) return { token, messageId: id }
  const m = /\/call\/([a-z0-9]+)#message_(\d+)/i.exec(e.resourceUrl)
  return m ? { token: m[1], messageId: Number(m[2]) } : null
}

function SearchPanel({
  account,
  rhs
}: {
  account: AccountState
  rhs: Extract<RhsState, { type: 'search' }>
}) {
  const accountId = account.info.id
  const [results, setResults] = useState<UnifiedSearchEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setResults(null)
    setError(null)
    talk(accountId)
      .searchMessages(rhs.query, 30)
      .then((r) => !cancelled && setResults(r.entries))
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
    return () => {
      cancelled = true
    }
  }, [accountId, rhs.query])

  if (error) return <div className="empty-state">{error}</div>
  if (!results) {
    return (
      <div className="empty-state">
        <div className="spinner" />
      </div>
    )
  }
  if (!results.length) {
    return (
      <div className="empty-state">
        <Search size={40} />
        <h2>No results for “{rhs.query}”</h2>
        <p>Check the spelling or try another search.</p>
      </div>
    )
  }
  return (
    <div className="rhs-body">
      {results.map((e, i) => {
        const target = parseEntry(e)
        const room = target ? account.rooms[target.token] : undefined
        return (
          <div
            key={`${e.resourceUrl}-${i}`}
            className="search-result"
            onClick={() => target && void jumpToMessage(accountId, target.token, target.messageId)}
          >
            <div className="sr-channel">{room?.displayName ?? e.title}</div>
            <div className="sr-title">{room ? e.title : ''}</div>
            <div className="sr-text">{e.subline}</div>
          </div>
        )
      })}
    </div>
  )
}

export function openSearch(accountId: string, query: string): void {
  if (query.trim()) setApp({ rhs: { type: 'search', accountId, query: query.trim() } })
}
