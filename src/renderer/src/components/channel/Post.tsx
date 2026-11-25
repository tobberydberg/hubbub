import { memo, useState, type ReactNode } from 'react'
import {
  Copy,
  Languages,
  CornerUpLeft,
  Link,
  MailWarning,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Quote,
  SmilePlus,
  Trash2,
  Check,
  CheckCheck,
  AlarmClock,
  CalendarClock,
  Pin,
  PinOff,
  X
} from 'lucide-react'
import { ParticipantType, RoomType, type ChatMessage } from '@shared/talk-types'
import {
  formatFullDate,
  formatRelative,
  formatTime,
  isEmojiOnly,
  isFullMessage,
  isThreadRoot,
  reactions,
  rootOf,
  toEditableText,
  toPlainText,
  toRenderable
} from '@renderer/lib/messages'
import { chatKey, hasFeature, setApp, useApp } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import { setThreadFollow, type ThreadEntry } from '@renderer/sync/threads'
import {
  confirmDeleteMessage,
  copyText,
  editMessage,
  markUnreadFrom,
  messageLink,
  openThread,
  toggleReaction
} from '@renderer/sync/actions'
import { Avatar } from '../common/Avatar'
import { EmojiPopover } from '../common/EmojiPopover'
import { openProfileCard } from '../common/ProfileCard'
import { Translation } from './Translation'
import { canTranslate } from '@renderer/sync/ai'
import { anchorFrom, Menu, MenuItem, MenuSeparator, MenuTitle, type Anchor } from '../common/Menu'
import { Attachments } from './Attachments'
import { MessageText } from './MessageText'
import { LinkPreview } from './LinkPreview'
import { firstLink } from '@renderer/lib/links'
import { PollCard } from './PollCard'
import { MessageEditor } from './Composer'
import { pickTime, pinMessage, remindMe, removeReminder, unpinMessage } from '@renderer/sync/messaging'
import { choiceHint, formatAt, laterChoices } from '@renderer/lib/time'
import { talk } from '@renderer/api/talk'

export interface PostProps {
  accountId: string
  token: string
  msg: ChatMessage
  selfId?: string
  continuation: boolean
  /** Rendered inside the thread panel */
  inThread?: boolean
  /** The thread this post starts, shown as a Mattermost-style footer */
  thread?: ThreadEntry
  participantType?: number
  canEdit: boolean
  highlight?: boolean
}

const isMac = window.hubbub.platform === 'darwin'
const EDIT_WINDOW = 24 * 3600
const DELETE_WINDOW = 6 * 3600

const PIN_DURATIONS: [string, number | null][] = [
  ['For 24 hours', 24 * 3600],
  ['For 7 days', 7 * 24 * 3600],
  ['For 30 days', 30 * 24 * 3600],
  ['Until unpinned', null]
]

