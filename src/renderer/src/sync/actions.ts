import type { AccountInfo } from '@shared/ipc'
import { RoomType, type ChatMessage, type Room } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { buildCategories, isDirect, visibleRooms, type SidebarCategory } from '@renderer/lib/categories'
import { isMeeting } from '@renderer/lib/events'
import { newReferenceId, reactions, rootOf } from '@renderer/lib/messages'
import {
  chatKey,
  emptyChat,
  hasFeature,
  setApp,
  showToast,
  useApp,
  type AccountState
} from '@renderer/store/app'
import { updateCall } from '@renderer/store/call'
import { requestCall, startCall, type CallHandover } from '@renderer/calls/call'
import { GROUP_MESSAGE, groupMessageName, isGroupMessage } from '@renderer/lib/rooms'
import { usePrefs, type LocalCategory } from '@renderer/store/prefs'
import { applyMessages } from './chat'
import { addAccountState, getSync, keepUnreadWhileOpen, removeAccountState, scheduleMarkRead } from './engine'
import { followAfterReply } from './threads'

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function account(accountId: string): AccountState | undefined {
  return useApp.getState().accounts[accountId]
}

// --- Navigation ---------------------------------------------------------------

export function selectAccount(accountId: string): void {
  if (!account(accountId)) return
  setApp((s) => {
    s.activeAccountId = accountId
    if (s.rhs && s.rhs.accountId !== accountId) s.rhs = null
  })
  usePrefs.getState().set({ lastAccountId: accountId })
  void getSync(accountId)?.poke()
}

export function openRoom(accountId: string, token: string): void {
  updateCall((c) => void (c.expanded = false))
  setApp((s) => {
    const a = s.accounts[accountId]
    if (!a) return
    s.activeAccountId = accountId
    a.activeToken = token
    a.view = 'room'
    if (s.rhs && (s.rhs.accountId !== accountId || ('token' in s.rhs && s.rhs.token !== token))) {
      if (s.rhs.type !== 'search') s.rhs = null
    }
    // Recompute the "New Messages" line each time the room is opened
    const chat = s.chats[chatKey(accountId, token)]
    const room = a.rooms[token]
    if (chat && room) chat.unreadFromId = room.unreadMessages > 0 ? room.lastReadMessage : null
  })
  const prefs = usePrefs.getState()
  prefs.set({ lastAccountId: accountId, lastRooms: { ...prefs.lastRooms, [accountId]: token } })
  scheduleMarkRead()
}

export function showThreadsView(accountId: string): void {
  updateCall((c) => void (c.expanded = false))
  setApp((s) => {
    const a = s.accounts[accountId]
    if (a) a.view = 'threads'
  })
}

/** Your day at a glance for this server */
export function showTodayView(accountId: string): void {
  updateCall((c) => void (c.expanded = false))
  setApp((s) => {
    const a = s.accounts[accountId]
    if (a) a.view = 'today'
  })
}

export function openThread(accountId: string, token: string, rootId: number): void {
  setApp({ rhs: { type: 'thread', accountId, token, rootId } })
}

export function closeRhs(): void {
  setApp({ rhs: null })
}

export function sidebarCategories(a: AccountState): SidebarCategory[] {
  const prefs = usePrefs.getState()
  return buildCategories({
    rooms: Object.values(a.rooms),
    tags: a.tags,
    useServerTags: !!a.caps?.features.includes('conversation-tags'),
    localCategories: prefs.localCategories[a.info.id] ?? [],
    collapsed: prefs.collapsed[a.info.id] ?? {},
    sortModes: prefs.sortMode[a.info.id] ?? {},
    showArchived: prefs.showArchived,
    hideMeetingsBefore:
      prefs.hidePastMeetingsDays === null ? null : Date.now() / 1000 - prefs.hidePastMeetingsDays * 86_400,
    activeToken: a.activeToken,
    meetingOverrides: prefs.meetingOverrides[a.info.id]
  })
}

