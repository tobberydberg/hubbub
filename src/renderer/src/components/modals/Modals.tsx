import { useEffect, useMemo, useState } from 'react'
import { Download, Globe, Lock, Search, X } from 'lucide-react'
import { RoomType, type Room } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { formatEventTime, isMeeting, sortMeetings } from '@renderer/lib/events'
import { rankPeople, type Person } from '@renderer/lib/people'
import { setApp, useActiveAccount, useApp, type ModalState } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import {
  createCategory,
  createChannel,
  joinListedRoom,
  openDirectMessage,
  openRoom,
  removeAccount,
  renameCategory,
  selectAccount,
  updateAccountInfo
} from '@renderer/sync/actions'
import { getSync, roomMentionCount } from '@renderer/sync/engine'
import { cachedPeople, loadDirectory, usePeopleSearch } from '@renderer/sync/people'
import { Avatar } from '../common/Avatar'
import { Modal } from '../common/Modal'
import { RoomIcon } from '../sidebar/Sidebar'
import { CertificateDetails } from '../common/Certificate'
import { AddServerModal } from './AddServerModal'
import { SettingsModal } from './SettingsModal'

const close = (): void => setApp({ modal: null })

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function ModalHost() {
  const modal = useApp((s) => s.modal)
  if (!modal) return null
  switch (modal.type) {
    case 'add-server':
      return <AddServerModal onClose={close} serverUrl={modal.serverUrl} />
    case 'certificate':
      return <CertificateModal modal={modal} />
    case 'settings':
      return <SettingsModal onClose={close} />
    case 'server-settings':
      return <ServerSettingsModal accountId={modal.accountId} />
    case 'switcher':
      return <ChannelSwitcher />
    case 'new-conversation':
      return modal.kind === 'channel' ? <NewChannelModal /> : <DirectMessageModal />
    case 'browse':
      return <BrowseChannelsModal />
    case 'category-name':
      return <CategoryNameModal modal={modal} />
    case 'confirm':
      return <ConfirmModal modal={modal} />
    case 'image':
      return <ImageViewer modal={modal} />
  }
}

// --- Channel switcher (Ctrl/Cmd+K) ---------------------------------------------

type SwitcherFilter = 'all' | 'unread' | 'meetings'
const FILTERS: { id: SwitcherFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'meetings', label: 'Meetings' }
]

type SwitcherItem =
  | { kind: 'room'; accountId: string; label: string; color: string; room: Room }
  | { kind: 'person'; accountId: string; label: string; color: string; person: Person }

/** The existing one-to-one conversation with a user, if any. */
function dmRoomFor(rooms: Record<string, Room>, userId: string): Room | undefined {
  return Object.values(rooms).find((r) => r.type === RoomType.OneToOne && r.name === userId)
}