export const Post = memo(function Post(props: PostProps) {
  const { accountId, token, msg, selfId, continuation, inThread, thread } = props
  const [menu, setMenu] = useState<Anchor | null>(null)
  const [translating, setTranslating] = useState(false)
  const [submenu, setSubmenu] = useState<'remind' | 'pin' | null>(null)
  const [reminder, setReminder] = useState<number | null>(null)
  const [emoji, setEmoji] = useState<Anchor | null>(null)
  const recent = usePrefs((s) => s.recentEmojis)
  const collapsed = usePrefs((s) => s.collapsedThreads)
  const linkPreviews = usePrefs((s) => s.linkPreviews)
  const key = chatKey(accountId, token)
  const editing = useApp((s) => s.editing?.chatKey === key && s.editing.id === msg.id)

  const isSystem = !!msg.systemMessage
  const isDeleted = msg.messageType === 'comment_deleted'
  const isOwn = msg.actorType === 'users' && msg.actorId === selfId
  // Read receipts on our own messages: read by everyone once the common read marker passes them
  const readByAll = useApp(
    (s) => isOwn && (s.accounts[accountId]?.rooms[token]?.lastCommonReadMessage ?? 0) >= msg.id
  )
  const receipts = useApp(
    (s) =>
      (s.accounts[accountId]?.caps?.config.chat as { 'read-privacy'?: number } | undefined)?.[
        'read-privacy'
      ] === 0
  )
  const isModerator =
    props.participantType === ParticipantType.Owner || props.participantType === ParticipantType.Moderator
  const lastPinnedId = useApp((s) => s.accounts[accountId]?.rooms[token]?.lastPinnedId)
  const roomType = useApp((s) => s.accounts[accountId]?.rooms[token]?.type)
  const pinsSupported = useApp((s) => hasFeature(s.accounts[accountId], 'pinned-messages'))
  const remindersSupported = useApp((s) => hasFeature(s.accounts[accountId], 'remind-me-later'))
  // Talk lets moderators pin; in a one-to-one conversation both people are
  const canPin =
    pinsSupported && (roomType === RoomType.OneToOne || roomType === RoomType.NoteToSelf || isModerator)
  const age = Date.now() / 1000 - msg.timestamp
  const editable =
    props.canEdit && isOwn && !isDeleted && !isSystem && age < EDIT_WINDOW && toEditableText(msg) !== null
  const deletable = (isOwn || isModerator) && !isDeleted && !isSystem && age < DELETE_WINDOW

  if (isSystem) {
    return (
      <div className="post system">
        <div className="post-gutter" />
        <div className="post-content">
          <div className="post-text">
            {toPlainText(msg)} <span className="post-time">{formatTime(msg.timestamp)}</span>
          </div>
        </div>
      </div>
    )
  }

  const r = toRenderable(msg, selfId)
  const rx = reactions(msg)
  const jumbo = !r.files.length && isEmojiOnly(r.markdown)
  // Like Mattermost: a preview of the first link in a text message
  const previewLink = linkPreviews && !isDeleted && !r.files.length && !r.poll ? firstLink(r.markdown) : null
  const showFooter = !inThread && !!thread && thread.replyCount > 0
  const parent = isFullMessage(msg.parent) ? msg.parent : null

  const close = (): void => {
    setMenu(null)
    setSubmenu(null)
  }
  const pinned = !!msg.metaData?.pinnedAt || lastPinnedId === msg.id
  const openRemind = (): void => {
    setSubmenu('remind')
    setReminder(null)
    void talk(accountId)
      .reminder(token, msg.id)
      .then((r) => setReminder(r?.timestamp ?? null))
  }
  const act = (fn: () => unknown) => (): void => {
    close()
    void fn()
  }

  const reply = (): void => openThread(accountId, token, rootOf(msg))
  const quoteReply = (): void =>
    setApp((s) => {
      s.replyTo[key] = msg
    })
  const startEdit = (): void => setApp({ editing: { chatKey: key, id: msg.id } })

  let body: ReactNode
  if (isDeleted) {
    body = <div className="post-text deleted">(message deleted)</div>
  } else if (editing) {
    body = (
      <MessageEditor
        initial={toEditableText(msg) ?? ''}
        onCancel={() => setApp({ editing: null })}
        onSave={async (text) => {
          if (await editMessage(accountId, token, msg.id, text)) setApp({ editing: null })
        }}
      />
    )
  } else {
    body = (
      <>
        {isThreadRoot(msg) && msg.threadTitle && !inThread && (
          <div className="thread-title">{msg.threadTitle}</div>
        )}
        {r.markdown && (
          <MessageText
            markdown={r.markdown}
            plain={msg.markdown === false}
            className={jumbo ? 'jumbo' : ''}
          />
        )}
        {translating && (
          <Translation
            accountId={accountId}
            text={toEditableText(msg) ?? toPlainText(msg)}
            onClose={() => setTranslating(false)}
          />
        )}
        {previewLink && <LinkPreview accountId={accountId} link={previewLink} />}
        {r.poll && (
          <PollCard
            accountId={accountId}
            token={token}
            pollId={r.poll.id}
            name={r.poll.name}
            canClose={isModerator}
          />
        )}
        <Attachments accountId={accountId} files={r.files} />
      </>
    )
  }

  return (
    <div
      className={[
        'post',
        continuation && 'continuation',
        (menu || emoji) && 'menu-open',
        r.mentionsSelf && !isOwn && 'mentions-me',
        editing && 'editing',
        props.highlight && 'highlight'
      ]
        .filter(Boolean)
        .join(' ')}
      data-message-id={msg.id}
      onClick={(e) => {
        // Mattermost shortcut: Alt+click a post to mark the conversation unread from there
        if (e.altKey && !inThread) {
          e.preventDefault()
          void markUnreadFrom(accountId, token, msg)
        }
      }}
    >
      <div className="post-gutter">
        {continuation ? (
          <span className="post-time-hover" title={formatFullDate(msg.timestamp)}>
            {formatTime(msg.timestamp)}
          </span>
        ) : (
          <span
            className={msg.actorType === 'users' ? 'profile-link' : undefined}
            onClick={
              msg.actorType === 'users'
                ? (e) => openProfileCard(accountId, msg.actorId, msg.actorDisplayName, e.currentTarget)
                : undefined
            }
          >
            <Avatar
              accountId={accountId}
              userId={msg.actorType === 'users' ? msg.actorId : undefined}
              name={msg.actorDisplayName || 'Guest'}
              size={32}
            />
          </span>
        )}
      </div>
      <div className="post-content">
        {!continuation && (
          <div className="post-header">
            <span
              className={`post-name${msg.actorType === 'users' ? ' profile-link' : ''}`}
              onClick={
                msg.actorType === 'users'
                  ? (e) => openProfileCard(accountId, msg.actorId, msg.actorDisplayName, e.currentTarget)
                  : undefined
              }
            >
              {msg.actorDisplayName || (msg.actorType === 'guests' ? 'Guest' : 'Unknown')}
            </span>
            {msg.actorType === 'bots' && <span className="post-tag">Bot</span>}
            {msg.actorType === 'guests' && <span className="post-tag">Guest</span>}
            {pinned && (
              <span
                className="post-pinned"
                title={
                  msg.metaData?.pinnedActorDisplayName
                    ? `Pinned by ${msg.metaData.pinnedActorDisplayName}`
                    : 'Pinned'
                }
              >
                <Pin size={12} /> Pinned
              </span>
            )}
            <span className="post-time" title={formatFullDate(msg.timestamp)}>
              {formatTime(msg.timestamp)}
            </span>
          </div>
        )}
        {parent && !inThread && (
          <div className="post-quote" onClick={() => openThread(accountId, token, rootOf(msg))}>
            <span className="quote-author">{parent.actorDisplayName}</span>
            <span className="quote-text">{toPlainText(parent) || 'Attachment'}</span>
          </div>
        )}
        {body}
        {msg.lastEditTimestamp && !isDeleted && !editing ? (
          <span className="post-edited" title={`Edited ${formatFullDate(msg.lastEditTimestamp)}`}>
            (edited)
          </span>
        ) : null}

        {Object.keys(rx).length > 0 && (
          <div className="reactions">
            {Object.entries(rx).map(([e, count]) => (
              <button
                key={e}
                className={`reaction${msg.reactionsSelf?.includes(e) ? ' self' : ''}`}
                onClick={() => void toggleReaction(accountId, token, msg, e)}
              >
                <span className="emoji">{e}</span>
                {count}
              </button>
            ))}
            <button
              className="reaction reaction-add"
              title="Add reaction"
              onClick={(ev) => setEmoji(anchorFrom(ev.currentTarget))}
            >
              <SmilePlus size={14} />
            </button>
          </div>
        )}

        {showFooter && thread && (
          <div className={`thread-footer${thread.unread ? ' unread' : ''}`}>
            <span className="thread-avatars">
              {thread.participants.slice(0, 3).map((p) => (
                <Avatar
                  key={`${p.actorType}/${p.actorId}`}
                  accountId={accountId}
                  userId={p.actorType === 'users' ? p.actorId : undefined}
                  name={p.name || 'Guest'}
                  size={20}
                />
              ))}
            </span>
            <button className="reply-count" onClick={reply}>
              <MessageCircle size={14} />
              {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
            </button>
            {thread.lastReplyId > 0 && (
              <span className="last-reply">Last reply {formatRelative(thread.lastActivity)}</span>
            )}
            <FollowButton accountId={accountId} thread={thread} />
          </div>
        )}
        {isOwn && receipts && !isDeleted && !inThread && (
          <span
            className={`post-receipt${readByAll ? ' read' : ''}`}
            title={readByAll ? 'Read by everyone' : 'Sent'}
          >
            {readByAll ? <CheckCheck size={14} /> : <Check size={14} />}
          </span>
        )}
      </div>

      {!isDeleted && !editing && (
        <div className="post-menu">
          {recent.slice(0, 3).map((e) => (
            <button
              key={e}
              className="quick-emoji"
              title={`React with ${e}`}
              onClick={() => void toggleReaction(accountId, token, msg, e)}
            >
              {e}
            </button>
          ))}
          <span className="menu-divider" />
          <button
            className="icon-btn"
            title="Add reaction"
            onClick={(e) => setEmoji(anchorFrom(e.currentTarget, 'right'))}
          >
            <SmilePlus size={18} />
          </button>
          {!inThread && (
            <button className="icon-btn" title="Reply" onClick={reply}>
              <CornerUpLeft size={18} />
            </button>
          )}
          <button
            className="icon-btn"
            title="More"
            onClick={(e) => setMenu(anchorFrom(e.currentTarget, 'right'))}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      )}

      {menu && (
        <Menu anchor={menu} onClose={close}>
          {submenu === 'remind' ? (
            <>
              <MenuTitle>Remind me</MenuTitle>
              {laterChoices().map((c) => (
                <MenuItem
                  key={c.label}
                  icon={<AlarmClock size={18} />}
                  label={c.label}
                  hint={choiceHint(c)}
                  onClick={act(() => remindMe(accountId, token, msg.id, c.at))}
                />
              ))}
              <MenuItem
                icon={<CalendarClock size={18} />}
                label="Custom…"
                onClick={act(() =>
                  pickTime(
                    'Remind me',
                    'Set reminder',
                    laterChoices()[3].at,
                    (at) => void remindMe(accountId, token, msg.id, at)
                  )
                )}
              />
              {reminder && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={<X size={18} />}
                    label={`Remove reminder (${formatAt(reminder)})`}
                    onClick={act(() => removeReminder(accountId, token, msg.id))}
                  />
                </>
              )}
            </>
          ) : submenu === 'pin' ? (
            <>
              <MenuTitle>Pin message</MenuTitle>
              {PIN_DURATIONS.map(([label, seconds]) => (
                <MenuItem
                  key={label}
                  icon={<Pin size={18} />}
                  label={label}
                  onClick={act(() =>
                    pinMessage(
                      accountId,
                      token,
                      msg,
                      seconds ? Math.floor(Date.now() / 1000) + seconds : undefined
                    )
                  )}
                />
              ))}
            </>
          ) : (
            <>
              {!inThread && (
                <MenuItem icon={<CornerUpLeft size={18} />} label="Reply in thread" onClick={act(reply)} />
              )}
              {msg.isReplyable !== false && !collapsed && (
                <MenuItem icon={<Quote size={18} />} label="Quote reply" onClick={act(quoteReply)} />
              )}
              {!inThread && (
                <MenuItem
                  icon={<MailWarning size={18} />}
                  label="Mark as unread"
                  hint={isMac ? '⌥ click' : 'Alt+click'}
                  onClick={act(() => markUnreadFrom(accountId, token, msg))}
                />
              )}
              {(remindersSupported || canPin) && <MenuSeparator />}
              {remindersSupported && (
                <MenuItem icon={<AlarmClock size={18} />} label="Remind me…" onClick={openRemind} />
              )}
              {canPin &&
                (pinned ? (
                  <MenuItem
                    icon={<PinOff size={18} />}
                    label="Unpin"
                    onClick={act(() => unpinMessage(accountId, token, msg.id))}
                  />
                ) : (
                  <MenuItem icon={<Pin size={18} />} label="Pin…" onClick={() => setSubmenu('pin')} />
                ))}
              <MenuSeparator />
              {r.markdown && canTranslate(accountId) && (
                <MenuItem
                  icon={<Languages size={18} />}
                  label={translating ? 'Hide translation' : 'Translate'}
                  onClick={act(() => setTranslating(!translating))}
                />
              )}
              <MenuItem
                icon={<Copy size={18} />}
                label="Copy text"
                onClick={act(() => copyText(toEditableText(msg) ?? toPlainText(msg)))}
              />
              <MenuItem
                icon={<Link size={18} />}
                label="Copy link"
                onClick={act(() =>
                  copyText(messageLink(accountId, token, msg.id), 'Link copied to clipboard')
                )}
              />
              {(editable || deletable) && <MenuSeparator />}
              {editable && (
                <MenuItem icon={<Pencil size={18} />} label="Edit" onClick={act(startEdit)} hint="↑" />
              )}
              {deletable && (
                <MenuItem
                  icon={<Trash2 size={18} />}
                  label="Delete"
                  danger
                  onClick={act(() => confirmDeleteMessage(accountId, token, msg))}
                />
              )}
            </>
          )}
        </Menu>
      )}
      {emoji && (
        <EmojiPopover
          anchor={emoji}
          onClose={() => setEmoji(null)}
          onSelect={(e) => {
            if (!msg.reactionsSelf?.includes(e)) void toggleReaction(accountId, token, msg, e)
          }}
        />
      )}
    </div>
  )
})

/** Mattermost's Follow / Following toggle for a thread. */
export function FollowButton({ accountId, thread }: { accountId: string; thread: ThreadEntry }) {
  return (
    <button
      className={`follow-btn${thread.following ? ' on' : ''}`}
      title={thread.following ? 'Unfollow thread' : 'Follow thread to see it in Threads'}
      onClick={(e) => {
        e.stopPropagation()
        void setThreadFollow(accountId, thread, !thread.following)
      }}
    >
      {thread.following ? 'Following' : 'Follow'}
    </button>
  )
}
