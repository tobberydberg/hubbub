import type { AccountInfo } from '@shared/ipc'
import { NotificationLevel, RoomType, type ChatMessage, type Room } from '@shared/talk-types'
import { talk, TalkError, type ServerNotification } from '@renderer/api/talk'
import { detectIncomingCalls } from '@renderer/calls/ringing'
import { toPlainText } from '@renderer/lib/messages'
import { chatKey, setApp, useApp, type AccountState } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import { jumpToMessage, openRoom, selectAccount } from './actions'
import { ChatPoller, loadInitial, loadThread } from './chat'
import { notePresenceInRooms, refreshOwnStatus } from './status'
import { initThreadBaseline, refreshSubscribedThreads } from './threads'
import { formatEventTime } from '@renderer/lib/calendar-time'
import { useCalendar } from '@renderer/store/calendar'
import { openEvent, showCalendar, upcomingEvents } from './calendar'

const ACTIVE_INTERVAL = 10_000
const BACKGROUND_INTERVAL = 30_000
const THREADS_INTERVAL = 60_000
/** Cheap with ETags; a new Talk notification (call, mention) refreshes the conversations at once */
const NOTIFICATIONS_INTERVAL = 4_000

// --- Account sync -------------------------------------------------------------

class AccountSync {
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private threadsRefreshedAt = 0
  private notificationTimer: ReturnType<typeof setTimeout> | null = null
  private notificationsEtag: string | undefined
  /** Highest notification id seen; null until the first check */
  private lastNotificationId: number | null = null

  constructor(readonly accountId: string) {}

