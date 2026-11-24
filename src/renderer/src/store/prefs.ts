import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeName = 'denim' | 'sapphire' | 'quartz' | 'indigo' | 'onyx' | 'system'
export type SortMode = 'recent' | 'alpha'

/** Custom sidebar category kept locally, used when the server has no conversation-tags support. */
export interface LocalCategory {
  id: string
  name: string
  tokens: string[]
}

interface PrefsState {
  theme: ThemeName
  notificationsEnabled: boolean
  notifySound: boolean
  showArchived: boolean
  sendOnCtrlEnter: boolean
  /** Mattermost's "collapsed reply threads": replies are shown only in the thread panel */
  collapsedThreads: boolean
  /** Hide meetings this many days after they ended; null never hides them */
  hidePastMeetingsDays: number | null
  /** Conversations the user marked as (not) a meeting: meetingOverrides[accountId][token] */
  meetingOverrides: Record<string, Record<string, boolean>>
  /** collapsed[accountId][categoryId] */
  collapsed: Record<string, Record<string, boolean>>
  sortMode: Record<string, Record<string, SortMode>>
  localCategories: Record<string, LocalCategory[]>
  recentEmojis: string[]
  /** Call devices; null uses the system default */
  microphoneId: string | null
  speakerId: string | null
  cameraId: string | null
  /** Blur the background of our camera in calls */
  backgroundBlur: boolean
  /** ":-)" becomes 🙂 and ":tada:" 🎉 while typing */
  convertEmoticons: boolean
  /** Ring and show a notification when a call starts in a conversation */
  ringForCalls: boolean
  /** Width of the right-hand panel (threads, members, …) in pixels; null is the default */
  rhsWidth: number | null
  /** Call view: everyone the same size, or the speaker large */
  callLayout: 'grid' | 'speaker'
  lastAccountId: string | null
  lastRooms: Record<string, string>

  set: (patch: Partial<Omit<PrefsState, 'set'>>) => void
  setCollapsed: (accountId: string, categoryId: string, collapsed: boolean) => void
  setSortMode: (accountId: string, categoryId: string, mode: SortMode) => void
  setLocalCategories: (accountId: string, cats: LocalCategory[]) => void
  setMeetingOverride: (accountId: string, token: string, meeting: boolean | null) => void
  rememberEmoji: (emoji: string) => void
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'denim',
      notificationsEnabled: true,
      notifySound: true,
      showArchived: false,
      sendOnCtrlEnter: false,
      collapsedThreads: true,
      hidePastMeetingsDays: 3,
      meetingOverrides: {},
      collapsed: {},
      sortMode: {},
      localCategories: {},
      recentEmojis: ['👍', '✅', '😂', '❤️', '🎉', '👀'],
      microphoneId: null,
      speakerId: null,
      cameraId: null,
      backgroundBlur: false,
      ringForCalls: true,
      convertEmoticons: true,
      callLayout: 'grid',
      rhsWidth: null,
      lastAccountId: null,
      lastRooms: {},

      set: (patch) => set(patch),
      setCollapsed: (accountId, categoryId, collapsed) =>
        set((s) => ({
          collapsed: { ...s.collapsed, [accountId]: { ...s.collapsed[accountId], [categoryId]: collapsed } }
        })),
      setSortMode: (accountId, categoryId, mode) =>
        set((s) => ({
          sortMode: { ...s.sortMode, [accountId]: { ...s.sortMode[accountId], [categoryId]: mode } }
        })),
      setLocalCategories: (accountId, cats) =>
        set((s) => ({ localCategories: { ...s.localCategories, [accountId]: cats } })),
      setMeetingOverride: (accountId, token, meeting) =>
        set((s) => {
          const next = { ...s.meetingOverrides[accountId] }
          if (meeting === null) delete next[token]
          else next[token] = meeting
          return { meetingOverrides: { ...s.meetingOverrides, [accountId]: next } }
        }),
      rememberEmoji: (emoji) =>
        set((s) => ({ recentEmojis: [emoji, ...s.recentEmojis.filter((e) => e !== emoji)].slice(0, 6) }))
    }),
    { name: 'hubbub-prefs', version: 1 }
  )
)
