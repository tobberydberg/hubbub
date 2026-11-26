import { useEffect, useMemo, useState } from 'react'
import { Check, Download, Globe, Lock, Search, X } from 'lucide-react'
import { RoomType, type Room } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { formatEventTime, isMeeting, sortMeetings } from '@renderer/lib/events'
import { rankPeople, type Person } from '@renderer/lib/people'
import { setApp, useActiveAccount, useApp, type ModalState } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import {
  createCategory,
  createChannel,
  callPeople,
  joinListedRoom,
  openConversationWith,
  openDirectMessage,
  openRoom,
  removeAccount,
  renameCategory,
  selectAccount,
  updateAccountInfo
} from '@renderer/sync/actions'
import { getSync, roomMentionCount } from '@renderer/sync/engine'
import { cachedPeople, loadDirectory, usePeopleSearch } from '@renderer/sync/people'
import { leftVisited, reopenByLink } from '@renderer/sync/visited'
import { Avatar } from '../common/Avatar'
import { Modal } from '../common/Modal'
import { RoomIcon } from '../sidebar/Sidebar'
import { CertificateDetails } from '../common/Certificate'
import { AddServerModal } from './AddServerModal'
import { SettingsModal } from './SettingsModal'
import { fromLocalInput, toLocalInput } from '@renderer/lib/time'
import { MeetingModal } from './MeetingModal'
import { CallSetupModal } from './CallSetupModal'
import { EventDialog } from '../calendar/EventDialog'
import { PollModal } from './PollModal'
import { StatusModal } from './StatusModal'
import { CalendarIoDialog } from '../calendar/CalendarIoDialog'
import { FilesPickerModal } from './FilesPicker'
import { OutOfOfficeModal } from './OutOfOfficeModal'

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
    case 'status':
      return <StatusModal accountId={modal.accountId} />
    case 'calendar-io':
      return <CalendarIoDialog accountId={modal.accountId} mode={modal.mode} />
    case 'out-of-office':
      return <OutOfOfficeModal accountId={modal.accountId} />
    case 'files-picker':
      return <FilesPickerModal accountId={modal.accountId} token={modal.token} threadId={modal.threadId} />
    case 'server-settings':
      return <ServerSettingsModal accountId={modal.accountId} />
    case 'switcher':
      return <ChannelSwitcher />
    case 'new-conversation':
      return modal.kind === 'channel' ? <NewChannelModal /> : <PeopleModal kind={modal.kind} />
    case 'browse':
      return <BrowseChannelsModal />
    case 'category-name':
      return <CategoryNameModal modal={modal} />
    case 'confirm':
      return <ConfirmModal modal={modal} />
    case 'image':
      return <ImageViewer modal={modal} />
    case 'pick-time':
      return <PickTimeModal modal={modal} />
    case 'poll':
      return <PollModal modal={modal} />
    case 'meeting':
      return <MeetingModal modal={modal} />
    case 'call-setup':
      return <CallSetupModal modal={modal} />
    case 'event-edit':
      return <EventDialog modal={modal} />
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
  /** A conversation joined through its link and left: Talk took it off the list, it can be opened again */
  | { kind: 'visited'; accountId: string; label: string; color: string; room: Room }

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
    // Conversations joined through their link that dropped off the list when you left them
    const visited: SwitcherItem[] =
      filter === 'unread'
        ? []
        : order
            .flatMap((id) => {
              const a = accounts[id]
              if (!a) return []
              return leftVisited(id)
                .map((v) => ({ ...v, unreadMessages: 0 }) as unknown as Room)
                .filter((r) => (q ? score(r) >= 0 : filter !== 'meetings' || isMeeting(r)))
                .map((room) => ({
                  kind: 'visited' as const,
                  accountId: id,
                  label: a.info.label,
                  color: a.info.color,
                  room
                }))
            })
            .slice(0, 10)
    return [...rooms, ...visited, ...people]
    // directoryLoaded re-runs the search once the people directory has arrived
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, order, query, activeId, directoryLoaded, filter, meetingOverrides])

  useEffect(() => setIndex(0), [query, filter])

  const choose = (item: SwitcherItem | undefined): void => {
    if (!item) return
    close()
    selectAccount(item.accountId)
    if (item.kind === 'room') openRoom(item.accountId, item.room.token)
    else if (item.kind === 'visited')
      void reopenByLink(item.accountId, item.room.token, item.room.displayName)
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
          if (item.kind === 'visited') {
            return (
              <button
                key={`${item.accountId}/left/${item.room.token}`}
                {...common}
                className={`${common.className} visited`}
              >
                <RoomIcon accountId={item.accountId} room={item.room} />
                <span className="si-name">{item.room.displayName}</span>
                <span className="si-sub">you left · open again</span>
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

/** Pick people: one for a direct message, several for a group message, or anyone to call. */
function PeopleModal({ kind }: { kind: 'dm' | 'call' }) {
  const account = useActiveAccount()
  const accountId = account?.info.id
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<Person[]>([])
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const { people, loading, error } = usePeopleSearch(accountId, query)
  const shown = people.filter((p) => p.id !== account?.user?.id).slice(0, 200)

  useEffect(() => setIndex(0), [query])

  if (!account || !accountId) return null
  const isSelected = (p: Person): boolean => selected.some((s) => s.id === p.id)
  const toggle = (p: Person | undefined): void => {
    if (!p) return
    setSelected((list) =>
      list.some((s) => s.id === p.id) ? list.filter((s) => s.id !== p.id) : [...list, p]
    )
    setQuery('')
  }
  const go = async (list: Person[]): Promise<void> => {
    if (!list.length || busy) return
    setBusy(true)
    try {
      const refs = list.map((p) => ({ id: p.id, name: p.name }))
      if (kind === 'call') await callPeople(accountId, refs)
      else await openConversationWith(accountId, refs)
      close()
    } catch (err) {
      setStartError(errorText(err))
      setBusy(false)
    }
  }

  const action = kind === 'call' ? 'Call' : 'Go'
  return (
    <Modal
      title={kind === 'call' ? 'Start a call' : 'Direct Messages'}
      onClose={close}
      footer={
        <>
          <span className="people-hint">
            {kind === 'call'
              ? 'Calls one person directly, or several people in a group message.'
              : 'Pick one person for a direct message, or several for a group message.'}
          </span>
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!selected.length || busy}
            onClick={() => void go(selected)}
          >
            {action}
          </button>
        </>
      }
    >
      {(startError || error) && <div className="error-box">{startError || error}</div>}
      <div className="people-input">
        {selected.map((p) => (
          <span key={p.id} className="people-chip">
            <Avatar accountId={accountId} userId={p.id} name={p.name} size={20} />
            {p.name}
            <button title={`Remove ${p.name}`} onClick={() => toggle(p)}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          autoFocus
          placeholder={selected.length ? 'Add more people' : 'Search by name, username or e-mail'}
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
              // Enter picks the highlighted person; with nothing typed it goes with the selection
              if (selected.length && !query) void go(selected)
              else if (!selected.length && (e.metaKey || e.ctrlKey))
                void go(shown[index] ? [shown[index]] : [])
              else toggle(shown[index])
            } else if (e.key === 'Backspace' && !query && selected.length) {
              setSelected((list) => list.slice(0, -1))
            }
          }}
        />
      </div>
      <div className="people-count">
        {loading && !people.length
          ? 'Loading people…'
          : `${people.length} ${people.length === 1 ? 'person' : 'people'}${
              people.length > shown.length ? ` · showing the first ${shown.length}, type to narrow down` : ''
            }`}
        {loading && people.length > 0 && <span className="spinner small" />}
      </div>
      <div className="switcher-list people-list">
        {shown.map((u, i) => (
          <button
            key={u.id}
            className={`list-row${i === index ? ' selected' : ''}${isSelected(u) ? ' picked' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onClick={() => toggle(u)}
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
            {isSelected(u) ? (
              <Check size={18} className="lr-check" />
            ) : (
              dmRoomFor(account.rooms, u.id) && <span className="lr-hint">Direct message</span>
            )}
          </button>
        ))}
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

function PickTimeModal({ modal }: { modal: Extract<ModalState, { type: 'pick-time' }> }) {
  const [value, setValue] = useState(toLocalInput(modal.initial))
  const at = fromLocalInput(value)
  const valid = at !== null && at > Date.now() / 1000
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
            className="btn btn-primary"
            disabled={!valid}
            onClick={() => {
              close()
              if (at) modal.onPick(at)
            }}
          >
            {modal.confirmLabel}
          </button>
        </>
      }
    >
      <input
        className="input"
        type="datetime-local"
        value={value}
        min={toLocalInput(Date.now() / 1000)}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      {at !== null && !valid && <p className="help">Pick a time in the future.</p>}
    </Modal>
  )
}

function ConfirmModal({ modal }: { modal: Extract<ModalState, { type: 'confirm' }> }) {
  const cancel = (): void => {
    close()
    modal.onCancel?.()
  }
  return (
    <Modal
      title={modal.title}
      onClose={cancel}
      size="small"
      footer={
        <>
          <button className="btn btn-tertiary" onClick={cancel}>
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