  async start(): Promise<void> {
    await this.connect()
    this.schedule()
    this.scheduleNotifications()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.notificationTimer) clearTimeout(this.notificationTimer)
  }

  private scheduleNotifications(): void {
    if (this.stopped) return
    this.notificationTimer = setTimeout(() => void this.checkNotifications(), NOTIFICATIONS_INTERVAL)
  }

  /** Talk's "remind me later" arrives as a Nextcloud notification for a message */
  private showReminder(n: ServerNotification): void {
    const [token, messageId] = n.object_id.split('/')
    const account = useApp.getState().accounts[this.accountId]
    if (!account || !token) return
    const room = account.rooms[token]
    const notification = new Notification(n.subject || 'Reminder', {
      body: room?.isSensitive ? undefined : n.message,
      silent: !usePrefs.getState().notifySound,
      tag: `reminder/${n.notification_id}`
    })
    notification.onclick = () => {
      void window.hubbub.app.focusWindow()
      selectAccount(this.accountId)
      if (messageId) void jumpToMessage(this.accountId, token, Number(messageId))
      else openRoom(this.accountId, token)
    }
  }

  /**
   * Nextcloud's own calendar reminders ("Standup (in 10 minutes)"). The notification doesn't say which
   * event, so it is matched by title among the coming events; clicking opens it in the calendar.
   */
  private showEventReminder(n: ServerNotification): void {
    const title = n.subject.replace(/\s*\([^()]*\)\s*$/, '')
    const event = upcomingEvents(this.accountId).find((e) => e.title === title)
    const calendar = useCalendar
      .getState()
      .accounts[this.accountId]?.calendars?.find((c) => c.href === event?.calendarHref)
    const body = event
      ? [
          formatEventTime(event),
          calendar?.name,
          event.talkToken ? 'Click to open the event and join' : undefined
        ]
          .filter(Boolean)
          .join(' · ')
      : (n.message ?? '').split(/\r?\n/)[0]
    const notification = new Notification(n.subject || 'Reminder', {
      body,
      silent: !usePrefs.getState().notifySound,
      tag: `event-reminder/${n.notification_id}`
    })
    notification.onclick = () => {
      void window.hubbub.app.focusWindow()
      selectAccount(this.accountId)
      showCalendar(this.accountId, true)
      if (event) openEvent(this.accountId, event)
    }
  }

  private async checkNotifications(): Promise<void> {
    try {
      if (useApp.getState().accounts[this.accountId]?.status === 'online') {
        const res = await talk(this.accountId).notifications(this.notificationsEtag)
        if (!res.notModified) {
          this.notificationsEtag = res.etag
          const last = this.lastNotificationId
          const newTalk =
            last === null ? [] : res.list.filter((n) => n.app === 'spreed' && n.notification_id > last)
          const fresh = newTalk.length > 0
          for (const n of newTalk) if (n.object_type === 'reminder') this.showReminder(n)
          if (last !== null) {
            for (const n of res.list)
              if (n.app === 'dav' && n.notification_id > last) this.showEventReminder(n)
          }
          this.lastNotificationId = Math.max(last ?? 0, ...res.list.map((n) => n.notification_id))
          if (fresh) await this.poke()
        }
      }
    } catch (err) {
      // Without the notifications app the regular refresh still runs
      if (err instanceof TalkError && err.status === 404) return
    }
    this.scheduleNotifications()
  }

  /** Refresh now and restart the timer. */
  async poke(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    await this.tick()
  }

  private schedule(): void {
    if (this.stopped) return
    const active = useApp.getState().activeAccountId === this.accountId
    this.timer = setTimeout(() => void this.tick(), active ? ACTIVE_INTERVAL : BACKGROUND_INTERVAL)
  }

  private async tick(): Promise<void> {
    const state = useApp.getState().accounts[this.accountId]
    if (!state) return
    if (state.status !== 'online') await this.connect()
    else await this.refreshRooms()
    const active = useApp.getState().activeAccountId === this.accountId
    if (active && Date.now() - this.threadsRefreshedAt > THREADS_INTERVAL) this.refreshThreads()
    this.schedule()
  }

  private async connect(): Promise<void> {
    const api = talk(this.accountId)
    update(this.accountId, (a) => {
      if (a.status !== 'online') a.status = 'connecting'
    })
    try {
      const [user, caps] = await Promise.all([api.currentUser(), api.capabilities()])
      update(this.accountId, (a) => {
        a.user = user
        a.caps = caps
        a.error = undefined
      })
      // refreshRooms marks the account online, so conversations only open once rooms are known
      await this.refreshRooms()
      initThreadBaseline(this.accountId)
      this.refreshThreads()
      void this.refreshTags()
      void refreshOwnStatus(this.accountId)
    } catch (err) {
      this.failed(err)
    }
  }

  async refreshRooms(): Promise<void> {
    try {
      const rooms = await talk(this.accountId).rooms()
      const prev = useApp.getState().accounts[this.accountId]
      if (!prev) return
      if (prev.roomsLoaded) {
        detectNotifications(prev, rooms)
        detectIncomingCalls(prev, rooms)
      }
      update(this.accountId, (a) => {
        const next: Record<string, Room> = {}
        for (const r of rooms) next[r.token] = r
        a.rooms = next
        a.roomsLoaded = true
        a.status = 'online'
        if (a.activeToken && !next[a.activeToken]) a.activeToken = null
      })
      notePresenceInRooms(this.accountId, rooms)
    } catch (err) {
      this.failed(err)
    }
  }

  private failed(err: unknown): void {
    const unauthorized = err instanceof TalkError && err.status === 401
    const before = useApp.getState().accounts[this.accountId]
    update(this.accountId, (a) => {
      a.status = unauthorized ? 'unauthorized' : 'offline'
      a.error = err instanceof Error ? err.message : String(err)
    })
    // A revoked app password needs the user; tell them once instead of silently retrying
    if (
      unauthorized &&
      before &&
      before.status !== 'unauthorized' &&
      usePrefs.getState().notificationsEnabled
    ) {
      new Notification(`Signed out of ${before.info.label}`, {
        body: 'The app password was revoked or has expired. Open Hubbub to sign in again.',
        silent: !usePrefs.getState().notifySound
      })
    }
  }

  refreshThreads(): void {
    this.threadsRefreshedAt = Date.now()
    void refreshSubscribedThreads(this.accountId)
  }

  async refreshTags(): Promise<void> {
    const a = useApp.getState().accounts[this.accountId]
    if (!a?.caps?.features.includes('conversation-tags')) return
    try {
      const tags = await talk(this.accountId).tags()
      update(this.accountId, (acc) => void (acc.tags = tags))
    } catch {
      // Tags are optional
    }
  }
}

const syncs = new Map<string, AccountSync>()

function update(accountId: string, fn: (a: AccountState) => void): void {
  setApp((s) => {
    const a = s.accounts[accountId]
    if (a) fn(a)
  })
}

export function getSync(accountId: string): AccountSync | undefined {
  return syncs.get(accountId)
}

export function addAccountState(info: AccountInfo): void {
  setApp((s) => {
    s.accounts[info.id] = {
      info,
      status: 'connecting',
      rooms: {},
      roomsLoaded: false,
      tags: [],
      activeToken: usePrefs.getState().lastRooms[info.id] ?? null,
      view: 'room'
    }
    if (!s.accountOrder.includes(info.id)) s.accountOrder.push(info.id)
  })
  const sync = new AccountSync(info.id)
  syncs.set(info.id, sync)
  void sync.start()
}

export function removeAccountState(accountId: string): void {
  syncs.get(accountId)?.stop()
  syncs.delete(accountId)
  stopPollers()
  setApp((s) => {
    delete s.accounts[accountId]
    s.accountOrder = s.accountOrder.filter((id) => id !== accountId)
    for (const key of Object.keys(s.chats)) if (key.startsWith(`${accountId}/`)) delete s.chats[key]
    if (s.activeAccountId === accountId) s.activeAccountId = s.accountOrder[0] ?? null
    if (s.rhs?.accountId === accountId) s.rhs = null
  })
  ensureActivePolling()
}