/** Alt+Up/Down channel navigation in sidebar order. */
export function navigateRooms(direction: 'prev' | 'next', unreadOnly: boolean): void {
  const s = useApp.getState()
  const a = s.activeAccountId ? s.accounts[s.activeAccountId] : undefined
  if (!a) return
  const list = sidebarCategories(a).flatMap((c) => visibleRooms(c, a.activeToken))
  if (!list.length) return
  const idx = list.findIndex((r) => r.token === a.activeToken)
  const step = direction === 'next' ? 1 : -1
  for (let i = 1; i <= list.length; i++) {
    const candidate = list[(idx + step * i + list.length * 2) % list.length]
    if (!unreadOnly || candidate.unreadMessages > 0) {
      openRoom(a.info.id, candidate.token)
      return
    }
  }
}

// --- Accounts -------------------------------------------------------------------

export function accountAdded(info: AccountInfo): void {
  if (account(info.id)) {
    // Re-login of an existing account: reconnect
    setApp((s) => {
      s.accounts[info.id].info = info
    })
    void getSync(info.id)?.poke()
  } else {
    addAccountState(info)
  }
  selectAccount(info.id)
}

export async function removeAccount(accountId: string): Promise<void> {
  removeAccountState(accountId)
  await window.hubbub.accounts.remove(accountId)
  const prefs = usePrefs.getState()
  const { [accountId]: _a, ...lastRooms } = prefs.lastRooms
  const { [accountId]: _b, ...localCategories } = prefs.localCategories
  prefs.set({ lastRooms, localCategories })
}

export async function updateAccountInfo(
  accountId: string,
  patch: { label?: string; color?: string }
): Promise<void> {
  const list = await window.hubbub.accounts.update(accountId, patch)
  setApp((s) => {
    for (const info of list) if (s.accounts[info.id]) s.accounts[info.id].info = info
  })
}

export async function reorderAccounts(ids: string[]): Promise<void> {
  setApp({ accountOrder: ids })
  await window.hubbub.accounts.reorder(ids)
}

export async function setUserStatus(accountId: string, status: string): Promise<void> {
  try {
    const st = await talk(accountId).setUserStatus(status)
    setApp((s) => {
      const a = s.accounts[accountId]
      if (!a) return
      a.userStatus = st.status
      if (a.ownStatus) a.ownStatus = { ...a.ownStatus, ...st }
    })
  } catch (err) {
    showToast(`Could not set status: ${errorText(err)}`, 'error')
  }
}

// --- Messages -------------------------------------------------------------------

export interface SendExtras {
  replyTo?: number
  threadId?: number
  threadTitle?: string
}

export async function sendMessage(
  accountId: string,
  token: string,
  text: string,
  extras: SendExtras = {}
): Promise<void> {
  const message = text.trim()
  if (!message) return
  const key = chatKey(accountId, token)
  const referenceId = newReferenceId()
  setApp((s) => {
    const chat = (s.chats[key] ??= emptyChat())
    chat.pending.push({
      referenceId,
      message,
      timestamp: Math.floor(Date.now() / 1000),
      threadId: extras.threadId,
      replyTo: extras.replyTo
    })
  })
  try {
    const sent = await talk(accountId).send(token, {
      message,
      referenceId,
      replyTo: extras.replyTo || undefined,
      threadId: extras.replyTo ? undefined : extras.threadId || undefined,
      threadTitle: extras.threadTitle || undefined
    })
    if (sent) applyMessages(key, [sent])
    setApp((s) => {
      const chat = s.chats[key]
      chat.pending = chat.pending.filter((p) => p.referenceId !== referenceId)
    })
    keepUnreadWhileOpen(null)
    scheduleMarkRead()
    const target = extras.replyTo || extras.threadId
    if (target) {
      const chat = useApp.getState().chats[key]
      const m = chat?.byId[target]
      followAfterReply(accountId, token, m ? rootOf(m, chat.byId) : target)
    }
  } catch (err) {
    setApp((s) => {
      const p = s.chats[key].pending.find((x) => x.referenceId === referenceId)
      if (p) p.error = errorText(err)
    })
  }
}

