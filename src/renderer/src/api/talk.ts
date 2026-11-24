import type { HttpMethod, OcsRequest, OcsResponse, QueryValue } from '@shared/ipc'
import type {
  AutocompleteResult,
  ChatMessage,
  ConversationTag,
  CurrentUser,
  MentionSuggestion,
  Participant,
  Room,
  SignalingSettings,
  TalkCapabilities,
  ThreadInfo,
  UnifiedSearchEntry,
  UserStatus
} from '@shared/talk-types'

const SPREED = '/ocs/v2.php/apps/spreed/api'

export class TalkError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

interface CallOptions {
  query?: Record<string, QueryValue>
  body?: Record<string, unknown>
  timeoutMs?: number
  requestId?: string
  ifNoneMatch?: string
}

async function raw<T>(
  accountId: string,
  method: HttpMethod,
  path: string,
  opts: CallOptions = {}
): Promise<OcsResponse<T>> {
  const req: OcsRequest = { accountId, method, path, ...opts }
  return window.hubbub.ocs<T>(req)
}

async function call<T>(
  accountId: string,
  method: HttpMethod,
  path: string,
  opts: CallOptions = {}
): Promise<T> {
  const res = await raw<T>(accountId, method, path, opts)
  if (!res.ok) throw new TalkError(res.error || `HTTP ${res.status}`, res.status)
  return res.data as T
}

export interface ServerNotification {
  notification_id: number
  app: string
  object_type: string
  object_id: string
  subject: string
}

export interface MessagesPage {
  messages: ChatMessage[]
  lastGiven: number | null
  notModified: boolean
}

export interface SendOptions {
  message: string
  referenceId: string
  replyTo?: number
  threadId?: number
  threadTitle?: string
  silent?: boolean
}

