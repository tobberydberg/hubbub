import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { AccountInfo, CertificateInfo, UpdateStatus } from '@shared/ipc'
import type {
  ChatMessage,
  ConversationTag,
  CurrentUser,
  Room,
  TalkCapabilities,
  ThreadInfo
} from '@shared/talk-types'

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'unauthorized'

export interface AccountState {
  info: AccountInfo
  status: ConnectionStatus
  error?: string
  user?: CurrentUser
  caps?: TalkCapabilities
  rooms: Record<string, Room>
  roomsLoaded: boolean
  tags: ConversationTag[]
  activeToken: string | null
  /** What the server shows: a conversation, the threads list, or the calendar */
  view: 'room' | 'threads' | 'calendar'
  userStatus?: string
  /** Native threads the user follows (Talk 22+); undefined until loaded */
  subscribedThreads?: ThreadInfo[]
}

export interface PendingMessage {
  referenceId: string
  message: string
  timestamp: number
  threadId?: number
  replyTo?: number
  error?: string
}

export interface ChatState {
  byId: Record<number, ChatMessage>
  /** Ascending ids of displayable messages */
  ids: number[]
  /** Highest message id seen, including hidden system messages; used for polling */
  newestId: number
  /** Cursor for loading older history */
  oldestCursor: number | null
  hasMoreOlder: boolean
  loadingOlder: boolean
  loaded: boolean
  error?: string
  /** lastReadMessage when the room was opened, for the "New Messages" line */
  unreadFromId: number | null
  pending: PendingMessage[]
  /** Threads whose history has been fetched */
  loadedThreads: Record<number, boolean>
}

export type RhsState =
  | { type: 'thread'; accountId: string; token: string; rootId: number }
  | { type: 'members'; accountId: string; token: string }
  | { type: 'info'; accountId: string; token: string }
  | { type: 'search'; accountId: string; query: string }
  | { type: 'reminders'; accountId: string }
  | { type: 'scheduled'; accountId: string; token: string }
  /** A calendar event, by its id (see CalendarEvent) */
  | { type: 'event'; accountId: string; eventId: string }

export type ModalState =
  | { type: 'add-server'; serverUrl?: string }
  | { type: 'certificate'; accountId: string; cert: CertificateInfo }
  | { type: 'settings' }
  | { type: 'server-settings'; accountId: string }
  | { type: 'switcher' }
  | { type: 'new-conversation'; kind: 'channel' | 'dm' | 'call' }
  | { type: 'browse' }
  | { type: 'category-name'; accountId: string; categoryId?: string; initial?: string; moveToken?: string }
  | {
      type: 'confirm'
      title: string
      body: string
      confirmLabel: string
      danger?: boolean
      onConfirm: () => void
      onCancel?: () => void
    }
  | { type: 'image'; src: string; name: string; link?: string }
  | { type: 'pick-time'; title: string; confirmLabel: string; initial: number; onPick: (at: number) => void }
  | { type: 'poll'; accountId: string; token: string; threadId?: number; question?: string }
  | { type: 'meeting'; accountId: string; token: string }
  | { type: 'call-setup'; accountId: string; token: string }
  /** New calendar event (optionally at a time), or editing one by its id */
  | {
      type: 'event-edit'
      accountId: string
      eventId?: string
      start?: number
      end?: number
      allDay?: boolean
    }

export interface AppState {
  accounts: Record<string, AccountState>
  accountOrder: string[]
  activeAccountId: string | null
  chats: Record<string, ChatState>
  rhs: RhsState | null
  modal: ModalState | null
  drafts: Record<string, string>
  replyTo: Record<string, ChatMessage | null>
  editing: { chatKey: string; id: number } | null
  /** Message to scroll to and highlight (search results, permalinks) */
  jumpTo: { chatKey: string; id: number } | null
  update: UpdateStatus
  toast: { id: number; text: string; kind: 'info' | 'error' } | null
  initialized: boolean
}

export const chatKey = (accountId: string, token: string): string => `${accountId}/${token}`

export function emptyChat(): ChatState {
  return {
    byId: {},
    ids: [],
    newestId: 0,
    oldestCursor: null,
    hasMoreOlder: true,
    loadingOlder: false,
    loaded: false,
    unreadFromId: null,
    pending: [],
    loadedThreads: {}
  }
}

export const useApp = create<AppState>()(
  immer(() => ({
    accounts: {},
    accountOrder: [],
    activeAccountId: null,
    chats: {},
    rhs: null,
    modal: null,
    drafts: {},
    replyTo: {},
    editing: null,
    jumpTo: null,
    update: { state: 'idle' },
    toast: null,
    initialized: false
  }))
)

export const setApp = useApp.setState

// Drafts survive restarts, like in Mattermost. Kept out of the zustand persist middleware so the rest
// of the (large, volatile) app state is never written to storage.
const DRAFTS_KEY = 'hubbub-drafts'
try {
  const saved = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') as Record<string, string>
  if (saved && typeof saved === 'object') setApp({ drafts: saved })
} catch {
  // Storage unavailable or corrupt: start without drafts
}
let draftsTimer: ReturnType<typeof setTimeout> | null = null
useApp.subscribe((s, prev) => {
  if (s.drafts === prev.drafts) return
  if (draftsTimer) clearTimeout(draftsTimer)
  draftsTimer = setTimeout(() => {
    const nonEmpty = Object.fromEntries(Object.entries(useApp.getState().drafts).filter(([, v]) => v.trim()))
    try {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(nonEmpty))
    } catch {
      // Quota or storage errors only cost the draft
    }
  }, 400)
})

// --- Selectors ---------------------------------------------------------------

export function useActiveAccount(): AccountState | undefined {
  return useApp((s) => (s.activeAccountId ? s.accounts[s.activeAccountId] : undefined))
}

export function useActiveRoom(): Room | undefined {
  return useApp((s) => {
    const a = s.activeAccountId ? s.accounts[s.activeAccountId] : undefined
    return a?.activeToken ? a.rooms[a.activeToken] : undefined
  })
}

export function hasFeature(account: AccountState | undefined, feature: string): boolean {
  return !!account?.caps?.features.includes(feature)
}

let toastId = 0
export function showToast(text: string, kind: 'info' | 'error' = 'info'): void {
  const id = ++toastId
  setApp({ toast: { id, text, kind } })
  setTimeout(() => {
    if (useApp.getState().toast?.id === id) setApp({ toast: null })
  }, 5000)
}