export function discardPending(accountId: string, token: string, referenceId: string): void {
  setApp((s) => {
    const chat = s.chats[chatKey(accountId, token)]
    if (chat) chat.pending = chat.pending.filter((p) => p.referenceId !== referenceId)
  })
}

export async function retryPending(accountId: string, token: string, referenceId: string): Promise<void> {
  const p = useApp
    .getState()
    .chats[chatKey(accountId, token)]?.pending.find((x) => x.referenceId === referenceId)
  if (!p) return
  discardPending(accountId, token, referenceId)
  await sendMessage(accountId, token, p.message, { replyTo: p.replyTo, threadId: p.threadId })
}

export async function editMessage(
  accountId: string,
  token: string,
  id: number,
  text: string
): Promise<boolean> {
  try {
    const res = await talk(accountId).edit(token, id, text.trim())
    if (res) applyMessages(chatKey(accountId, token), [res])
    return true
  } catch (err) {
    showToast(`Could not edit message: ${errorText(err)}`, 'error')
    return false
  }
}

export function confirmDeleteMessage(accountId: string, token: string, msg: ChatMessage): void {
  setApp({
    modal: {
      type: 'confirm',
      title: 'Delete Message',
      body: 'Are you sure you want to delete this message? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          const res = await talk(accountId).deleteMessage(token, msg.id)
          if (res) applyMessages(chatKey(accountId, token), [res])
        } catch (err) {
          showToast(`Could not delete message: ${errorText(err)}`, 'error')
        }
      }
    }
  })
}

export async function toggleReaction(
  accountId: string,
  token: string,
  msg: ChatMessage,
  emoji: string
): Promise<void> {
  const key = chatKey(accountId, token)
  const has = msg.reactionsSelf?.includes(emoji)
  // Optimistic update
  setApp((s) => {
    const m = s.chats[key]?.byId[msg.id]
    if (!m) return
    const r = { ...reactions(m) }
    r[emoji] = (r[emoji] ?? 0) + (has ? -1 : 1)
    if (r[emoji] <= 0) delete r[emoji]
    m.reactions = r
    m.reactionsSelf = has
      ? (m.reactionsSelf ?? []).filter((e) => e !== emoji)
      : [...(m.reactionsSelf ?? []), emoji]
  })
  if (!has) usePrefs.getState().rememberEmoji(emoji)
  try {
    if (has) await talk(accountId).unreact(token, msg.id, emoji)
    else await talk(accountId).react(token, msg.id, emoji)
  } catch (err) {
    showToast(`Could not update reaction: ${errorText(err)}`, 'error')
  }
}

export function messageLink(accountId: string, token: string, id: number): string {
  const a = account(accountId)
  return `${a?.info.serverUrl ?? ''}/index.php/call/${token}#message_${id}`
}

export async function uploadFiles(
  accountId: string,
  token: string,
  files: File[],
  opts: { caption?: string; threadId?: number } = {}
): Promise<void> {
  const a = account(accountId)
  if (!a?.caps) return
  const api = talk(accountId)
  const useAttachmentApi = !!a.caps.config.attachments?.['conversation-subfolders']
  const baseFolder = (a.caps.config.attachments?.folder || '/Talk').replace(/\/+$/, '')

  for (const [i, file] of files.entries()) {
    const caption = i === files.length - 1 ? opts.caption : undefined
    const meta: Record<string, unknown> = {}
    if (caption) meta.caption = caption
    if (opts.threadId) meta.threadId = opts.threadId
    const referenceId = newReferenceId()
    showToast(`Uploading ${file.name}…`)
    try {
      const data = await file.arrayBuffer()
      if (useAttachmentApi) {
        const { folder } = await api.attachmentFolder(token, [file.name])
        const draftName = `${crypto.randomUUID()}-${file.name}`
        const path = `${folder.replace(/\/+$/, '')}/${draftName}`
        const up = await window.hubbub.upload({ accountId, remotePath: path, data, contentType: file.type })
        if (!up.ok) throw new Error(up.error)
        await api.postAttachment(token, path, file.name, referenceId, meta)
      } else {
        const path = `${baseFolder}/${file.name}`
        const up = await window.hubbub.upload({ accountId, remotePath: path, data, contentType: file.type })
        if (!up.ok) throw new Error(up.error)
        await api.shareFile(token, up.path, referenceId, meta)
      }
      showToast(`Uploaded ${file.name}`)
    } catch (err) {
      showToast(`Upload of ${file.name} failed: ${errorText(err)}`, 'error')
    }
  }
}

