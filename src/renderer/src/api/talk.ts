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
  Ban,
  PredefinedStatus,
  UnifiedSearchEntry,
  UserProfile,
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

export interface ChatReminder {
  messageId: number
  timestamp: number
  token: string
}

export interface UpcomingReminder {
  reminderTimestamp: number
  roomToken: string
  messageId: number
  actorDisplayName: string
  message: string
  messageParameters: Record<string, { type: string; name: string }> | []
}

export interface ScheduledMessage {
  id: string | number
  message: string
  sendAt: number
  silent?: boolean
  threadId?: number
  threadTitle?: string
  parent?: ChatMessage
}

export interface Poll {
  id: number
  question: string
  options: string[]
  /** 0 open, 1 closed, 2 draft */
  status: number
  /** 0 public results, 1 hidden until closed */
  resultMode: number
  /** 0 is unlimited */
  maxVotes: number
  actorType: string
  actorId: string
  actorDisplayName: string
  /** Votes per option ("option-0": 3), when the results are visible */
  votes?: Record<string, number>
  numVoters?: number
  votedSelf?: number[]
  details?: { actorDisplayName: string; actorId: string; actorType: string; optionId: number }[]
}

export interface MeetingEvent {
  eventName: string
  start: number
  end: number
  eventLink?: string
  calendars?: { calendarName: string; calendarColor?: string }[]
  /** Set in dashboard events */
  roomToken?: string
}

export interface MailAccount {
  id: number
  emailAddress: string
}

export interface MailMailbox {
  databaseId: number
  specialRole?: string | null
}

export interface LinkReference {
  richObjectType: string
  openGraphObject?: {
    id: string
    name?: string
    description?: string | null
    thumb?: string | null
    link?: string
  }
  accessible?: boolean
}

/** A Nextcloud AI task (task processing) */
export interface AiTask {
  id: number
  type: string
  /** STATUS_SCHEDULED, STATUS_RUNNING, STATUS_SUCCESSFUL, STATUS_FAILED, STATUS_CANCELLED, STATUS_UNKNOWN */
  status: string
  output?: Record<string, unknown> | null
  errorMessage?: string | null
  progress?: number
}

export interface NotificationAction {
  label: string
  link: string
  /** GET, POST, DELETE, PUT, or WEB to open the link */
  type: string
  primary: boolean
}

export interface ServerNotification {
  notification_id: number
  app: string
  object_type: string
  object_id: string
  subject: string
  message?: string
  link?: string
  icon?: string
  /** ISO 8601 */
  datetime?: string
  actions?: NotificationAction[]
}

/** Your out-of-office settings (Nextcloud 28+); days as yyyy-mm-dd */
export interface OutOfOffice {
  firstDay: string
  lastDay: string
  /** Short message, shown like a status */
  status: string
  message: string
  replacementUserId?: string | null
  replacementUserDisplayName?: string | null
}

/** Someone's absence right now, as others see it */
export interface CurrentAbsence {
  userId: string
  /** Unix seconds */
  startDate: number
  endDate: number
  shortMessage: string
  message: string
  replacementUserId?: string | null
  replacementUserDisplayName?: string | null
}

/** What a conversation's shared items are grouped by */
export type SharedItemType =
  'media' | 'file' | 'voice' | 'audio' | 'location' | 'deckcard' | 'poll' | 'recording' | 'other'

export interface MessagesPage {
  messages: ChatMessage[]
  lastGiven: number | null
  notModified: boolean
  /** Last message read by everyone (read receipts) */
  lastCommonRead: number | null
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
    setImportant: (token: string, on: boolean) =>
      on ? post(`${SPREED}/v4/room/${token}/important`) : del(`${SPREED}/v4/room/${token}/important`),
    setSensitive: (token: string, on: boolean) =>
      on ? post(`${SPREED}/v4/room/${token}/sensitive`) : del(`${SPREED}/v4/room/${token}/sensitive`),
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