function ChannelSwitcher() {
  const accounts = useApp((s) => s.accounts)
  const order = useApp((s) => s.accountOrder)
  const activeId = useApp((s) => s.activeAccountId)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [directoryLoaded, setDirectoryLoaded] = useState(0)
  const [filter, setFilter] = useState<SwitcherFilter>('all')
  const meetingOverrides = usePrefs((s) => s.meetingOverrides)
  const multi = order.length > 1

  useEffect(() => {
    if (activeId)
      void loadDirectory(activeId)
        .then(() => setDirectoryLoaded(Date.now()))
        .catch(() => undefined)
  }, [activeId])

  const items = useMemo((): SwitcherItem[] => {
    const all = order.flatMap((id) => {
      const a = accounts[id]
      return a
        ? Object.values(a.rooms)
            .filter((r) => !r.isArchived)
            .filter((r) =>
              filter === 'meetings'
                ? isMeeting(r, meetingOverrides[id])
                : filter === 'unread'
                  ? r.unreadMessages > 0
                  : true
            )
            .map((room) => ({
              kind: 'room' as const,
              accountId: id,
              label: a.info.label,
              color: a.info.color,
              room
            }))
        : []
    })
    const q = query.trim().toLowerCase()
    if (!q && filter === 'meetings') {
      const sorted = sortMeetings(all.map((i) => i.room))
      return all.sort((x, y) => sorted.indexOf(x.room) - sorted.indexOf(y.room)).slice(0, 100)
    }
    if (!q) {
      return all
        .sort(
          (x, y) =>
            Number(y.room.unreadMessages > 0) - Number(x.room.unreadMessages > 0) ||
            y.room.lastActivity - x.room.lastActivity
        )
        .slice(0, 30)
    }
    const score = (r: Room): number => {
      const n = r.displayName.toLowerCase()
      if (n.startsWith(q)) return 0
      if (n.split(/[\s\-_]+/).some((w) => w.startsWith(q))) return 1
      if (n.includes(q) || r.name.toLowerCase().includes(q)) return 2
      return -1
    }
    const rooms: SwitcherItem[] = all
      .map((i) => ({ i, s: score(i.room) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || b.i.room.lastActivity - a.i.room.lastActivity)
      .slice(0, 50)
      .map((x) => x.i)
    // Like Mattermost, people without a direct message yet can be found here too
    const active = activeId ? accounts[activeId] : undefined
    const people: SwitcherItem[] =
      active && filter === 'all'
        ? rankPeople(cachedPeople(active.info.id), query)
            .filter((p) => !dmRoomFor(active.rooms, p.id))
            .slice(0, 8)
            .map((person) => ({
              kind: 'person' as const,
              accountId: active.info.id,
              label: active.info.label,
              color: active.info.color,
              person
            }))
        : []
    return [...rooms, ...people]
    // directoryLoaded re-runs the search once the people directory has arrived
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, order, query, activeId, directoryLoaded, filter, meetingOverrides])

  useEffect(() => setIndex(0), [query, filter])

  const choose = (item: SwitcherItem | undefined): void => {
    if (!item) return
    close()
    selectAccount(item.accountId)
    if (item.kind === 'room') openRoom(item.accountId, item.room.token)
    else void openDirectMessage(item.accountId, item.person.id)
  }

  return (
    <Modal title="Find Channels" onClose={close}>
      <input
        className="input switcher-input"
        autoFocus
        placeholder={
          multi ? 'Jump to a conversation or person on any server…' : 'Jump to a conversation or person…'
        }
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex((i) => Math.min(i + 1, items.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            choose(items[index])
          } else if (e.key === 'Tab') {
            e.preventDefault()
            const i = FILTERS.findIndex((f) => f.id === filter)
            setFilter(FILTERS[(i + (e.shiftKey ? FILTERS.length - 1 : 1)) % FILTERS.length].id)
          }
        }}
      />
      <div className="switcher-filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="switcher-list">
        {items.map((item, i) => {
          const common = {
            className: `switcher-item${i === index ? ' selected' : ''}`,
            onMouseEnter: () => setIndex(i),
            onClick: () => choose(item),
            ref: (el: HTMLButtonElement | null) => {
              if (i === index) el?.scrollIntoView({ block: 'nearest' })
            }
          }
          const server = multi && (
            <span className="si-server">
              <i style={{ background: item.color }} />
              {item.label}
            </span>
          )
          if (item.kind === 'person') {
            return (
              <button
                key={`${item.accountId}/@${item.person.id}`}
                {...common}
                className={`${common.className} person`}
              >
                <Avatar
                  accountId={item.accountId}
                  userId={item.person.id}
                  name={item.person.name}
                  size={20}
                  status={item.person.status ?? null}
                />
                <span className="si-name">{item.person.name}</span>
                <span className="si-sub">@{item.person.id}</span>
                {server}
              </button>
            )
          }
          const mentions = roomMentionCount(item.room)
          return (
            <button key={`${item.accountId}/${item.room.token}`} {...common}>
              <RoomIcon accountId={item.accountId} room={item.room} />
              <span className={`si-name${item.room.unreadMessages ? ' unread' : ''}`}>
                {item.room.displayName}
              </span>
              {isMeeting(item.room) && <span className="si-when">{formatEventTime(item.room)}</span>}
              {mentions > 0 && (
                <span
                  className="sidebar-badge"
                  style={{ background: 'var(--button-bg)', color: 'var(--button-color)' }}
                >
                  {mentions}
                </span>
              )}
              {server}
            </button>
          )
        })}
        {!items.length && <div className="empty-state">No matching conversations or people</div>}
      </div>
      <div className="switcher-hint">↑↓ to navigate · ↵ to select · tab to filter · esc to dismiss</div>
    </Modal>
  )
}

// --- New channel / direct message / browse -------------------------------------

function NewChannelModal() {
  const account = useActiveAccount()
  const [name, setName] = useState('')
  const [isPublic, setPublic] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!account) return null

  const create = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await createChannel(account.info.id, name, isPublic)
      close()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Create a new channel"
      onClose={close}
      footer={
        <>
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void create()}>
            Create channel
          </button>
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}
      <div className="field">
        <label>Name</label>
        <input
          className="input"
          autoFocus
          value={name}
          maxLength={255}
          placeholder="Enter a name for your new channel"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()}
        />
      </div>
      <div className="radio-row">
        <div className={`radio-card${isPublic ? ' selected' : ''}`} onClick={() => setPublic(true)}>
          <Globe size={20} />
          <div>
            <div className="rc-title">Public channel</div>
            <div className="rc-sub">Anyone can find and join it, including guests with the link</div>
          </div>
        </div>
        <div className={`radio-card${!isPublic ? ' selected' : ''}`} onClick={() => setPublic(false)}>
          <Lock size={20} />
          <div>
            <div className="rc-title">Private channel</div>
            <div className="rc-sub">Only invited members can see and join it</div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function DirectMessageModal() {
  const account = useActiveAccount()
  const accountId = account?.info.id
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [startError, setStartError] = useState<string | null>(null)
  const { people, loading, error } = usePeopleSearch(accountId, query)
  const shown = people.slice(0, 200)

  useEffect(() => setIndex(0), [query])

  if (!account || !accountId) return null
  const start = async (p: Person | undefined): Promise<void> => {
    if (!p) return
    try {
      await openDirectMessage(accountId, p.id)
      close()
    } catch (err) {
      setStartError(errorText(err))
    }
  }

  return (
    <Modal title="Direct Messages" onClose={close}>
      {(startError || error) && <div className="error-box">{startError || error}</div>}
      <input
        className="input"
        autoFocus
        placeholder="Search by name, username or e-mail"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex((i) => Math.min(i + 1, shown.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            void start(shown[index])
          }
        }}
      />
      <div className="people-count">
        {loading && !people.length
          ? 'Loading people…'
          : `${people.length} ${people.length === 1 ? 'person' : 'people'}${
              people.length > shown.length ? ` · showing the first ${shown.length}, type to narrow down` : ''
            }`}
        {loading && people.length > 0 && <span className="spinner small" />}
      </div>
      <div className="switcher-list people-list">
        {shown.map((u, i) => {
          const dm = dmRoomFor(account.rooms, u.id)
          return (
            <button
              key={u.id}
              className={`list-row${i === index ? ' selected' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => void start(u)}
              ref={(el) => {
                if (i === index) el?.scrollIntoView({ block: 'nearest' })
              }}
            >
              <Avatar accountId={accountId} userId={u.id} name={u.name} size={32} status={u.status ?? null} />
              <div className="lr-main">
                <div className="lr-title">{u.name}</div>
                <div className="lr-sub">
                  @{u.id}
                  {u.subline && u.subline !== u.id ? ` · ${u.subline}` : ''}
                </div>
              </div>
              {dm && <span className="lr-hint">Open conversation</span>}
            </button>
          )
        })}
        {!loading && !people.length && <div className="empty-state">No people found</div>}
      </div>
    </Modal>
  )
}

function BrowseChannelsModal() {
  const account = useActiveAccount()
  const [query, setQuery] = useState('')
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const accountId = account?.info.id

  useEffect(() => {
    if (!accountId) return
    const t = setTimeout(() => {
      talk(accountId)
        .listedRooms(query)
        .then(setRooms)
        .catch((e) => setError(errorText(e)))
    }, 200)
    return () => clearTimeout(t)
  }, [query, accountId])

  if (!account || !accountId) return null
  const join = async (token: string): Promise<void> => {
    try {
      await joinListedRoom(accountId, token)
      close()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Modal title="Browse Channels" onClose={close} size="large">
      {error && <div className="error-box">{error}</div>}
      <div style={{ position: 'relative' }}>
        <input
          className="input"
          autoFocus
          placeholder="Search channels"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="switcher-list">
        {rooms === null && (
          <div className="empty-state">
            <div className="spinner" />
          </div>
        )}
        {rooms?.map((r) => (
          <div key={r.token} className="list-row">
            <RoomIcon accountId={accountId} room={r} />
            <div className="lr-main">
              <div className="lr-title">{r.displayName}</div>
              <div className="lr-sub">{r.description || 'No description'}</div>
            </div>
            <button className="btn btn-tertiary small" onClick={() => void join(r.token)}>
              Join
            </button>
          </div>
        ))}
        {rooms?.length === 0 && (
          <div className="empty-state">
            <Search size={32} />
            No open channels to join
          </div>
        )}
      </div>
    </Modal>
  )
}

// --- Small dialogs ----------------------------------------------------------------

function CategoryNameModal({ modal }: { modal: Extract<ModalState, { type: 'category-name' }> }) {
  const [name, setName] = useState(modal.initial ?? '')
  const rename = !!modal.categoryId
  const submit = (): void => {
    if (!name.trim()) return
    close()
    if (rename && modal.categoryId) void renameCategory(modal.accountId, modal.categoryId, name)
    else void createCategory(modal.accountId, name, modal.moveToken)
  }
  return (
    <Modal
      title={rename ? 'Rename Category' : 'Create New Category'}
      onClose={close}
      size="small"
      footer={
        <>
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={submit}>
            {rename ? 'Rename' : 'Create'}
          </button>
        </>
      }
    >
      <input
        className="input"
        autoFocus
        placeholder="Name your category"
        maxLength={64}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
    </Modal>
  )
}

function ConfirmModal({ modal }: { modal: Extract<ModalState, { type: 'confirm' }> }) {
  return (
    <Modal
      title={modal.title}
      onClose={close}
      size="small"
      footer={
        <>
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button
            className={`btn ${modal.danger ? 'btn-danger' : 'btn-primary'}`}
            autoFocus
            onClick={() => {
              close()
              modal.onConfirm()
            }}
          >
            {modal.confirmLabel}
          </button>
        </>
      }
    >
      <p>{modal.body}</p>
    </Modal>
  )
}

const COLORS = [
  '#1c58d9',
  '#3db887',
  '#e07315',
  '#9b4dca',
  '#d24b4e',
  '#0a8a9c',
  '#c43e8a',
  '#6b7b0c',
  '#3f4350'
]

function ServerSettingsModal({ accountId }: { accountId: string }) {
  const account = useApp((s) => s.accounts[accountId])
  const [label, setLabel] = useState(account?.info.label ?? '')
  const [color, setColor] = useState(account?.info.color ?? COLORS[0])
  if (!account) return null

  const save = (): void => {
    void updateAccountInfo(accountId, { label, color })
    close()
  }
  const signOut = (): void =>
    setApp({
      modal: {
        type: 'confirm',
        title: `Sign out of ${account.info.label}?`,
        body: 'Hubbub will remove this server and revoke its app password on the server. You can add it again at any time.',
        confirmLabel: 'Sign out',
        danger: true,
        onConfirm: () => void removeAccount(accountId)
      }
    })

  return (
    <Modal
      title="Server Settings"
      onClose={close}
      size="small"
      footer={
        <>
          <button
            className="btn btn-tertiary left"
            style={{ color: 'var(--error-text-color)' }}
            onClick={signOut}
          >
            Sign out
          </button>
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!label.trim()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label>Server</label>
        <div>{account.info.serverUrl}</div>
        <div className="help">
          Signed in as {account.user?.displayname ?? account.info.displayName} (@{account.info.userId})
          {account.caps?.version ? ` · Talk ${account.caps.version}` : ''}
        </div>
      </div>
      <div className="field">
        <label>Display name</label>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="field">
        <label>Color</label>
        <div className="color-row">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`color-swatch${color === c ? ' selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={c}
            />
          ))}
        </div>
      </div>
    </Modal>
  )
}

function ImageViewer({ modal }: { modal: Extract<ModalState, { type: 'image' }> }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="image-viewer" onClick={close}>
      <header onClick={(e) => e.stopPropagation()}>
        <span className="name">{modal.name}</span>
        {modal.link && (
          <button
            className="icon-btn"
            title="Open in Nextcloud"
            onClick={() => modal.link && void window.hubbub.app.openExternal(modal.link)}
          >
            <Download size={20} />
          </button>
        )}
        <button className="icon-btn" title="Close" onClick={close}>
          <X size={20} />
        </button>
      </header>
      <div className="iv-body">
        <img src={modal.src} alt={modal.name} onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  )
}

function CertificateModal({ modal }: { modal: Extract<ModalState, { type: 'certificate' }> }) {
  const [error, setError] = useState<string | null>(null)
  const trust = async (): Promise<void> => {
    try {
      await window.hubbub.certificates.trust(modal.cert.host, modal.cert.fingerprint)
      close()
      void getSync(modal.accountId)?.poke()
    } catch (err) {
      setError(errorText(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  return (
    <Modal
      title="Untrusted certificate"
      onClose={close}
      footer={
        <>
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={() => void trust()}>
            Trust this certificate
          </button>
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}
      <CertificateDetails cert={modal.cert} />
    </Modal>
  )
}