// --- Conversations --------------------------------------------------------------

function patchRoom(accountId: string, token: string, fn: (r: Room) => void): void {
  setApp((s) => {
    const r = s.accounts[accountId]?.rooms[token]
    if (r) fn(r)
  })
}

export async function toggleFavorite(accountId: string, token: string): Promise<void> {
  const room = account(accountId)?.rooms[token]
  if (!room) return
  const next = !room.isFavorite
  patchRoom(accountId, token, (r) => void (r.isFavorite = next))
  try {
    await talk(accountId).setFavorite(token, next)
  } catch (err) {
    patchRoom(accountId, token, (r) => void (r.isFavorite = !next))
    showToast(`Could not update favorite: ${errorText(err)}`, 'error')
  }
}

export async function setMuted(accountId: string, token: string, muted: boolean): Promise<void> {
  const level = muted ? 3 : 0
  patchRoom(accountId, token, (r) => void (r.notificationLevel = level))
  try {
    await talk(accountId).setNotificationLevel(token, level)
  } catch (err) {
    showToast(`Could not change notifications: ${errorText(err)}`, 'error')
  }
  void getSync(accountId)?.refreshRooms()
}

/** Important conversations still notify while on Do not disturb */
export async function setImportant(accountId: string, token: string, on: boolean): Promise<void> {
  patchRoom(accountId, token, (r) => void (r.isImportant = on))
  try {
    await talk(accountId).setImportant(token, on)
    showToast(on ? 'Important: notifies you even on Do not disturb' : 'No longer important')
  } catch (err) {
    showToast(`Could not change this: ${errorText(err)}`, 'error')
  }
  void getSync(accountId)?.refreshRooms()
}

/** Sensitive conversations leave the message text out of notifications */
export async function setSensitive(accountId: string, token: string, on: boolean): Promise<void> {
  patchRoom(accountId, token, (r) => void (r.isSensitive = on))
  try {
    await talk(accountId).setSensitive(token, on)
    showToast(on ? 'Sensitive: notifications won’t show message text' : 'No longer sensitive')
  } catch (err) {
    showToast(`Could not change this: ${errorText(err)}`, 'error')
  }
  void getSync(accountId)?.refreshRooms()
}

/** Marks the newest message as unread (Talk picks the message before it as the read marker). */
export async function markUnread(accountId: string, token: string): Promise<void> {
  try {
    applyReadMarker(accountId, token, await talk(accountId).markUnread(token))
  } catch (err) {
    showToast(`Could not mark as unread: ${errorText(err)}`, 'error')
  }
}

/** Mattermost's "Mark as Unread" on a post: everything from this message on becomes unread. */
export async function markUnreadFrom(accountId: string, token: string, msg: ChatMessage): Promise<void> {
  const chat = useApp.getState().chats[chatKey(accountId, token)]
  const before = chat?.ids.filter((id) => id < msg.id).at(-1)
  try {
    applyReadMarker(accountId, token, await talk(accountId).markRead(token, before ?? msg.id - 1))
  } catch (err) {
    showToast(`Could not mark as unread: ${errorText(err)}`, 'error')
  }
}

