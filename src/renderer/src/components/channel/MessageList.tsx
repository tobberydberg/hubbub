import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown } from 'lucide-react'
import type { ChatMessage } from '@shared/talk-types'
import { continuesGroup, formatDateSeparator, isSameDay } from '@renderer/lib/messages'
import type { PendingMessage } from '@renderer/store/app'
import { discardPending, retryPending } from '@renderer/sync/actions'
import type { ThreadEntry } from '@renderer/sync/threads'
import { Avatar } from '../common/Avatar'
import { MessageText } from './MessageText'
import { Post } from './Post'

interface Props {
  accountId: string
  token: string
  messages: ChatMessage[]
  pending: PendingMessage[]
  selfId?: string
  selfName?: string
  participantType?: number
  canEdit: boolean
  unreadFromId?: number | null
  hasMoreOlder?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void
  /** Threads by root message id, for the reply footer under each root */
  threads?: Map<number, ThreadEntry>
  inThread?: boolean
  intro?: ReactNode
  /** Rendered before the list, e.g. the thread root */
  header?: ReactNode
  highlightId?: number
  /** Start content at the top instead of the bottom (thread panel) */
  anchorTop?: boolean
}

const BOTTOM_THRESHOLD = 48

export function MessageList(props: Props) {
  const {
    accountId,
    token,
    messages,
    pending,
    selfId,
    unreadFromId,
    onLoadOlder,
    hasMoreOlder,
    loadingOlder
  } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const prevFirst = useRef<number | null>(null)
  const prevHeight = useRef(0)
  const initialScrollDone = useRef(false)
  const [showJump, setShowJump] = useState(false)
  const lastCount = useRef(messages.length)

  const firstUnreadId = useMemo(() => {
    if (!unreadFromId) return null
    const m = messages.find((x) => x.id > unreadFromId && !(x.actorType === 'users' && x.actorId === selfId))
    return m?.id ?? null
  }, [messages, unreadFromId, selfId])

  // Keep the viewport anchored: stick to the bottom, or preserve position when older messages are prepended
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const first = messages[0]?.id ?? null
    if (!initialScrollDone.current && messages.length) {
      initialScrollDone.current = true
      const sep = el.querySelector('.new-sep') as HTMLElement | null
      if (sep) {
        el.scrollTop = Math.max(0, sep.offsetTop - 80)
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
      } else {
        el.scrollTop = el.scrollHeight
      }
    } else if (
      prevFirst.current !== null &&
      first !== null &&
      first < prevFirst.current &&
      !atBottom.current
    ) {
      el.scrollTop += el.scrollHeight - prevHeight.current
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight
    } else if (messages.length > lastCount.current) {
      setShowJump(true)
    }
    prevFirst.current = first
    prevHeight.current = el.scrollHeight
    lastCount.current = messages.length
  }, [messages, pending.length])

  // Images and embeds change height after load; keep pinned to the bottom when we were there
  useEffect(() => {
    const el = scrollRef.current
    const inner = innerRef.current
    if (!el || !inner) return
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight
      prevHeight.current = el.scrollHeight
    })
    ro.observe(inner)
    return () => ro.disconnect()
  }, [])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
    if (atBottom.current && showJump) setShowJump(false)
    if (el.scrollTop < 300 && hasMoreOlder && !loadingOlder && onLoadOlder) onLoadOlder()
  }

  const jumpToBottom = (): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setShowJump(false)
  }

  // Scroll a highlighted (search result) message into view
  useEffect(() => {
    if (!props.highlightId) return
    const el = scrollRef.current?.querySelector(`[data-message-id="${props.highlightId}"]`)
    el?.scrollIntoView({ block: 'center' })
  }, [props.highlightId, messages.length])

  return (
    <div className="post-list-wrap">
      <div className="post-list" ref={scrollRef} onScroll={onScroll}>
        <div className={`post-list-inner${props.anchorTop ? ' top' : ''}`} ref={innerRef}>
          {hasMoreOlder ? <div className="load-older">{loadingOlder ? 'Loading…' : ''}</div> : props.intro}
          {props.header}
          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const newDay = !prev || !isSameDay(prev.timestamp, m.timestamp)
            const isFirstUnread = m.id === firstUnreadId
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="date-sep">
                    <span>{formatDateSeparator(m.timestamp)}</span>
                  </div>
                )}
                {isFirstUnread && (
                  <div className="new-sep">
                    <span>New Messages</span>
                  </div>
                )}
                <Post
                  accountId={accountId}
                  token={token}
                  msg={m}
                  selfId={selfId}
                  continuation={!newDay && !isFirstUnread && continuesGroup(prev, m)}
                  inThread={props.inThread}
                  thread={props.threads?.get(m.id)}
                  participantType={props.participantType}
                  canEdit={props.canEdit}
                  highlight={m.id === props.highlightId}
                />
              </Fragment>
            )
          })}
          {pending.map((p) => (
            <div key={p.referenceId} className={`post pending${p.error ? ' failed' : ''}`}>
              <div className="post-gutter">
                <Avatar accountId={accountId} userId={selfId} name={props.selfName ?? 'Me'} size={32} />
              </div>
              <div className="post-content">
                <div className="post-header">
                  <span className="post-name">{props.selfName}</span>
                  <span className="post-time">{p.error ? 'Failed to send' : 'Sending…'}</span>
                </div>
                <MessageText markdown={p.message} />
                {p.error && (
                  <div className="pending-actions">
                    <button onClick={() => void retryPending(accountId, token, p.referenceId)}>Retry</button>
                    <button onClick={() => discardPending(accountId, token, p.referenceId)}>Discard</button>
                    <span>{p.error}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {showJump && (
        <button className="jump-new" onClick={jumpToBottom}>
          <ArrowDown size={14} /> New messages
        </button>
      )}
    </div>
  )
}