export async function bootstrap(): Promise<void> {
  const accounts = await window.hubbub.accounts.list()
  for (const info of accounts) addAccountState(info)
  const last = usePrefs.getState().lastAccountId
  setApp({
    activeAccountId: accounts.find((a) => a.id === last)?.id ?? accounts[0]?.id ?? null,
    initialized: true
  })

  window.addEventListener('focus', () => {
    const id = useApp.getState().activeAccountId
    if (id) void syncs.get(id)?.poke()
    scheduleMarkRead()
  })
  document.addEventListener('visibilitychange', scheduleMarkRead)
  window.hubbub.updates.onStatus((st) => setApp({ update: st }))

  startBadgeUpdates()
  startPollingWatcher()
}

/** Re-evaluates which conversation to poll whenever navigation or connectivity changes. */
function startPollingWatcher(): void {
  let last = ''
  const check = (): void => {
    const s = useApp.getState()
    const a = s.activeAccountId ? s.accounts[s.activeAccountId] : undefined
    const rhs = s.rhs?.type === 'thread' ? `${s.rhs.token}#${s.rhs.rootId}` : ''
    const sig = `${s.activeAccountId}|${a?.activeToken}|${a?.view}|${a?.status}|${rhs}`
    if (sig !== last) {
      last = sig
      ensureActivePolling()
    }
  }
  useApp.subscribe(check)
  check()
}

// --- Active conversation polling ----------------------------------------------

let roomPoller: ChatPoller | null = null
let threadPoller: ChatPoller | null = null
/** Key of the conversation/thread being polled (or loading); null when idle */
let roomKey: string | null = null
let threadKey: string | null = null

function stopPollers(): void {
  roomPoller?.stop()
  threadPoller?.stop()
  roomPoller = threadPoller = null
  roomKey = threadKey = null
}

/** Makes sure exactly the visible conversation (and open thread) are being polled. */
export function ensureActivePolling(): void {
  const s = useApp.getState()
  const account = s.activeAccountId ? s.accounts[s.activeAccountId] : undefined
  if (!account || account.status !== 'online') {
    stopPollers()
    return
  }
  const accountId = account.info.id
  const token = account.view === 'room' ? account.activeToken : null

  const key = token ? chatKey(accountId, token) : null
  if (roomKey !== key) {
    if (keepUnread !== key) keepUnread = null
    roomPoller?.stop()
    roomPoller = null
    roomKey = key
    if (token && key) {
      const begin = (): void => {
        if (roomKey !== key) return // switched away while history was loading
        roomPoller = new ChatPoller(accountId, token, undefined, () => scheduleMarkRead()).start()
        scheduleMarkRead()
      }
      if (!s.chats[key]?.loaded) void loadInitial(accountId, token).then(begin)
      else begin()
    }
  }

  // The thread panel needs its own poller: native threads poll just the thread, and reply chains
  // opened from the Threads view poll their conversation when it is not the one already polled.
  const rhs = s.rhs?.type === 'thread' && s.rhs.accountId === accountId ? s.rhs : null
  let wantThread: string | null = null
  let native = false
  if (rhs) {
    const root = s.chats[chatKey(accountId, rhs.token)]?.byId[rhs.rootId]
    native = !!account.caps?.features.includes('threads') && (!root || !!root.isThread)
    if (native) wantThread = `${accountId}/${rhs.token}#${rhs.rootId}`
    else if (rhs.token !== token) wantThread = chatKey(accountId, rhs.token)
  }
  if (threadKey !== wantThread) {
    threadPoller?.stop()
    threadPoller = null
    threadKey = wantThread
    if (wantThread && rhs) {
      const want = wantThread
      const { token: tToken, rootId } = rhs
      const loaded = native
        ? loadThread(accountId, tToken, rootId)
        : s.chats[chatKey(accountId, tToken)]?.loaded
          ? Promise.resolve()
          : loadInitial(accountId, tToken)
      void loaded.then(() => {
        if (threadKey !== want) return
        threadPoller = new ChatPoller(accountId, tToken, native ? rootId : undefined, () => undefined).start()
      })
    }
  }
}

// --- Read markers -------------------------------------------------------------

let markReadTimer: ReturnType<typeof setTimeout> | null = null

/**
 * The open conversation the user just marked as unread. Like in Mattermost, it stays unread until the
 * user leaves it or sends a message, instead of being marked read again straight away.
 */
let keepUnread: string | null = null

export function keepUnreadWhileOpen(key: string | null): void {
  keepUnread = key
}