function applyReadMarker(accountId: string, token: string, room: Room | []): void {
  const s = useApp.getState()
  const a = s.accounts[accountId]
  const key = chatKey(accountId, token)
  if (s.activeAccountId === accountId && a?.view === 'room' && a.activeToken === token)
    keepUnreadWhileOpen(key)
  if (Array.isArray(room) || !room?.token) {
    // Older servers answer without the conversation
    void getSync(accountId)?.refreshRooms()
    return
  }
  setApp((st) => {
    const acc = st.accounts[accountId]
    if (acc?.rooms[token]) acc.rooms[token] = room
    const chat = st.chats[key]
    // Show the "New Messages" line where the conversation now becomes unread
    if (chat) chat.unreadFromId = room.unreadMessages > 0 ? room.lastReadMessage : null
  })
}

export async function markRoomRead(accountId: string, token: string): Promise<void> {
  const room = account(accountId)?.rooms[token]
  const last = room && !Array.isArray(room.lastMessage) ? room.lastMessage?.id : undefined
  if (!last) return
  patchRoom(accountId, token, (r) => {
    r.unreadMessages = 0
    r.unreadMention = false
  })
  await talk(accountId)
    .markRead(token, last)
    .catch(() => undefined)
}

export function confirmLeaveRoom(accountId: string, token: string): void {
  const room = account(accountId)?.rooms[token]
  if (!room) return
  setApp({
    modal: {
      type: 'confirm',
      title: `Leave ${room.displayName}`,
      body:
        room.type === RoomType.OneToOne
          ? 'The conversation will be removed from your list.'
          : 'You will need to be added again to rejoin a private channel.',
      confirmLabel: 'Leave',
      danger: true,
      onConfirm: async () => {
        try {
          await talk(accountId).leave(token)
          setApp((s) => {
            const a = s.accounts[accountId]
            if (!a) return
            delete a.rooms[token]
            if (a.activeToken === token) a.activeToken = null
          })
        } catch (err) {
          showToast(`Could not leave: ${errorText(err)}`, 'error')
        }
      }
    }
  })
}

async function openCreated(accountId: string, room: Room): Promise<void> {
  setApp((s) => {
    const a = s.accounts[accountId]
    if (a) a.rooms[room.token] = room
  })
  openRoom(accountId, room.token)
  void getSync(accountId)?.refreshRooms()
}

export async function createChannel(accountId: string, name: string, isPublic: boolean): Promise<void> {
  const room = await talk(accountId).createRoom({
    roomType: isPublic ? RoomType.Public : RoomType.Group,
    roomName: name.trim()
  })
  await openCreated(accountId, room)
}

export async function openDirectMessage(accountId: string, userId: string): Promise<string> {
  const room = await directMessageRoom(accountId, userId)
  await openCreated(accountId, room)
  return room.token
}

/** The one-to-one conversation with a user, created when there is none yet. */
async function directMessageRoom(accountId: string, userId: string): Promise<Room> {
  const existing = Object.values(account(accountId)?.rooms ?? {}).find(
    (r) => r.type === RoomType.OneToOne && r.name === userId
  )
  return (
    existing ?? talk(accountId).createRoom({ roomType: RoomType.OneToOne, invite: userId, source: 'users' })
  )
}

export interface PersonRef {
  id: string
  name: string
}

/**
 * Opens the conversation with exactly these people: the one-to-one for one person, otherwise a group
 * message. An existing group message with the same people is reused. Returns its token.
 */
