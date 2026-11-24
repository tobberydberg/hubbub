// Subset of the Nextcloud Talk (spreed) API types that Hubbub uses.
// Reference: https://nextcloud-talk.readthedocs.io/ and the spreed openapi.json

export const RoomType = {
  OneToOne: 1,
  Group: 2,
  Public: 3,
  Changelog: 4,
  OneToOneFormer: 5,
  NoteToSelf: 6
} as const

export const NotificationLevel = {
  Default: 0,
  Always: 1,
  Mention: 2,
  Never: 3
} as const

export const ParticipantType = {
  Owner: 1,
  Moderator: 2,
  User: 3,
  Guest: 4,
  UserSelfJoined: 5,
  GuestModerator: 6
} as const

export interface RichObjectParameter {
  type: string
  id: string
  name: string
  link?: string
  path?: string
  mimetype?: string
  size?: number | string
  'preview-available'?: 'yes' | 'no'
  width?: number | string
  height?: number | string
  server?: string
  mention?: string
  [key: string]: unknown
}

export interface ChatMessage {
  id: number
  token: string
  actorType: string
  actorId: string
  actorDisplayName: string
  timestamp: number
  message: string
  messageParameters: Record<string, RichObjectParameter> | []
  messageType:
    | 'comment'
    | 'comment_deleted'
    | 'system'
    | 'command'
    | 'voice-message'
    | 'record-audio'
    | 'record-video'
    | string
  systemMessage: string
  isReplyable?: boolean
  referenceId?: string
  markdown?: boolean
  reactions?: Record<string, number> | []
  reactionsSelf?: string[]
  expirationTimestamp?: number
  lastEditActorDisplayName?: string
  lastEditTimestamp?: number
  silent?: boolean
  /** Pin state (pinned-messages) among other details */
  metaData?: { pinnedActorDisplayName?: string; pinnedAt?: number; pinnedUntil?: number }
  deleted?: boolean
  threadId?: number
  isThread?: boolean
  threadTitle?: string
  threadReplies?: number
  parent?: ChatMessage | { id: number; deleted: true }
}

export interface Room {
  id: number
  token: string
  type: number
  name: string
  displayName: string
  description: string
  isFavorite: boolean
  isArchived?: boolean
  readOnly: number
  unreadMessages: number
  unreadMention: boolean
  unreadMentionDirect: boolean
  lastActivity: number
  lastReadMessage: number
  lastMessage?: ChatMessage | []
  notificationLevel: number
  participantType: number
  permissions: number
  avatarVersion?: string
  isCustomAvatar?: boolean
  canLeaveConversation?: boolean
  canDeleteConversation?: boolean
  hasCall?: boolean
  /** Combined in-call flags of everyone in the call (see InCall) */
  callFlag?: number
  callStartTime?: number
  /** 0: no notifications for calls in this conversation */
  notificationCalling?: number
  /** 1: participants must agree to recording before joining a call */
  recordingConsent?: number
  /** Last message read by everyone with public read status (0 when ours is private) */
  lastCommonReadMessage?: number
  /** Still notifies while the user is on Do not disturb */
  isImportant?: boolean
  /** Message text is left out of notifications */
  isSensitive?: boolean
  /** The message pinned last, and the one the user hid */
  lastPinnedId?: number
  hiddenPinnedId?: number
  hasScheduledMessages?: boolean
  status?: string
  statusIcon?: string | null
  statusMessage?: string | null
  tagIds?: string[]
  muteUntil?: number
  remoteServer?: string
  /** What the conversation belongs to, e.g. 'event' for Calendar meetings (see Talk's object types) */
  objectType?: string
  /** For 'event': "start#end" in unix seconds */
  objectId?: string
}

/** Participant in-call flags */
export const InCall = {
  Disconnected: 0,
  InCall: 1,
  Audio: 2,
  Video: 4,
  Phone: 8
} as const

/** Settings for connecting to the signaling server (GET /signaling/settings) */
export interface SignalingSettings {
  signalingMode: 'internal' | 'external' | 'conversation_cluster' | string
  /** Signaling server URL, empty with internal signaling */
  server: string
  helloAuthParams: {
    '1.0'?: { userid: string | null; ticket: string }
    '2.0'?: { token: string }
  }
  stunservers: { urls: string[] }[]
  turnservers: { urls: string[]; username: string; credential: string }[]
}

export interface ConversationTag {
  id: string
  name: string
  sortOrder: number
  collapsed: boolean
  type: 'custom' | 'favorites' | 'other'
}

export interface ThreadInfo {
  thread: {
    id: number
    roomToken: string
    title: string
    lastMessageId: number
    lastActivity: number
    numReplies: number
  }
  attendee: { notificationLevel: number }
  first: ChatMessage | null
  last: ChatMessage | null
}

export interface Participant {
  attendeeId: number
  actorType: string
  actorId: string
  displayName: string
  participantType: number
  inCall: number
  status?: string
  statusIcon?: string | null
  statusMessage?: string | null
}

export interface MentionSuggestion {
  id: string
  mentionId?: string
  label: string
  source: string
  status?: string
  details?: string
}

export interface AutocompleteResult {
  id: string
  label: string
  source: string
  subline?: string
  status?: { status?: string } | []
}

export interface TalkCapabilities {
  features: string[]
  config: {
    attachments?: { allowed?: boolean; folder?: string; 'conversation-subfolders'?: boolean }
    chat?: { 'max-length'?: number; 'read-privacy'?: number }
    conversations?: { 'can-create'?: boolean }
    [key: string]: unknown
  }
  version?: string
}

export interface CurrentUser {
  id: string
  displayname: string
  email?: string | null
}

export interface UserStatus {
  userId: string
  status: 'online' | 'away' | 'dnd' | 'invisible' | 'offline' | 'busy' | string
  message?: string | null
  icon?: string | null
  /** Unix seconds when the message clears itself */
  clearAt?: number | null
  /** Your own status only: the predefined message's id */
  messageId?: string | null
  messageIsPredefined?: boolean
  /** Your own status only: set by you rather than by Nextcloud (e.g. "In a call") */
  statusIsUserDefined?: boolean
}

export interface PredefinedStatus {
  id: string
  icon: string
  message: string
  clearAt: { type: 'period' | 'end-of'; time: number | string } | null
  visible?: boolean
}

/** Someone's public profile (Nextcloud 23+), as far as they share it */
export interface UserProfile {
  userId: string
  displayname?: string | null
  /** Job title */
  role?: string | null
  /** Company */
  organisation?: string | null
  headline?: string | null
  biography?: string | null
  address?: string | null
  pronouns?: string | null
  timezone?: string | null
  /** Seconds east of UTC */
  timezoneOffset?: number | null
  /** Ways to reach them: email (mailto:), phone (tel:), website, social profiles, Talk */
  actions?: { id: string; icon: string; title: string; target: string }[]
}

export interface UnifiedSearchEntry {
  title: string
  subline: string
  resourceUrl: string
  thumbnailUrl?: string
  attributes?: {
    conversation?: string
    messageId?: string
    actorId?: string
    actorType?: string
    timestamp?: string
  }
}
