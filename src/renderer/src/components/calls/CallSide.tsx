import { useMemo } from 'react'
import { Hand, MicOff, UserPlus, Video, X } from 'lucide-react'
import { isCollapsedReply } from '@renderer/lib/messages'
import { chatKey, emptyChat, hasFeature, useApp } from '@renderer/store/app'
import { updateCall, type ActiveCall } from '@renderer/store/call'
import { usePrefs } from '@renderer/store/prefs'
import { loadOlder } from '@renderer/sync/chat'
import { Avatar } from '../common/Avatar'
import { Composer } from '../channel/Composer'
import { MessageList } from '../channel/MessageList'
import { AskToModerate } from './ModeratorRequests'

// The call view's side panel: who is in the call (hands raised first), or the conversation's chat,
// so neither means leaving the call view.

export interface SidePerson {
  id: string
  self?: boolean
  name: string
  userId?: string
  muted: boolean
  videoOn: boolean
  speaking: boolean
  handRaised: boolean
  handRaisedAt?: number
}

export function CallSide({ call, people }: { call: ActiveCall; people: SidePerson[] }) {
  const close = (): void => updateCall((c) => void (c.side = null))
  return (
    <aside className="cv-side">
      <div className="cv-side-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={call.side === 'people'}
          className={call.side === 'people' ? 'active' : ''}
          onClick={() => updateCall((c) => void (c.side = 'people'))}
        >
          People · {people.length}
        </button>
        <button
          role="tab"
          aria-selected={call.side === 'chat'}
          className={call.side === 'chat' ? 'active' : ''}
          onClick={() => updateCall((c) => void (c.side = 'chat'))}
        >
          Chat
        </button>
        <button className="cv-side-close" title="Close" onClick={close}>
          <X size={16} />
        </button>
      </div>
      {call.side === 'people' ? (
        <People call={call} people={people} />
      ) : (
        <Chat accountId={call.accountId} token={call.token} />
      )}
    </aside>
  )
}

function People({ call, people }: { call: ActiveCall; people: SidePerson[] }) {
  const sorted = useMemo(
    () =>
      [...people].sort(
        (a, b) =>
          Number(b.handRaised) - Number(a.handRaised) ||
          (a.handRaisedAt ?? 0) - (b.handRaisedAt ?? 0) ||
          Number(!!b.self) - Number(!!a.self) ||
          a.name.localeCompare(b.name)
      ),
    [people]
  )
  return (
    <div className="cv-people">
      <AskToModerate call={call} />
      {sorted.map((p) => (
        <div key={p.id} className={`cv-person${p.speaking ? ' speaking' : ''}`}>
          <Avatar accountId={call.accountId} userId={p.userId} name={p.name} size={32} />
          <span className="cv-person-name">{p.name}</span>
          <span className="cv-person-icons">
            {p.handRaised && (
              <span className="hand" title="Hand raised">
                <Hand size={15} />
              </span>
            )}
            {p.videoOn && (
              <span title="Camera on">
                <Video size={15} />
              </span>
            )}
            {p.muted && (
              <span className="muted" title="Muted">
                <MicOff size={15} />
              </span>
            )}
          </span>
        </div>
      ))}
      <button className="cv-people-add" onClick={() => updateCall((c) => void (c.addPeople = true))}>
        <UserPlus size={16} /> Add people
      </button>
    </div>
  )
}

function Chat({ accountId, token }: { accountId: string; token: string }) {
  const account = useApp((s) => s.accounts[accountId])
  const room = account?.rooms[token]
  const chat = useApp((s) => s.chats[chatKey(accountId, token)]) ?? emptyChat()
  const collapseReplies = usePrefs((s) => s.collapsedThreads)
  const threadsEnabled = hasFeature(account, 'threads')
  const messages = useMemo(() => {
    const opts = { collapseReplies, nativeThreads: threadsEnabled }
    return chat.ids.map((id) => chat.byId[id]).filter((m) => !isCollapsedReply(m, chat.byId, opts))
  }, [chat.ids, chat.byId, collapseReplies, threadsEnabled])
  const pending = useMemo(() => chat.pending.filter((p) => !p.threadId), [chat.pending])

  if (!account || !room) return <div className="empty-state">This conversation isn’t available.</div>
  return (
    <div className="cv-chat">
      {!chat.loaded ? (
        <div className="empty-state">
          <div className="spinner" />
        </div>
      ) : (
        <MessageList
          accountId={accountId}
          token={token}
          messages={messages}
          pending={pending}
          selfId={account.user?.id}
          selfName={account.user?.displayname}
          participantType={room.participantType}
          canEdit={hasFeature(account, 'edit-messages')}
          hasMoreOlder={chat.hasMoreOlder}
          loadingOlder={chat.loadingOlder}
          onLoadOlder={() => void loadOlder(accountId, token)}
        />
      )}
      <Composer
        accountId={accountId}
        token={token}
        placeholder={`Write to ${room.displayName}`}
        disabled={room.readOnly === 1}
      />
    </div>
  )
}
