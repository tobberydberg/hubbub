import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_SEEN = 1000

interface ThreadPrefsState {
  /** Explicit follow/unfollow choices for reply chains: follows[accountId][threadKey] */
  follows: Record<string, Record<string, boolean>>
  /** Newest reply id the user has seen per thread: seen[accountId][threadKey] */
  seen: Record<string, Record<string, number>>
  /** Replies with an id at or below this were already there when thread tracking started */
  baseline: Record<string, number>

  setFollow: (accountId: string, key: string, follow: boolean | null) => void
  markSeen: (accountId: string, key: string, replyId: number) => void
  initBaseline: (accountId: string, messageId: number) => void
}

export const useThreadPrefs = create<ThreadPrefsState>()(
  persist(
    (set) => ({
      follows: {},
      seen: {},
      baseline: {},

      setFollow: (accountId, key, follow) =>
        set((s) => {
          const next = { ...s.follows[accountId] }
          if (follow === null) delete next[key]
          else next[key] = follow
          return { follows: { ...s.follows, [accountId]: next } }
        }),
      markSeen: (accountId, key, replyId) =>
        set((s) => {
          const cur = s.seen[accountId] ?? {}
          if ((cur[key] ?? 0) >= replyId) return s
          let entries = Object.entries({ ...cur, [key]: replyId })
          if (entries.length > MAX_SEEN) entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN)
          return { seen: { ...s.seen, [accountId]: Object.fromEntries(entries) } }
        }),
      initBaseline: (accountId, messageId) =>
        set((s) =>
          s.baseline[accountId] !== undefined ? s : { baseline: { ...s.baseline, [accountId]: messageId } }
        )
    }),
    { name: 'hubbub-threads', version: 1 }
  )
)