export function scheduleMarkRead(): void {
  if (markReadTimer) clearTimeout(markReadTimer)
  markReadTimer = setTimeout(markActiveRead, 400)
}

function markActiveRead(): void {
  if (!document.hasFocus() || document.visibilityState !== 'visible') return
  const s = useApp.getState()
  const account = s.activeAccountId ? s.accounts[s.activeAccountId] : undefined
  const token = account?.view === 'room' ? account.activeToken : null
  if (!account || !token) return
  const room = account.rooms[token]
  const chat = s.chats[chatKey(account.info.id, token)]
  if (!room || !chat?.loaded || keepUnread === chatKey(account.info.id, token)) return
  const newest = Math.max(chat.newestId, 0)
  if (newest <= room.lastReadMessage && room.unreadMessages === 0) return
  update(account.info.id, (a) => {
    const r = a.rooms[token]
    if (!r) return
    r.unreadMessages = 0
    r.unreadMention = false
    r.unreadMentionDirect = false
    r.lastReadMessage = Math.max(r.lastReadMessage, newest)
  })
  if (newest > 0)
    void talk(account.info.id)
      .markRead(token, newest)
      .catch(() => undefined)
}

// --- Notifications & badge ----------------------------------------------------

function shouldNotify(room: Room, account: AccountState): boolean {
  if (room.muteUntil && room.muteUntil * 1000 > Date.now()) return false
  // Do not disturb silences everything but important conversations, as on the user's other devices
  if (account.userStatus === 'dnd' && !room.isImportant) return false
  const level = room.notificationLevel
  if (level === NotificationLevel.Never) return false
  if (level === NotificationLevel.Always) return true
  if (level === NotificationLevel.Mention) return room.unreadMention
  // Default: always for one-to-one, mentions otherwise
  return room.type === RoomType.OneToOne || room.type === RoomType.NoteToSelf ? true : room.unreadMention
}

function detectNotifications(prev: AccountState, rooms: Room[]): void {
  const prefs = usePrefs.getState()
  if (!prefs.notificationsEnabled) return
  const s = useApp.getState()
  for (const room of rooms) {
    const before = prev.rooms[room.token]
    const last = Array.isArray(room.lastMessage) ? undefined : room.lastMessage
    if (!last || last.systemMessage) continue
    const beforeLast = before && !Array.isArray(before.lastMessage) ? before.lastMessage : undefined
    if (beforeLast && last.id <= beforeLast.id) continue
    if (last.actorId === prev.user?.id && last.actorType === 'users') continue
    if (room.unreadMessages === 0) continue
    const viewing =
      document.hasFocus() &&
      s.activeAccountId === prev.info.id &&
      prev.activeToken === room.token &&
      prev.view === 'room'
    if (viewing || !shouldNotify(room, prev)) continue
    showNotification(prev.info, room, last)
  }
}

function showNotification(account: AccountInfo, room: Room, msg: ChatMessage): void {
  const multi = useApp.getState().accountOrder.length > 1
  const isDirect = room.type === RoomType.OneToOne
  const title = multi ? `${room.displayName} · ${account.label}` : room.displayName
  // Sensitive conversations show that there is a message, not what it says
  const text = room.isSensitive ? 'New message' : toPlainText(msg) || 'Sent an attachment'
  const body = isDirect ? text : `${msg.actorDisplayName || 'Someone'}: ${text}`
  const n = new Notification(title, {
    body: body.length > 200 ? `${body.slice(0, 197)}…` : body,
    silent: !usePrefs.getState().notifySound,
    tag: `${account.id}/${room.token}`
  })
  n.onclick = () => {
    void window.hubbub.app.focusWindow()
    selectAccount(account.id)
    openRoom(account.id, room.token)
  }
}

export function roomMentionCount(room: Room): number {
  if (room.isArchived) return 0
  if (room.notificationLevel === NotificationLevel.Never) return 0
  if (room.type === RoomType.OneToOne) return room.unreadMessages
  return room.unreadMention ? Math.max(1, room.unreadMessages) : 0
}

export function accountTotals(a: AccountState): { mentions: number; unread: boolean } {
  let mentions = 0
  let unread = false
  for (const r of Object.values(a.rooms)) {
    mentions += roomMentionCount(r)
    if (r.unreadMessages > 0 && r.notificationLevel !== NotificationLevel.Never && !r.isArchived)
      unread = true
  }
  return { mentions, unread }
}

function startBadgeUpdates(): void {
  let last = ''
  useApp.subscribe((s) => {
    let mentions = 0
    let unread = false
    for (const a of Object.values(s.accounts)) {
      const t = accountTotals(a)
      mentions += t.mentions
      unread ||= t.unread
    }
    const sig = `${mentions}:${unread}`
    if (sig !== last) {
      last = sig
      void window.hubbub.app.setBadge(mentions, unread)
    }
  })
}
