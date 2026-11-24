import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { CalendarEvent, CalendarInfo } from '@renderer/lib/caldav'
import { startOfDay } from '@renderer/lib/calendar-time'

// Calendars and events per server, as last fetched. The view (which date) is shared by all servers.

export interface EventSet {
  start: number
  end: number
  /** Events by calendar href */
  byCalendar: Record<string, CalendarEvent[]>
  /** Each calendar's change tag when its events were fetched */
  ctags: Record<string, string>
}

export interface AccountCalendars {
  calendars: CalendarInfo[] | null
  error?: string
  /** The range on screen */
  view: EventSet | null
  /** From now until tomorrow, for the next-meeting strip and reminders */
  upcoming: EventSet | null
  loading: boolean
}

interface CalendarStore {
  accounts: Record<string, AccountCalendars>
  /** The date the calendar shows */
  date: number
}

export const useCalendar = create<CalendarStore>()(
  immer(() => ({ accounts: {}, date: startOfDay(Date.now()) }) as CalendarStore)
)

export const emptyCalendars = (): AccountCalendars => ({
  calendars: null,
  view: null,
  upcoming: null,
  loading: false
})

export function updateCalendars(accountId: string, fn: (a: AccountCalendars) => void): void {
  useCalendar.setState((s) => {
    fn((s.accounts[accountId] ??= emptyCalendars()))
  })
}

/** All events of a set, in shown calendars only */
export function eventsOf(set: EventSet | null, hidden: string[] = []): CalendarEvent[] {
  if (!set) return []
  return Object.entries(set.byCalendar)
    .filter(([href]) => !hidden.includes(href))
    .flatMap(([, events]) => events)
}