/** Typed wrapper around the Talk OCS endpoints for one account. */
export function talk(accountId: string) {
  const get = <T>(path: string, opts?: CallOptions): Promise<T> => call<T>(accountId, 'GET', path, opts)
  const post = <T>(path: string, body?: Record<string, unknown>): Promise<T> =>
    call<T>(accountId, 'POST', path, { body })
  const put = <T>(path: string, body?: Record<string, unknown>): Promise<T> =>
    call<T>(accountId, 'PUT', path, { body })
  const del = <T>(path: string, query?: Record<string, QueryValue>): Promise<T> =>
    call<T>(accountId, 'DELETE', path, { query })

  return {
    async capabilities(): Promise<TalkCapabilities> {
      const data = await get<{ capabilities: { spreed?: TalkCapabilities } }>(
        '/ocs/v2.php/cloud/capabilities'
      )
      if (!data.capabilities.spreed) throw new TalkError('Nextcloud Talk is not enabled on this server', 404)
      return data.capabilities.spreed
    },
    currentUser: () => get<CurrentUser>('/ocs/v2.php/cloud/user'),

    // Conversations
    rooms: () => get<Room[]>(`${SPREED}/v4/room`, { query: { includeStatus: true } }),
    room: (token: string) => get<Room>(`${SPREED}/v4/room/${token}`),
    setFavorite: (token: string, favorite: boolean) =>
      favorite ? post(`${SPREED}/v4/room/${token}/favorite`) : del(`${SPREED}/v4/room/${token}/favorite`),
    setNotificationLevel: (token: string, level: number) =>
      post(`${SPREED}/v4/room/${token}/notify`, { level }),
    leave: (token: string) => del(`${SPREED}/v4/room/${token}/participants/self`),
    joinListed: (token: string) => post(`${SPREED}/v4/room/${token}/participants/active`, { force: true }),
    createRoom: (body: {
      roomType: number
      invite?: string
      source?: string
      roomName?: string
      /** Talk 21+ (conversation-creation-all) */
      participants?: { users?: string[] }
      objectType?: string
      objectId?: string
    }) => post<Room>(`${SPREED}/v4/room`, body),
    listedRooms: (searchTerm: string) => get<Room[]>(`${SPREED}/v4/listed-room`, { query: { searchTerm } }),
    participants: (token: string) =>
      get<Participant[]>(`${SPREED}/v4/room/${token}/participants`, { query: { includeStatus: true } }),
    setDescription: (token: string, description: string) =>
      put(`${SPREED}/v4/room/${token}/description`, { description }),
    rename: (token: string, roomName: string) => put(`${SPREED}/v4/room/${token}`, { roomName }),

    /** Nextcloud notifications; `notModified` when the ETag still matches */
    async notifications(
      etag?: string
    ): Promise<{ list: ServerNotification[]; etag?: string; notModified: boolean }> {
      const res = await raw<ServerNotification[]>(
        accountId,
        'GET',
        '/ocs/v2.php/apps/notifications/api/v2/notifications',
        {
          ifNoneMatch: etag,
          timeoutMs: 15_000
        }
      )
      if (res.status === 304) return { list: [], etag, notModified: true }
      if (!res.ok) throw new TalkError(res.error || `HTTP ${res.status}`, res.status)
      return { list: res.data ?? [], etag: res.headers.etag, notModified: false }
    },

    // Calls. Joining a call needs a conversation session, which Nextcloud keeps in a cookie.
    signalingSettings: (token: string) =>
      get<SignalingSettings>(`${SPREED}/v3/signaling/settings`, { query: { token } }),
    /** Returns the Nextcloud session id; 409 when the user is already in the conversation elsewhere */
    joinSession: (token: string, force: boolean) =>
      raw<{ sessionId: string; inCall?: number }>(
        accountId,
        'POST',
        `${SPREED}/v4/room/${token}/participants/active`,
        { body: { force } }
      ),
    leaveSession: (token: string) => del(`${SPREED}/v4/room/${token}/participants/active`),
    addParticipant: (token: string, userId: string) =>
      post(`${SPREED}/v4/room/${token}/participants`, { newParticipant: userId, source: 'users' }),
    /** Rings a conversation member who isn't in the call (moderators, send-call-notification) */
    ring: (token: string, attendeeId: number) => post(`${SPREED}/v4/call/${token}/ring/${attendeeId}`),
    joinCall: (token: string, body: { flags: number; silent?: boolean; recordingConsent?: boolean }) =>
      post(`${SPREED}/v4/call/${token}`, body),
    setCallFlags: (token: string, flags: number) => put(`${SPREED}/v4/call/${token}`, { flags }),
    leaveCall: (token: string, all = false) =>
      del(`${SPREED}/v4/call/${token}`, all ? { all: true } : undefined),

    // Chat
    async messages(
      token: string,
      p: {
        lookIntoFuture: boolean
        lastKnownMessageId?: number
        limit?: number
        timeout?: number
        threadId?: number
        requestId?: string
      }
    ): Promise<MessagesPage> {
      const res = await raw<ChatMessage[]>(accountId, 'GET', `${SPREED}/v1/chat/${token}`, {
        query: {
          lookIntoFuture: p.lookIntoFuture ? 1 : 0,
          lastKnownMessageId: p.lastKnownMessageId || undefined,
          limit: p.limit ?? 100,
          timeout: p.lookIntoFuture ? (p.timeout ?? 30) : undefined,
          threadId: p.threadId || undefined,
          setReadMarker: 0,
          includeLastKnown: 0,
          markNotificationsAsRead: 0
        },
        timeoutMs: p.lookIntoFuture ? ((p.timeout ?? 30) + 15) * 1000 : 30_000,
        requestId: p.requestId
      })
      if (!res.ok) throw new TalkError(res.error || `HTTP ${res.status}`, res.status)
      const lastGiven = res.headers['x-chat-last-given'] ? Number(res.headers['x-chat-last-given']) : null
      return { messages: res.data ?? [], lastGiven, notModified: res.status === 304 }
    },
    context: (token: string, messageId: number, limit = 50) =>
      get<ChatMessage[]>(`${SPREED}/v1/chat/${token}/${messageId}/context`, { query: { limit } }),
    send: (token: string, o: SendOptions) => post<ChatMessage>(`${SPREED}/v1/chat/${token}`, { ...o }),
    edit: (token: string, id: number, message: string) =>
      put<ChatMessage>(`${SPREED}/v1/chat/${token}/${id}`, { message }),
    deleteMessage: (token: string, id: number) => del<ChatMessage>(`${SPREED}/v1/chat/${token}/${id}`),
    /** Moves the read marker (also backwards); recent servers answer with the updated conversation */
    markRead: (token: string, lastReadMessage: number) =>
      post<Room | []>(`${SPREED}/v1/chat/${token}/read`, { lastReadMessage }),
    markUnread: (token: string) => del<Room | []>(`${SPREED}/v1/chat/${token}/read`),
    react: (token: string, id: number, reaction: string) =>
      post(`${SPREED}/v1/reaction/${token}/${id}`, { reaction }),
    unreact: (token: string, id: number, reaction: string) =>
      del(`${SPREED}/v1/reaction/${token}/${id}`, { reaction }),
    mentions: (token: string, search: string) =>
      get<MentionSuggestion[]>(`${SPREED}/v1/chat/${token}/mentions`, {
        query: { search, limit: 15, includeStatus: true }
      }),

    // Threads (Talk 22+)
    subscribedThreads: (limit = 100) =>
      get<ThreadInfo[]>(`${SPREED}/v1/chat/subscribed-threads`, { query: { limit } }),
    /** Following a native thread = any level but Never; Never unfollows it */
    setThreadNotificationLevel: (token: string, threadId: number, level: number) =>
      post<ThreadInfo>(`${SPREED}/v1/chat/${token}/threads/${threadId}/notify`, { level }),
    recentThreads: (token: string) => get<ThreadInfo[]>(`${SPREED}/v1/chat/${token}/threads/recent`),
    threadInfo: (token: string, threadId: number) =>
      get<ThreadInfo>(`${SPREED}/v1/chat/${token}/threads/${threadId}`),

    // Conversation tags = custom sidebar categories (Talk 24+)
    tags: () => get<ConversationTag[]>(`${SPREED}/v4/tags`),
    createTag: (name: string) => post<ConversationTag>(`${SPREED}/v4/tags`, { name }),
    renameTag: (id: string, name: string) => put<ConversationTag>(`${SPREED}/v4/tags/${id}`, { name }),
    deleteTag: (id: string) => del(`${SPREED}/v4/tags/${id}`),
    setTagCollapsed: (id: string, collapsed: boolean) =>
      put(`${SPREED}/v4/tags/${id}/collapsed`, { collapsed }),
    assignTags: (token: string, tagIds: string[]) =>
      post<Room>(`${SPREED}/v4/room/${token}/tags`, { tagIds }),

    // Files
    shareFile: (token: string, path: string, referenceId: string, talkMetaData: Record<string, unknown>) =>
      post('/ocs/v2.php/apps/files_sharing/api/v1/shares', {
        shareType: 10,
        shareWith: token,
        path,
        referenceId,
        talkMetaData: JSON.stringify(talkMetaData)
      }),
    attachmentFolder: (token: string, fileNames: string[]) =>
      post<{ folder: string; renames: Record<string, string>[] }>(
        `${SPREED}/v1/chat/${token}/attachment/folder`,
        {
          fileNames
        }
      ),
    postAttachment: (
      token: string,
      filePath: string,
      fileName: string,
      referenceId: string,
      talkMetaData: Record<string, unknown>
    ) =>
      post(`${SPREED}/v1/chat/${token}/attachment`, {
        filePath,
        fileName,
        referenceId,
        talkMetaData: JSON.stringify(talkMetaData)
      }),

    // Users & search
    autocompleteUsers: (search: string, limit = 20) =>
      get<AutocompleteResult[]>('/ocs/v2.php/core/autocomplete/get', {
        query: { search, itemType: 'call', itemId: 'new', limit, shareTypes: [0] }
      }),
    searchMessages: (term: string, limit = 25) =>
      get<{ entries: UnifiedSearchEntry[] }>('/ocs/v2.php/search/providers/talk-message/search', {
        query: { term, limit }
      }),
    userStatus: () => get<UserStatus>('/ocs/v2.php/apps/user_status/api/v1/user_status'),
    setUserStatus: (statusType: string) =>
      put<UserStatus>('/ocs/v2.php/apps/user_status/api/v1/user_status/status', { statusType })
  }
}

export type TalkApi = ReturnType<typeof talk>
