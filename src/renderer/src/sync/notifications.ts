import { talk, type NotificationAction, type ServerNotification } from '@renderer/api/talk'
import { setApp, showToast, useApp } from '@renderer/store/app'
import { jumpToMessage, openRoom, selectAccount } from './actions'
import { showCalendar } from './calendar'

// The notification center: everything Nextcloud notifies you about (Talk, shares, calendar reminders,
// Deck, …). Dismissing one here dismisses it on the server, so it's gone in the browser and on the
// phone too.

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function remove(accountId: string, ids: number[] | 'all'): void {
  setApp((s) => {
    const a = s.accounts[accountId]
    if (!a?.notifications) return
    a.notifications = ids === 'all' ? [] : a.notifications.filter((n) => !ids.includes(n.notification_id))
  })
}

export async function dismissNotification(accountId: string, id: number): Promise<void> {
  const before = useApp.getState().accounts[accountId]?.notifications
  remove(accountId, [id])
  try {
    await talk(accountId).dismissNotification(id)
  } catch (err) {
    setApp((s) => {
      const a = s.accounts[accountId]
      if (a) a.notifications = before
    })
    showToast(`The notification couldn’t be dismissed: ${errorText(err)}`, 'error')
  }
}

export async function dismissAllNotifications(accountId: string): Promise<void> {
  const before = useApp.getState().accounts[accountId]?.notifications
  remove(accountId, 'all')
  try {
    await talk(accountId).dismissAllNotifications()
  } catch (err) {
    setApp((s) => {
      const a = s.accounts[accountId]
      if (a) a.notifications = before
    })
    showToast(`The notifications couldn’t be dismissed: ${errorText(err)}`, 'error')
  }
}

export async function runNotificationAction(
  accountId: string,
  n: ServerNotification,
  action: NotificationAction
): Promise<void> {
  if (action.type.toUpperCase() === 'WEB') {
    openLink(accountId, action.link)
    return
  }
  const serverUrl = useApp.getState().accounts[accountId]?.info.serverUrl ?? ''
  try {
    await talk(accountId).notificationAction(action, serverUrl)
    // An answered notification goes away on the server
    remove(accountId, [n.notification_id])
  } catch (err) {
    showToast(`“${action.label}” didn’t work: ${errorText(err)}`, 'error')
  }
}

/** Opens what a notification is about: Talk conversations and messages in Hubbub, the rest in the browser */
export function openNotification(accountId: string, n: ServerNotification): void {
  if (n.app === 'dav' && n.object_type === 'calendar_reminder') {
    selectAccount(accountId)
    showCalendar(accountId, true)
    return
  }
  if (n.link) openLink(accountId, n.link)
}

/** A Talk link of this server ({server}/call/{token}#message_{id}) as conversation and message */
export function talkLinkTarget(
  link: string,
  serverUrl: string
): { token: string; messageId?: number } | null {
  let url: URL
  let base: URL
  try {
    url = new URL(link)
    base = new URL(serverUrl.replace(/\/*$/, '/'))
  } catch {
    return null
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null
  const rest = url.pathname.slice(base.pathname.length)
  const token = /^(?:index\.php\/)?call\/([a-z0-9]{4,30})\/?$/i.exec(rest)?.[1]
  if (!token) return null
  const id = /^#message_(\d+)$/.exec(url.hash)?.[1]
  return { token, messageId: id ? Number(id) : undefined }
}

function openLink(accountId: string, link: string): void {
  const a = useApp.getState().accounts[accountId]
  const target = a ? talkLinkTarget(link, a.info.serverUrl) : null
  if (target && a?.rooms[target.token]) {
    selectAccount(accountId)
    if (target.messageId) void jumpToMessage(accountId, target.token, target.messageId)
    else openRoom(accountId, target.token)
    return
  }
  void window.hubbub.app.openExternal(link)
}
