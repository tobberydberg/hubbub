import { useState, type ReactNode } from 'react'
import {
  AtSign,
  Bell,
  CalendarDays,
  CheckCheck,
  FileText,
  FolderOpen,
  KanbanSquare,
  MessageSquare,
  Settings,
  Share2,
  ShieldAlert,
  X
} from 'lucide-react'
import type { ServerNotification } from '@renderer/api/talk'
import { useActiveAccount } from '@renderer/store/app'
import {
  dismissAllNotifications,
  dismissNotification,
  openNotification,
  runNotificationAction
} from '@renderer/sync/notifications'
import { anchorFrom, Popover, type Anchor } from './common/Menu'

// The bell in the header: everything Nextcloud notifies you about on the server you're looking at,
// newest first, with the notification's own buttons ("Accept", "View message") and dismissing.

const APP_ICONS: Record<string, ReactNode> = {
  spreed: <MessageSquare size={18} />,
  dav: <CalendarDays size={18} />,
  files: <FolderOpen size={18} />,
  files_sharing: <Share2 size={18} />,
  deck: <KanbanSquare size={18} />,
  text: <FileText size={18} />,
  comments: <AtSign size={18} />,
  settings: <Settings size={18} />,
  twofactor_backupcodes: <ShieldAlert size={18} />,
  updatenotification: <ShieldAlert size={18} />
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function ago(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const minutes = Math.round((t - now) / 60_000)
  if (minutes > -1) return 'now'
  if (minutes > -60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours > -24) return relative.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (days > -7) return relative.format(days, 'day')
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function NotificationCenter() {
  const account = useActiveAccount()
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  if (!account) return null
  const list = account.notifications ?? []
  const accountId = account.info.id

  return (
    <>
      <button
        className={`gh-icon-btn notif-bell${anchor ? ' active' : ''}`}
        title={list.length ? `${list.length} notifications` : 'Notifications'}
        // Pressing the bell is outside the panel, which would close it just before the click opens it
        // again: the bell itself opens and closes it
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => setAnchor(anchor ? null : anchorFrom(e.currentTarget, 'right'))}
      >
        <Bell size={18} />
        {list.length > 0 && <span className="notif-count">{list.length > 99 ? '99+' : list.length}</span>}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} className="popover notif-panel">
          <div className="notif-head">
            <h3>Notifications</h3>
            <span className="notif-server">{account.info.label}</span>
            {list.length > 0 && (
              <button
                className="notif-clear"
                title="Dismiss all notifications, here and in Nextcloud"
                onClick={() => void dismissAllNotifications(accountId)}
              >
                <CheckCheck size={15} /> Dismiss all
              </button>
            )}
          </div>
          <div className="notif-list">
            {list.length === 0 ? (
              <div className="notif-empty">
                <Bell size={28} />
                <p>You’re all caught up.</p>
              </div>
            ) : (
              list.map((n) => (
                <NotificationRow
                  key={n.notification_id}
                  accountId={accountId}
                  n={n}
                  onOpen={() => {
                    setAnchor(null)
                    openNotification(accountId, n)
                  }}
                />
              ))
            )}
          </div>
        </Popover>
      )}
    </>
  )
}

function NotificationRow({
  accountId,
  n,
  onOpen
}: {
  accountId: string
  n: ServerNotification
  onOpen: () => void
}) {
  const actions = (n.actions ?? []).slice(0, 3)
  const openable = !!n.link || (n.app === 'dav' && n.object_type === 'calendar_reminder')
  return (
    <div className={`notif-row${openable ? ' openable' : ''}`} onClick={openable ? onOpen : undefined}>
      <span className="notif-icon">{APP_ICONS[n.app] ?? <Bell size={18} />}</span>
      <div className="notif-body">
        <div className="notif-subject">{n.subject}</div>
        {n.message && <div className="notif-message">{n.message}</div>}
        <div className="notif-time">{ago(n.datetime, Date.now())}</div>
        {actions.length > 0 && (
          <div className="notif-actions">
            {actions.map((a) => (
              <button
                key={a.label + a.link}
                className={`ev-btn${a.primary ? '' : ' light'}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void runNotificationAction(accountId, n, a)
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        className="icon-btn small notif-dismiss"
        title="Dismiss"
        onClick={(e) => {
          e.stopPropagation()
          void dismissNotification(accountId, n.notification_id)
        }}
      >
        <X size={15} />
      </button>
    </div>
  )
}