export async function openConversationWith(accountId: string, people: PersonRef[]): Promise<string> {
  if (people.length === 1) return openDirectMessage(accountId, people[0].id)
  const a = account(accountId)
  const self = a?.user
  if (!a || !self) throw new Error('Not connected')
  const api = talk(accountId)
  const wanted = new Set(people.map((p) => p.id))

  for (const room of Object.values(a.rooms).filter(isGroupMessage)) {
    const members = await api.participants(room.token).catch(() => [])
    const others = members
      .filter((m) => m.actorType === 'users' && m.actorId !== self.id)
      .map((m) => m.actorId)
    if (others.length === wanted.size && others.every((id) => wanted.has(id))) {
      openRoom(accountId, room.token)
      return room.token
    }
  }

  const roomName = groupMessageName([self.displayname, ...people.map((p) => p.name)])
  let room: Room
  if (hasFeature(a, 'conversation-creation-all')) {
    // Talk only lets a conversation be "extended" from an existing one-to-one, like its own
    // "add people" does; that marks it as a group message for everyone
    const dm = await directMessageRoom(accountId, people[0].id)
    room = await api.createRoom({
      roomType: RoomType.Group,
      roomName,
      participants: { users: people.map((p) => p.id) },
      objectType: GROUP_MESSAGE,
      objectId: dm.token
    })
  } else {
    room = await api.createRoom({ roomType: RoomType.Group, roomName })
    for (const p of people) await api.addParticipant(room.token, p.id)
  }
  await openCreated(accountId, room)
  return room.token
}

/** An ad hoc call: opens the conversation with these people and calls them. */
export async function callPeople(
  accountId: string,
  people: PersonRef[],
  handover?: () => Promise<CallHandover | undefined>
): Promise<void> {
  const token = await openConversationWith(accountId, people)
  // Moving a running call goes straight on; a new one asks for the call options first
  if (handover) await startCall(accountId, token, { handover: await handover() })
  else await requestCall(accountId, token)
}

export async function joinListedRoom(accountId: string, token: string): Promise<void> {
  await talk(accountId).joinListed(token)
  const room = await talk(accountId).room(token)
  await openCreated(accountId, room)
}

// --- Categories -----------------------------------------------------------------

function serverTagsEnabled(accountId: string): boolean {
  return !!account(accountId)?.caps?.features.includes('conversation-tags')
}

export async function createCategory(accountId: string, name: string, moveToken?: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  if (serverTagsEnabled(accountId)) {
    try {
      const tag = await talk(accountId).createTag(trimmed)
      setApp((s) => void s.accounts[accountId]?.tags.push(tag))
      if (moveToken) await moveRoomToCategory(accountId, moveToken, `tag:${tag.id}`)
    } catch (err) {
      showToast(`Could not create category: ${errorText(err)}`, 'error')
    }
    return
  }
  const prefs = usePrefs.getState()
  const id = `local:${crypto.randomUUID()}`
  prefs.setLocalCategories(accountId, [
    ...(prefs.localCategories[accountId] ?? []),
    { id, name: trimmed, tokens: [] }
  ])
  if (moveToken) await moveRoomToCategory(accountId, moveToken, id)
}

export async function renameCategory(accountId: string, categoryId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  if (categoryId.startsWith('tag:')) {
    const tagId = categoryId.slice(4)
    try {
      await talk(accountId).renameTag(tagId, trimmed)
      setApp((s) => {
        const t = s.accounts[accountId]?.tags.find((x) => x.id === tagId)
        if (t) t.name = trimmed
      })
    } catch (err) {
      showToast(`Could not rename category: ${errorText(err)}`, 'error')
    }
    return
  }
  const prefs = usePrefs.getState()
  prefs.setLocalCategories(
    accountId,
    (prefs.localCategories[accountId] ?? []).map((c) => (c.id === categoryId ? { ...c, name: trimmed } : c))
  )
}

export function confirmDeleteCategory(accountId: string, cat: SidebarCategory): void {
  setApp({
    modal: {
      type: 'confirm',
      title: `Delete ${cat.name}?`,
      body: 'Channels in this category will move back to Channels and Direct Messages.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        if (cat.tagId) {
          try {
            await talk(accountId).deleteTag(cat.tagId)
            setApp((s) => {
              const a = s.accounts[accountId]
              if (!a) return
              a.tags = a.tags.filter((t) => t.id !== cat.tagId)
              for (const r of Object.values(a.rooms)) r.tagIds = r.tagIds?.filter((t) => t !== cat.tagId)
            })
          } catch (err) {
            showToast(`Could not delete category: ${errorText(err)}`, 'error')
          }
          return
        }
        const prefs = usePrefs.getState()
        prefs.setLocalCategories(
          accountId,
          (prefs.localCategories[accountId] ?? []).filter((c) => c.id !== cat.id)
        )
      }
    }
  })
}

