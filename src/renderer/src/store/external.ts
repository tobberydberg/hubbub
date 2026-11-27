import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { CalendarSourceConfig } from '@shared/ipc'

// Calendars from elsewhere (a link, iCloud, another CalDAV server): their settings as main keeps
// them (without the secret link or password), and how the last refresh went.

export interface SourceStatus {
  /** When it was last fetched successfully */
  checkedAt?: number
  error?: string
  /** Events in its calendars, for the settings */
  calendars?: number
  /** Busy time copied into Nextcloud */
  busy?: { at: number; count: number; error?: string }
}

interface ExternalStore {
  sources: CalendarSourceConfig[]
  status: Record<string, SourceStatus>
}

export const useExternal = create<ExternalStore>()(
  immer(() => ({ sources: [], status: {} }) as ExternalStore)
)

export function setSourceStatus(id: string, patch: Partial<SourceStatus>): void {
  useExternal.setState((s) => {
    s.status[id] = { ...s.status[id], ...patch }
  })
}
