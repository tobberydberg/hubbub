import { useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import {
  ArrowDownAZ,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarX,
  BellOff,
  Bell,
  BellRing,
  EyeOff,
  ChevronDown,
  Clock,
  Compass,
  ExternalLink,
  FolderPlus,
  Globe,
  Link,
  Lock,
  LogOut,
  Megaphone,
  MessageSquarePlus,
  MessagesSquare,
  MoreVertical,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Settings,
  Star,
  Trash2,
  UserPlus,
  UserX,
  Users,
  Phone,
  CheckCheck,
  MailWarning,
  FolderInput,
  ArrowLeft
} from 'lucide-react'
import { NotificationLevel, RoomType, type Room } from '@shared/talk-types'
import { isDirect, visibleRooms, type SidebarCategory } from '@renderer/lib/categories'
import { formatEventRange, formatEventTime, isMeeting, isOngoing } from '@renderer/lib/events'
import { hasFeature, setApp, useActiveAccount, type AccountState } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import {
  confirmDeleteCategory,
  confirmLeaveRoom,
  copyText,
  markRoomRead,
  markUnread,
  moveRoomToCategory,
  openRoom,
  setCategoryCollapsed,
  setMeeting,
  setImportant,
  setMuted,
  setSensitive,
  showThreadsView,
  sidebarCategories,
  toggleFavorite
} from '@renderer/sync/actions'
import { getSync, roomMentionCount } from '@renderer/sync/engine'
import { useThreads } from '@renderer/sync/threads'
import { useCall } from '@renderer/store/call'
import { CallWidget } from '../calls/CallWidget'
import { Avatar } from '../common/Avatar'
import { isCertificateError } from '../common/Certificate'
import {
  anchorFrom,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTitle,
  useMenuState,
  type Anchor
} from '../common/Menu'
import { isGroupMessage, roomTitle } from '@renderer/lib/rooms'

const isMac = window.hubbub.platform === 'darwin'

export function Sidebar() {
  const account = useActiveAccount()
  // sidebarCategories reads preferences directly; subscribing here re-renders when they change
  const prefs = usePrefs()
  const categories = useMemo(
    () => (account ? sidebarCategories(account) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account, prefs]
  )
  const headerMenu = useMenuState()
  const plusMenu = useMenuState()
  const unreadThreads = useThreads(account).some((t) => t.following && t.unread)

  if (!account)
    return (
      <aside className="sidebar">
        <CallWidget />
      </aside>
    )
  const accountId = account.info.id
  const threads = hasFeature(account, 'threads')

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button
          className="sidebar-header-title"
          onClick={(e) => headerMenu.open(anchorFrom(e.currentTarget), true)}
        >
          <span>{account.info.label}</span>
          <ChevronDown size={16} />
        </button>
        <button
          className="round-btn"
          title="Add channels"
          onClick={(e) => plusMenu.open(anchorFrom(e.currentTarget, 'right'), true)}
        >
          <Plus size={18} />
        </button>
      </div>

      <button className="sidebar-find" onClick={() => setApp({ modal: { type: 'switcher' } })}>
        <Search size={14} />
        Find channel
        <kbd>{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
      </button>

      <ConnectionBanner account={account} />

      <div className="sidebar-scroll">
        {threads && (
          <div
            className={`sidebar-item sidebar-item-static${account.view === 'threads' ? ' active' : ''}${
              unreadThreads ? ' unread' : ''
            }`}
            onClick={() => showThreadsView(accountId)}
          >
            <span className="sidebar-item-icon">
              <MessagesSquare size={18} />
            </span>
            <span className="sidebar-item-name">Threads</span>
          </div>
        )}
        {categories.map((cat) => (
          <Category key={cat.id} account={account} cat={cat} />
        ))}
        {account.roomsLoaded && Object.keys(account.rooms).length === 0 && (
          <div className="sidebar-empty">No conversations yet</div>
        )}
      </div>

      <CallWidget />

      {headerMenu.state && (
        <Menu anchor={headerMenu.state.anchor} onClose={headerMenu.close}>
          <MenuItem
            icon={<Settings size={18} />}
            label="Server settings…"
            onClick={() => {
              headerMenu.close()
              setApp({ modal: { type: 'server-settings', accountId } })
            }}
          />
          <MenuItem
            icon={<ExternalLink size={18} />}
            label="Open Talk in browser"
            onClick={() => {
              headerMenu.close()
              void window.hubbub.app.openExternal(`${account.info.serverUrl}/index.php/apps/spreed/`)
            }}
          />
          <MenuSeparator />
          <MenuItem
            icon={<FolderPlus size={18} />}
            label="Create new category"
            onClick={() => {
              headerMenu.close()
              setApp({ modal: { type: 'category-name', accountId } })
            }}
          />
          <MenuSeparator />
          <MenuItem
            icon={<LogOut size={18} />}
            danger
            label="Sign out of this server"
            onClick={() => {
              headerMenu.close()
              setApp({ modal: { type: 'server-settings', accountId } })
            }}
          />
        </Menu>
      )}

      {plusMenu.state && (
        <Menu anchor={plusMenu.state.anchor} onClose={plusMenu.close}>
          <MenuItem
            icon={<MessageSquarePlus size={18} />}
            label="Create new channel"
            onClick={() => {
              plusMenu.close()
              setApp({ modal: { type: 'new-conversation', kind: 'channel' } })
            }}
          />
          <MenuItem
            icon={<UserPlus size={18} />}
            label="Open a direct message"
            onClick={() => {
              plusMenu.close()
              setApp({ modal: { type: 'new-conversation', kind: 'dm' } })
            }}
          />
          <MenuItem
            icon={<Phone size={18} />}
            label="Start a call"
            onClick={() => {
              plusMenu.close()
              setApp({ modal: { type: 'new-conversation', kind: 'call' } })
            }}
          />
          <MenuItem
            icon={<Compass size={18} />}
            label="Browse channels"
            onClick={() => {
              plusMenu.close()
              setApp({ modal: { type: 'browse' } })
            }}
          />
          <MenuSeparator />
          <MenuItem
            icon={<FolderPlus size={18} />}
            label="Create new category"
            onClick={() => {
              plusMenu.close()
              setApp({ modal: { type: 'category-name', accountId } })
            }}
          />
        </Menu>
      )}
    </aside>
  )
}

function ConnectionBanner({ account }: { account: AccountState }) {
  if (account.status === 'online' || (account.status === 'connecting' && !account.roomsLoaded)) return null
  if (account.status === 'unauthorized') {
    return (
      <div className="sidebar-status">
        Your session for this server has expired or the app password was revoked.{' '}
        <button onClick={() => signInAgain(account)}>Sign in again</button>
      </div>
    )
  }
  if (isCertificateError(account.error)) {
    return (
      <div className="sidebar-status">
        The server’s security certificate isn’t trusted.{' '}
        <button onClick={() => void reviewCertificate(account)}>Review certificate</button>
      </div>
    )
  }
  return (
    <div className="sidebar-status">
      Cannot reach the server. Retrying… {account.error ? `(${account.error})` : ''}
    </div>
  )
}

export function signInAgain(account: AccountState): void {
  setApp({ modal: { type: 'add-server', serverUrl: account.info.serverUrl } })
}

export async function reviewCertificate(account: AccountState): Promise<void> {
  const cert = await window.hubbub.certificates.rejected(account.info.serverUrl)
  if (cert) setApp({ modal: { type: 'certificate', accountId: account.info.id, cert } })
  else void getSync(account.info.id)?.poke()
}

const DRAG_TYPE = 'application/x-hubbub-room'

export const PAST_MEETING_OPTIONS: { days: number | null; label: string }[] = [
  { days: 1, label: 'Until a day after' },
  { days: 3, label: 'Until 3 days after' },
  { days: 7, label: 'Until a week after' },
  { days: null, label: 'Always' }
]

function Category({ account, cat }: { account: AccountState; cat: SidebarCategory }) {
  const accountId = account.info.id
  const [dropTarget, setDropTarget] = useState(false)
  const menu = useMenuState()
  const rooms = visibleRooms(cat, account.view === 'room' ? account.activeToken : null)
  const setSort = usePrefs((s) => s.setSortMode)
  const hidePastDays = usePrefs((s) => s.hidePastMeetingsDays)

  const onDragOver = (e: DragEvent): void => {
    if (cat.kind === 'archived' || !e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    setDropTarget(true)
  }
  const onDrop = (e: DragEvent): void => {
    setDropTarget(false)
    const token = e.dataTransfer.getData(DRAG_TYPE)
    if (!token) return
    const target = cat.kind === 'channels' || cat.kind === 'dms' ? 'none' : cat.id
    void moveRoomToCategory(accountId, token, target)
  }

  return (
    <div
      className={`category${dropTarget ? ' drop-target' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDropTarget(false)}
      onDrop={onDrop}
    >
      <div
        className={`category-header${cat.collapsed ? ' collapsed' : ''}`}
        onClick={() => void setCategoryCollapsed(accountId, cat)}
      >
        <ChevronDown size={14} className="chev" />
        <span className="category-name">{cat.name}</span>
        <span className={`category-actions${menu.state ? ' open' : ''}`}>
          <button
            className="mini-btn"
            title="Category options"
            onClick={(e) => {
              e.stopPropagation()
              menu.open(anchorFrom(e.currentTarget), true)
            }}
          >
            <MoreVertical size={14} />
          </button>
          {cat.kind === 'dms' && (
            <button
              className="mini-btn"
              title="Write a direct message"
              onClick={(e) => {
                e.stopPropagation()
                setApp({ modal: { type: 'new-conversation', kind: 'dm' } })
              }}
            >
              <Plus size={14} />
            </button>
          )}
        </span>
      </div>
      {rooms.map((room) => (
        <RoomItem key={room.token} account={account} room={room} />
      ))}

      {menu.state && (
        <Menu anchor={menu.state.anchor} onClose={menu.close}>
          {cat.kind === 'custom' && (
            <>
              <MenuItem
                icon={<Pencil size={18} />}
                label="Rename category"
                onClick={() => {
                  menu.close()
                  setApp({
                    modal: { type: 'category-name', accountId, categoryId: cat.id, initial: cat.name }
                  })
                }}
              />
              <MenuItem
                icon={<Trash2 size={18} />}
                label="Delete category"
                danger
                onClick={() => {
                  menu.close()
                  confirmDeleteCategory(accountId, cat)
                }}
              />
              <MenuSeparator />
            </>
          )}
          {cat.kind === 'meetings' ? (
            <>
              <MenuTitle>Show past meetings</MenuTitle>
              {PAST_MEETING_OPTIONS.map((o) => (
                <MenuItem
                  key={String(o.days)}
                  icon={<CalendarClock size={18} />}
                  label={o.label}
                  checked={hidePastDays === o.days}
                  onClick={() => {
                    menu.close()
                    usePrefs.getState().set({ hidePastMeetingsDays: o.days })
                  }}
                />
              ))}
            </>
          ) : (
            <>
              <MenuTitle>Sort</MenuTitle>
              <MenuItem
                icon={<ArrowDownAZ size={18} />}
                label="Alphabetically"
                checked={cat.sortMode === 'alpha'}
                onClick={() => {
                  menu.close()
                  setSort(accountId, cat.id, 'alpha')
                }}
              />
              <MenuItem
                icon={<Clock size={18} />}
                label="Recent activity"
                checked={cat.sortMode === 'recent'}
                onClick={() => {
                  menu.close()
                  setSort(accountId, cat.id, 'recent')
                }}
              />
            </>
          )}
          <MenuSeparator />
          <MenuItem
            icon={<FolderPlus size={18} />}
            label="Create new category"
            onClick={() => {
              menu.close()
              setApp({ modal: { type: 'category-name', accountId } })
            }}
          />
        </Menu>
      )}
    </div>
  )
}

export function RoomIcon({ accountId, room, size = 18 }: { accountId: string; room: Room; size?: number }) {
  const overrides = usePrefs((s) => s.meetingOverrides[accountId])
  if (isMeeting(room, overrides)) return <CalendarDays size={size} />
  if (isGroupMessage(room)) return <Users size={size} />
  switch (room.type) {
    case RoomType.OneToOne:
      return (
        <Avatar
          accountId={accountId}
          userId={room.name}
          name={room.displayName}
          size={size + 2}
          status={room.status ?? 'offline'}
        />
      )
    case RoomType.NoteToSelf:
      return <NotebookPen size={size} />
    case RoomType.Public:
      return <Globe size={size} />
    case RoomType.Changelog:
      return <Megaphone size={size} />
    case RoomType.OneToOneFormer:
      return <UserX size={size} />
    default:
      return <Lock size={size} />
  }
}

function RoomItem({ account, room }: { account: AccountState; room: Room }) {
  const accountId = account.info.id
  const active = account.view === 'room' && account.activeToken === room.token
  const mentions = roomMentionCount(room)
  const muted = room.notificationLevel === NotificationLevel.Never
  const unread = room.unreadMessages > 0 && !muted
  const eventLabel = formatEventTime(room)
  const meeting = isMeeting(
    room,
    usePrefs((s) => s.meetingOverrides[accountId])
  )
  const [menu, setMenu] = useState<{ anchor: Anchor; mode: 'main' | 'move' } | null>(null)
  const [dragging, setDragging] = useState(false)
  const inCall = useCall((s) => s.active?.accountId === accountId && s.active.token === room.token)

  const openMenu = (e: MouseEvent, fromButton: boolean): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      anchor: fromButton ? anchorFrom(e.currentTarget) : { x: e.clientX, y: e.clientY },
      mode: 'main'
    })
  }
  const close = (): void => setMenu(null)
  const run = (fn: () => unknown) => (): void => {
    close()
    void fn()
  }

  return (
    <>
      <div
        className={`sidebar-item${active ? ' active' : ''}${unread ? ' unread' : ''}${muted ? ' muted' : ''}${dragging ? ' dragging' : ''}`}
        onClick={() => openRoom(accountId, room.token)}
        onContextMenu={(e) => openMenu(e, false)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, room.token)
          e.dataTransfer.effectAllowed = 'move'
          setDragging(true)
        }}
        onDragEnd={() => setDragging(false)}
        title={[room.displayName, formatEventRange(room)].filter(Boolean).join('\n')}
      >
        <span className="sidebar-item-icon">
          <RoomIcon accountId={accountId} room={room} />
        </span>
        <span className="sidebar-item-name">{roomTitle(room, account.user?.displayname)}</span>
        {eventLabel && (
          <span className={`sidebar-item-meta${isOngoing(room) ? ' now' : ''}`}>{eventLabel}</span>
        )}
        {room.hasCall && (
          <span
            className={`sidebar-call${inCall ? ' joined' : ''}`}
            title={inCall ? 'You are in this call' : 'Call in progress'}
          >
            <Phone size={13} />
          </span>
        )}
        {mentions > 0 && <span className="sidebar-badge">{mentions > 99 ? '99+' : mentions}</span>}
        <button className={`mini-btn item-menu-btn${menu ? ' open' : ''}`} onClick={(e) => openMenu(e, true)}>
          <MoreVertical size={14} />
        </button>
      </div>

      {menu?.mode === 'main' && (
        <Menu anchor={menu.anchor} onClose={close}>
          <MenuItem
            icon={<Star size={18} />}
            label={room.isFavorite ? 'Unfavorite' : 'Favorite'}
            onClick={run(() => toggleFavorite(accountId, room.token))}
          />
          <MenuItem
            icon={muted ? <Bell size={18} /> : <BellOff size={18} />}
            label={muted ? 'Unmute conversation' : 'Mute conversation'}
            onClick={run(() => setMuted(accountId, room.token, !muted))}
          />
          {hasFeature(account, 'important-conversations') && (
            <MenuItem
              icon={<BellRing size={18} />}
              label="Important (notify on Do not disturb)"
              checked={!!room.isImportant}
              onClick={run(() => setImportant(accountId, room.token, !room.isImportant))}
            />
          )}
          {hasFeature(account, 'sensitive-conversations') && (
            <MenuItem
              icon={<EyeOff size={18} />}
              label="Sensitive (hide text in notifications)"
              checked={!!room.isSensitive}
              onClick={run(() => setSensitive(accountId, room.token, !room.isSensitive))}
            />
          )}
          {room.unreadMessages > 0 ? (
            <MenuItem
              icon={<CheckCheck size={18} />}
              label="Mark as read"
              onClick={run(() => markRoomRead(accountId, room.token))}
            />
          ) : (
            hasFeature(account, 'chat-unread') && (
              <MenuItem
                icon={<MailWarning size={18} />}
                label="Mark as unread"
                onClick={run(() => markUnread(accountId, room.token))}
              />
            )
          )}
          <MenuSeparator />
          <MenuItem
            icon={<FolderInput size={18} />}
            label="Move to…"
            onClick={() => setMenu({ anchor: menu.anchor, mode: 'move' })}
          />
          {!isDirect(room) && (
            <MenuItem
              icon={meeting ? <CalendarX size={18} /> : <CalendarPlus size={18} />}
              label={meeting ? 'Not a meeting' : 'Mark as meeting'}
              onClick={run(() => setMeeting(accountId, room.token, !meeting))}
            />
          )}
          {hasFeature(account, 'schedule-meeting') && room.type !== RoomType.NoteToSelf && (
            <MenuItem
              icon={<CalendarClock size={18} />}
              label="Schedule a meeting…"
              onClick={run(() => setApp({ modal: { type: 'meeting', accountId, token: room.token } }))}
            />
          )}
          <MenuItem
            icon={<Link size={18} />}
            label="Copy link"
            onClick={run(() =>
              copyText(`${account.info.serverUrl}/index.php/call/${room.token}`, 'Link copied to clipboard')
            )}
          />
          {room.canLeaveConversation !== false && room.type !== RoomType.NoteToSelf && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<LogOut size={18} />}
                danger
                label={room.type === RoomType.OneToOne ? 'Close conversation' : 'Leave channel'}
                onClick={run(() => confirmLeaveRoom(accountId, room.token))}
              />
            </>
          )}
        </Menu>
      )}
      {menu?.mode === 'move' && (
        <MoveMenu account={account} room={room} anchor={menu.anchor} onClose={close} />
      )}
    </>
  )
}

function MoveMenu({
  account,
  room,
  anchor,
  onClose
}: {
  account: AccountState
  room: Room
  anchor: Anchor
  onClose: () => void
}) {
  const accountId = account.info.id
  const cats = sidebarCategories(account).filter((c) => c.kind === 'custom')
  const current = cats.find((c) => c.rooms.some((r) => r.token === room.token))?.id
  const inMeetings = isMeeting(room, usePrefs.getState().meetingOverrides[accountId])
  const move = (target: string) => (): void => {
    onClose()
    void moveRoomToCategory(accountId, room.token, target)
  }
  return (
    <Menu anchor={anchor} onClose={onClose}>
      <MenuTitle>Move to</MenuTitle>
      <MenuItem
        icon={<Star size={18} />}
        label="Favorites"
        checked={room.isFavorite}
        onClick={move('favorites')}
      />
      {cats.map((c) => (
        <MenuItem
          key={c.id}
          icon={<FolderInput size={18} />}
          label={c.name}
          checked={!room.isFavorite && current === c.id}
          onClick={move(c.id)}
        />
      ))}
      {!isDirect(room) && (
        <MenuItem
          icon={<CalendarDays size={18} />}
          label="Meetings"
          checked={!room.isFavorite && !current && inMeetings}
          onClick={move('meetings')}
        />
      )}
      <MenuItem
        icon={<ArrowLeft size={18} />}
        label={room.type === RoomType.OneToOne ? 'Direct Messages' : 'Channels'}
        checked={!room.isFavorite && !current && !inMeetings}
        onClick={move('none')}
      />
      <MenuSeparator />
      <MenuItem
        icon={<FolderPlus size={18} />}
        label="New category…"
        onClick={() => {
          onClose()
          setApp({ modal: { type: 'category-name', accountId, moveToken: room.token } })
        }}
      />
    </Menu>
  )
}