export async function setCategoryCollapsed(accountId: string, cat: SidebarCategory): Promise<void> {
  if (cat.tagId) {
    const next = !cat.collapsed
    setApp((s) => {
      const t = s.accounts[accountId]?.tags.find((x) => x.id === cat.tagId)
      if (t) t.collapsed = next
    })
    await talk(accountId)
      .setTagCollapsed(cat.tagId, next)
      .catch(() => undefined)
    return
  }
  // Some categories start collapsed, so set the opposite of what is shown rather than toggling the stored flag
  usePrefs.getState().setCollapsed(accountId, cat.id, !cat.collapsed)
}

/** Moves a conversation into a category. Target is a category id from buildCategories. */
/** Marks a conversation as a meeting (or not), stored locally; matching Talk's own marking clears the choice. */
export function setMeeting(accountId: string, token: string, meeting: boolean): void {
  const room = account(accountId)?.rooms[token]
  if (!room) return
  const prefs = usePrefs.getState()
  prefs.setMeetingOverride(accountId, token, isMeeting(room) === meeting ? null : meeting)
  if (meeting) {
    // Meetings starts collapsed; open it so the conversation doesn't seem to vanish
    prefs.setCollapsed(accountId, 'meetings', false)
    showToast(`Moved ${room.displayName} to Meetings`)
  }
}

export async function moveRoomToCategory(accountId: string, token: string, target: string): Promise<void> {
  const a = account(accountId)
  const room = a?.rooms[token]
  if (!a || !room) return

  // Meetings is a category of its own; moving there (or back to Channels) marks the conversation
  if (target === 'meetings' || target === 'none') {
    if (target === 'meetings' || !isDirect(room)) setMeeting(accountId, token, target === 'meetings')
    target = 'none'
  }

  if (target === 'favorites') {
    if (!room.isFavorite) await toggleFavorite(accountId, token)
    return
  }
  if (room.isFavorite) await toggleFavorite(accountId, token)

  if (serverTagsEnabled(accountId)) {
    const customIds = new Set(a.tags.filter((t) => t.type === 'custom').map((t) => t.id))
    const keep = (room.tagIds ?? []).filter((id) => !customIds.has(id))
    const tagIds = target.startsWith('tag:') ? [...keep, target.slice(4)] : keep
    patchRoom(accountId, token, (r) => void (r.tagIds = tagIds))
    try {
      await talk(accountId).assignTags(token, tagIds)
    } catch (err) {
      showToast(`Could not move conversation: ${errorText(err)}`, 'error')
      void getSync(accountId)?.refreshRooms()
    }
    return
  }

  const prefs = usePrefs.getState()
  const cats: LocalCategory[] = (prefs.localCategories[accountId] ?? []).map((c) => ({
    ...c,
    tokens:
      c.id === target ? [...c.tokens.filter((t) => t !== token), token] : c.tokens.filter((t) => t !== token)
  }))
  prefs.setLocalCategories(accountId, cats)
}

export async function jumpToMessage(accountId: string, token: string, messageId: number): Promise<void> {
  if (!account(accountId)?.rooms[token]) {
    showToast('That conversation is not in your list', 'error')
    return
  }
  openRoom(accountId, token)
  const key = chatKey(accountId, token)
  if (!useApp.getState().chats[key]?.byId[messageId]) {
    try {
      applyMessages(key, await talk(accountId).context(token, messageId, 30))
    } catch (err) {
      showToast(`Could not load message: ${errorText(err)}`, 'error')
    }
  }
  setApp({ jumpTo: { chatKey: key, id: messageId } })
  setTimeout(() => {
    if (useApp.getState().jumpTo?.id === messageId) setApp({ jumpTo: null })
  }, 4000)
}

export async function copyText(text: string, what = 'Copied to clipboard'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    showToast(what)
  } catch {
    showToast('Could not access the clipboard', 'error')
  }
}