    dismissNotification: (id: number) => del(`/ocs/v2.php/apps/notifications/api/v2/notifications/${id}`),
    dismissAllNotifications: () => del('/ocs/v2.php/apps/notifications/api/v2/notifications'),
    /** A notification's action (e.g. "Accept"): its link on this server with its method */
    async notificationAction(action: NotificationAction, serverUrl: string): Promise<void> {
      const base = serverUrl.replace(/\/+$/, '')
      if (!action.link.startsWith(`${base}/`)) throw new Error('The action points to another server')
      const method = action.type.toUpperCase()
      if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
        throw new Error(`Unsupported action ${action.type}`)
      }
      await call(accountId, method, action.link.slice(base.length))
    },

    /** The newest shared items of each kind in a conversation */
    sharedOverview: (token: string, limit = 7) =>
      get<Partial<Record<SharedItemType, ChatMessage[]>>>(`${SPREED}/v1/chat/${token}/share/overview`, {
        query: { limit }
      }),
    /** More shared items of one kind, older than lastKnownMessageId */
    async sharedItems(
      token: string,
      objectType: SharedItemType,
      lastKnownMessageId?: number,
      limit = 50
    ): Promise<ChatMessage[]> {
      const data = await get<Record<string, ChatMessage> | ChatMessage[]>(
        `${SPREED}/v1/chat/${token}/share`,
        {
          query: { objectType, lastKnownMessageId, limit }
        }
      )
      return (Array.isArray(data) ? data : Object.values(data)).sort((a, b) => b.id - a.id)
    },

    // Out of office (Nextcloud 28+)
    /** Your own settings; 404 when none are set */
    outOfOffice: (userId: string) =>
      get<OutOfOffice>(`/ocs/v2.php/apps/dav/api/v1/outOfOffice/${encodeURIComponent(userId)}`),
    setOutOfOffice: (userId: string, data: OutOfOffice) =>
      post<OutOfOffice>(
        `/ocs/v2.php/apps/dav/api/v1/outOfOffice/${encodeURIComponent(userId)}`,
        data as unknown as Record<string, unknown>
      ),
    clearOutOfOffice: (userId: string) =>
      del(`/ocs/v2.php/apps/dav/api/v1/outOfOffice/${encodeURIComponent(userId)}`),
    /** Someone's absence now; 404 when they're not away */
    currentAbsence: (userId: string) =>
      get<CurrentAbsence>(`/ocs/v2.php/apps/dav/api/v1/outOfOffice/${encodeURIComponent(userId)}/now`),
    /** Whether the server has out-of-office (Nextcloud 28+) */
    async supportsAbsence(): Promise<boolean> {
      const data = await get<{ capabilities: { dav?: { 'absence-supported'?: boolean } } }>(
        '/ocs/v2.php/cloud/capabilities'
      )
      return !!data.capabilities.dav?.['absence-supported']
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
    removeAttendee: (token: string, attendeeId: number) =>
      del(`${SPREED}/v4/room/${token}/attendees`, { attendeeId }),

    // Moderation
    /** state 1 lets only moderators in; timer (unix seconds) opens the lobby by itself */
    setLobby: (token: string, state: 0 | 1, timer?: number | null) =>
      put<Room>(`${SPREED}/v4/room/${token}/webinar/lobby`, { state, timer: timer ?? null }),
    setReadOnly: (token: string, state: 0 | 1) => put(`${SPREED}/v4/room/${token}/read-only`, { state }),
    /** Seconds after which new messages are deleted; 0 for never */
    setMessageExpiration: (token: string, seconds: number) =>
      post(`${SPREED}/v4/room/${token}/message-expiration`, { seconds }),
    setDefaultPermissions: (token: string, permissions: number) =>
      put<Room>(`${SPREED}/v4/room/${token}/permissions/default`, { permissions }),
    setListable: (token: string, scope: 0 | 1 | 2) => put(`${SPREED}/v4/room/${token}/listable`, { scope }),
    setMentionPermissions: (token: string, mentionPermissions: 0 | 1) =>
      put(`${SPREED}/v4/room/${token}/mention-permissions`, { mentionPermissions }),
    promoteModerator: (token: string, attendeeId: number) =>
      post(`${SPREED}/v4/room/${token}/moderators`, { attendeeId }),
    demoteModerator: (token: string, attendeeId: number) =>
      del(`${SPREED}/v4/room/${token}/moderators`, { attendeeId }),
    /** Sets one person's permissions (Permission bits; 0 back to the conversation's default) */
    setAttendeePermissions: (token: string, attendeeId: number, permissions: number) =>
      put(`${SPREED}/v4/room/${token}/attendees/permissions`, { attendeeId, method: 'set', permissions }),
    bans: (token: string) => get<Ban[]>(`${SPREED}/v1/ban/${token}`),
    ban: (token: string, actorType: string, actorId: string, internalNote: string) =>
      post<Ban>(`${SPREED}/v1/ban/${token}`, { actorType, actorId, internalNote }),
    unban: (token: string, banId: number) => del(`${SPREED}/v1/ban/${token}/${banId}`),
    /** Deletes every message of the conversation, for everyone */
    clearHistory: (token: string) => del(`${SPREED}/v1/chat/${token}`),

    // Breakout rooms
    /** mode 1 automatic, 2 manual, 3 free; attendeeMap is {attendeeId: room index} */
    configureBreakoutRooms: (
      token: string,
      mode: 1 | 2 | 3,
      amount: number,
      attendeeMap?: Record<number, number>
    ) =>
      post<Room[]>(`${SPREED}/v1/breakout-rooms/${token}`, {
        mode,
        amount,
        attendeeMap: attendeeMap ? JSON.stringify(attendeeMap) : undefined
      }),
    removeBreakoutRooms: (token: string) => del(`${SPREED}/v1/breakout-rooms/${token}`),
    startBreakoutRooms: (token: string) => post<Room[]>(`${SPREED}/v1/breakout-rooms/${token}/rooms`),
    stopBreakoutRooms: (token: string) => del<Room[]>(`${SPREED}/v1/breakout-rooms/${token}/rooms`),
    broadcastToBreakoutRooms: (token: string, message: string) =>
      post(`${SPREED}/v1/breakout-rooms/${token}/broadcast`, { message }),
    breakoutRooms: (token: string) => get<Room[]>(`${SPREED}/v4/room/${token}/breakout-rooms`),
    breakoutParticipants: (token: string) =>
      get<(Participant & { roomToken: string })[]>(`${SPREED}/v4/room/${token}/breakout-rooms/participants`),
    /** In a breakout room: ask the moderators for help, or stop asking */
    requestAssistance: (token: string, on: boolean) =>
      on
        ? post(`${SPREED}/v1/breakout-rooms/${token}/request-assistance`)
        : del(`${SPREED}/v1/breakout-rooms/${token}/request-assistance`),
    /** Free mode: go to another breakout room of the parent conversation */
    switchBreakoutRoom: (parentToken: string, target: string) =>
      post<Room>(`${SPREED}/v1/breakout-rooms/${parentToken}/switch`, { target }),

    // Recording (needs a recording server)
    /** status 1 video, 2 audio */
    startRecording: (token: string, status: 1 | 2) => post(`${SPREED}/v1/recording/${token}`, { status }),
    stopRecording: (token: string) => del(`${SPREED}/v1/recording/${token}`),
    /** Whether people must agree to recording before joining calls here (when the server leaves it to moderators) */
    setRecordingConsent: (token: string, recordingConsent: 0 | 1) =>
      put(`${SPREED}/v4/room/${token}/recording-consent`, { recordingConsent }),

    // Live captions (needs the live_transcription app); you have to be in the call
    enableLiveTranscription: (token: string) => post(`${SPREED}/v1/live-transcription/${token}`),
    disableLiveTranscription: (token: string) => del(`${SPREED}/v1/live-transcription/${token}`),
    liveTranscriptionLanguages: () =>
      get<Record<string, { name: string; metadata?: { separator?: string; rtl?: boolean } }>>(
        `${SPREED}/v1/live-transcription/languages`
      ),
    /** The language spoken in the call (moderators) */
    setLiveTranscriptionLanguage: (token: string, languageId: string) =>
      post(`${SPREED}/v1/live-transcription/${token}/language`, { languageId }),

    // AI (Nextcloud's task processing: Assistant, OpenAI integration, local models, …)
    /** Summarizes the chat from a message on; poll the task. nextOffset is set when there is more. */
    summarizeChat: (token: string, fromMessageId: number) =>
      post<{ taskId: number; nextOffset?: number } | null>(`${SPREED}/v1/chat/${token}/summarize`, {
        fromMessageId
      }),
    taskTypes: () =>
      get<{ types: Record<string, { name: string; description?: string }> }>(
        '/ocs/v2.php/taskprocessing/tasktypes'
      ),
    scheduleTask: (type: string, input: Record<string, unknown>, customId?: string) =>
      post<{ task: AiTask }>('/ocs/v2.php/taskprocessing/schedule', {
        type,
        input,
        appId: 'hubbub',
        customId
      }),
    task: (id: number) => get<{ task: AiTask }>(`/ocs/v2.php/taskprocessing/task/${id}`),
    cancelTask: (id: number) => del(`/ocs/v2.php/taskprocessing/task/${id}`),
    translationLanguages: () =>
      get<{
        languages: { from: string; fromLabel: string; to: string; toLabel: string }[]
        languageDetection: boolean
      }>('/ocs/v2.php/translation/languages'),
    translate: (text: string, toLanguage: string, fromLanguage?: string | null) =>
      post<{ text: string; from?: string | null }>('/ocs/v2.php/translation/translate', {
        text,
        toLanguage,
        fromLanguage: fromLanguage ?? null
      }),
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
      const common = res.headers['x-chat-last-common-read']
      return {
        messages: res.data ?? [],
        lastGiven,
        notModified: res.status === 304,
        lastCommonRead: common ? Number(common) : null
      }
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
    // Reminders (remind-me-later)
    setReminder: (token: string, id: number, timestamp: number) =>
      post(`${SPREED}/v1/chat/${token}/${id}/reminder`, { timestamp }),
    reminder: async (token: string, id: number): Promise<ChatReminder | null> => {
      const res = await raw<ChatReminder>(accountId, 'GET', `${SPREED}/v1/chat/${token}/${id}/reminder`)
      return res.ok ? res.data : null
    },
    deleteReminder: (token: string, id: number) => del(`${SPREED}/v1/chat/${token}/${id}/reminder`),
    upcomingReminders: () => get<UpcomingReminder[]>(`${SPREED}/v1/chat/upcoming-reminders`),

    // Pinned messages
    pin: (token: string, id: number, pinUntil?: number) =>
      post(`${SPREED}/v1/chat/${token}/${id}/pin`, pinUntil ? { pinUntil } : {}),
    unpin: (token: string, id: number) => del(`${SPREED}/v1/chat/${token}/${id}/pin`),
    hidePin: (token: string, id: number) => del(`${SPREED}/v1/chat/${token}/${id}/pin/self`),

    // Scheduled messages
    scheduled: (token: string) => get<ScheduledMessage[]>(`${SPREED}/v1/chat/${token}/schedule`),
    schedule: (
      token: string,
      body: {
        message: string
        sendAt: number
        replyTo?: number
        threadId?: number
        threadTitle?: string
        silent?: boolean
      }
    ) => post<ScheduledMessage>(`${SPREED}/v1/chat/${token}/schedule`, body),
    reschedule: (token: string, id: string | number, body: { message: string; sendAt: number }) =>
      post<ScheduledMessage>(`${SPREED}/v1/chat/${token}/schedule/${id}`, body),
    unschedule: (token: string, id: string | number) => del(`${SPREED}/v1/chat/${token}/schedule/${id}`),

    // Polls
    poll: (token: string, id: number | string) => get<Poll>(`${SPREED}/v1/poll/${token}/${id}`),
    createPoll: (
      token: string,
      body: { question: string; options: string[]; resultMode: number; maxVotes: number; threadId?: number }
    ) => post<Poll>(`${SPREED}/v1/poll/${token}`, body),
    vote: (token: string, id: number | string, optionIds: number[]) =>
      post<Poll>(`${SPREED}/v1/poll/${token}/${id}`, { optionIds }),
    closePoll: (token: string, id: number | string) => del<Poll>(`${SPREED}/v1/poll/${token}/${id}`),

    // Meetings
    scheduleMeeting: (
      token: string,
      body: {
        calendarUri: string
        start: number
        end?: number
        title?: string
        description?: string
        attendeeIds?: number[] | null
      }
    ) => post(`${SPREED}/v4/room/${token}/meeting`, body),
    /** Events in the next 7 days shared with the other person of a 1:1 conversation */
    mutualEvents: (token: string) => get<MeetingEvent[]>(`${SPREED}/v4/room/${token}/mutual-events`),
    /** Our events in the next 7 days that belong to a conversation */
    dashboardEvents: () => get<MeetingEvent[]>(`${SPREED}/v4/dashboard/events`),

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

    // Nextcloud Mail (its web API), for invitations that arrive by mail
    mailAccounts: () => get<MailAccount[]>('/index.php/apps/mail/api/accounts'),
    mailMailboxes: (mailAccountId: number) =>
      get<{ mailboxes: MailMailbox[] }>('/index.php/apps/mail/api/mailboxes', {
        query: { accountId: mailAccountId }
      }),
    /**
     * Brings Mail's copy of a mailbox up to date with the mail server, as Nextcloud Mail does while it
     * is open (it lists only what it has copied). `init` for a mailbox it hasn't copied yet (412).
     * Nothing is marked read.
     */
    mailSync: (mailboxId: number, init = false) =>
      raw<unknown>(accountId, 'POST', `/index.php/apps/mail/api/mailboxes/${mailboxId}/sync`, {
        body: { init },
        timeoutMs: 120_000
      }),
    /**
     * Messages one by one (not by thread) since a time, newest first unless the user has Mail sort
     * the oldest first; continue after the last with its dateInt as `cursor`. Listing also makes Mail
     * recognise invitations. Nothing is marked read.
     */
    mailMessages: (mailboxId: number, opts: { limit: number; since: number; cursor?: number }) =>
      get<
        {
          databaseId: number
          imipMessage?: boolean
          dateInt?: number
          subject?: string
          to?: { email?: string }[]
          cc?: { email?: string }[]
        }[]
      >('/index.php/apps/mail/api/messages', {
        query: {
          mailboxId,
          limit: opts.limit,
          view: 'singleton',
          filter: `start:${opts.since}`,
          cursor: opts.cursor
        }
      }),
    /** A message's invitations (iCalendar with their method); reading them doesn't mark the mail read */
    mailScheduling: (messageId: number) =>
      get<{ scheduling?: { method: string; contents: string }[] }>(
        `/index.php/apps/mail/api/messages/${messageId}/body`
      ),

    // Users & search
    /** Nextcloud's preview of a link: its page's title, description and image (Talk on the web shows the same) */
    resolveReference: (reference: string) =>
      get<{ references: Record<string, LinkReference | null> }>('/ocs/v2.php/references/resolve', {
        query: { reference }
      }),
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
      put<UserStatus>('/ocs/v2.php/apps/user_status/api/v1/user_status/status', { statusType }),
    /** Nextcloud's suggested status messages ("In a meeting", "Out sick", …) */
    predefinedStatuses: () =>
      get<PredefinedStatus[]>('/ocs/v2.php/apps/user_status/api/v1/predefined_statuses'),
    /** A predefined message by its id (other people see it in their language); clearAt in unix seconds */
    setPredefinedMessage: (messageId: string, clearAt: number | null) =>
      put<UserStatus>('/ocs/v2.php/apps/user_status/api/v1/user_status/message/predefined', {
        messageId,
        clearAt
      }),
    setCustomMessage: (message: string, statusIcon: string | null, clearAt: number | null) =>
      put<UserStatus>('/ocs/v2.php/apps/user_status/api/v1/user_status/message/custom', {
        message,
        statusIcon,
        clearAt
      }),
    clearStatusMessage: () => del('/ocs/v2.php/apps/user_status/api/v1/user_status/message'),
    /** Someone else's status; 404 when they have never set one */
    statusOf: (userId: string) =>
      get<UserStatus>(`/ocs/v2.php/apps/user_status/api/v1/statuses/${encodeURIComponent(userId)}`),
    /** Someone's profile, as far as they share it with you */
    profile: (userId: string) => get<UserProfile>(`/ocs/v2.php/profile/${encodeURIComponent(userId)}`),
    /** Whether the server lets users choose "Busy" (Nextcloud 30+) */
    async supportsBusy(): Promise<boolean> {
      const data = await get<{ capabilities: { user_status?: { supports_busy?: boolean } } }>(
        '/ocs/v2.php/cloud/capabilities'
      )
      return !!data.capabilities.user_status?.supports_busy
    }
  }
}

export type TalkApi = ReturnType<typeof talk>
