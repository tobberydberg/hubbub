import { useEffect, useState } from 'react'
import { CheckCheck, MessageCircle, MessagesSquare } from 'lucide-react'
import { formatRelative, toPlainText } from '@renderer/lib/messages'
import { chatKey, useApp, type AccountState } from '@renderer/store/app'
import { openThread } from '@renderer/sync/actions'
import { applyMessages } from '@renderer/sync/chat'
import {
  markThreadSeen,
  refreshSubscribedThreads,
  scanRecentConversations,
  useThreads,
  type ThreadEntry
} from '@renderer/sync/threads'
import { Avatar } from '../common/Avatar'
import { FollowButton } from './Post'

const REFRESH_INTERVAL = 60_000

/** Mattermost-style "Threads" view: threads the user follows, across all conversations of a server. */
export function ThreadsView({ account }: { account: AccountState }) {
  const accountId = account.info.id
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [scanning, setScanning] = useState(true)
  const rhs = useApp((s) => s.rhs)
  const threads = useThreads(account).filter((t) => t.following)
  const unread = threads.filter((t) => t.unread)
  const shown = tab === 'unread' ? unread : threads

  useEffect(() => {
    let cancelled = false
    const refresh = (): Promise<void> =>
      Promise.all([refreshSubscribedThreads(accountId), scanRecentConversations(accountId)]).then(() => {
        if (!cancelled) setScanning(false)
      })
    void refresh()
    const t = setInterval(() => void refresh(), REFRESH_INTERVAL)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [accountId])

  const open = (t: ThreadEntry): void => {
    const known = [t.root, t.last].filter((m): m is NonNullable<typeof m> => !!m)
    applyMessages(chatKey(accountId, t.token), known)
    openThread(accountId, t.token, t.rootId)
  }

  const markAllRead = (): void => {
    for (const t of unread) markThreadSeen(accountId, t.token, t.rootId, t.lastReplyId)
  }

  return (
    <main className="center">
      <header className="channel-header">
        <div className="ch-main">
          <div className="ch-title-row">
            <span className="ch-title">Followed threads</span>
          </div>
          <div className="ch-meta">Threads you started, replied to, were mentioned in or follow</div>
        </div>
      </header>
      <div className="threads-tabs">
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          All your threads
        </button>
        <button className={tab === 'unread' ? 'active' : ''} onClick={() => setTab('unread')}>
          Unreads
          {unread.length > 0 && <span className="dot" />}
        </button>
        {scanning && threads.length > 0 && <span className="spinner small" title="Looking for threads…" />}
        <button
          className="btn btn-tertiary small mark-all"
          disabled={!unread.length}
          onClick={markAllRead}
          title="Mark all threads as read"
        >
          <CheckCheck size={14} /> Mark all as read
        </button>
      </div>
      <div className="threads-view">
        {scanning && !threads.length && (
          <div className="empty-state">
            <div className="spinner" />
            <p>Looking for threads in your recent conversations…</p>
          </div>
        )}
        {!scanning && !shown.length && (
          <div className="empty-state">
            <MessagesSquare size={48} />
            <h2>{tab === 'unread' ? 'No unread threads' : 'No followed threads yet'}</h2>
            <p>
              {tab === 'unread'
                ? 'You are all caught up.'
                : 'Threads you start, reply to or are mentioned in show up here. You can also follow any thread from its reply count.'}
            </p>
          </div>
        )}
        {shown.map((t) => (
          <ThreadItem
            key={t.key}
            account={account}
            thread={t}
            selected={rhs?.type === 'thread' && rhs.token === t.token && rhs.rootId === t.rootId}
            onOpen={() => open(t)}
          />
        ))}
      </div>
    </main>
  )
}

function ThreadItem({
  account,
  thread: t,
  selected,
  onOpen
}: {
  account: AccountState
  thread: ThreadEntry
  selected: boolean
  onOpen: () => void
}) {
  const accountId = account.info.id
  const room = account.rooms[t.token]
  const root = t.root
  const text = root ? toPlainText(root) || 'Attachment' : ''
  return (
    <div className={`thread-item${selected ? ' selected' : ''}${t.unread ? ' unread' : ''}`} onClick={onOpen}>
      {t.unread && <span className="ti-dot" />}
      <div className="ti-head">
        {root && (
          <Avatar
            accountId={accountId}
            userId={root.actorType === 'users' ? root.actorId : undefined}
            name={root.actorDisplayName || 'Guest'}
            size={20}
          />
        )}
        <b>{root?.actorDisplayName ?? 'Thread'}</b>
        <span className="ti-channel">{room?.displayName ?? 'Conversation'}</span>
        <span className="ti-time">{formatRelative(t.lastActivity)}</span>
        <span className="ti-actions">
          {t.unread && (
            <button
              className="btn btn-tertiary small"
              onClick={(e) => {
                e.stopPropagation()
                markThreadSeen(accountId, t.token, t.rootId, t.lastReplyId)
              }}
            >
              Mark as read
            </button>
          )}
          <FollowButton accountId={accountId} thread={t} />
        </span>
      </div>
      {t.title && <div className="ti-title">{t.title}</div>}
      <div className="ti-text">{text}</div>
      <div className="thread-footer">
        <span className="thread-avatars">
          {t.participants.slice(0, 3).map((p) => (
            <Avatar
              key={`${p.actorType}/${p.actorId}`}
              accountId={accountId}
              userId={p.actorType === 'users' ? p.actorId : undefined}
              name={p.name || 'Guest'}
              size={20}
            />
          ))}
        </span>
        <span className="reply-count">
          <MessageCircle size={14} /> {t.replyCount} {t.replyCount === 1 ? 'reply' : 'replies'}
        </span>
        {t.last && (
          <span className="last-reply">
            {t.last.actorDisplayName}: {toPlainText(t.last).slice(0, 80)}
          </span>
        )}
      </div>
    </div>
  )
}
