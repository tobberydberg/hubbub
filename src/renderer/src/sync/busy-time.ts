import type { CalendarSourceConfig } from '@shared/ipc'
import {
  busyIcs,
  busyPrefix,
  planBusy,
  wantedBlocks,
  type BusyBlock,
  type StoredBlock
} from '@renderer/lib/busy'
import { parseEvents, utcStamp } from '@renderer/lib/caldav'
import { addDays, startOfDay } from '@renderer/lib/calendar-time'
import { useCalendar } from '@renderer/store/calendar'
import { setSourceStatus } from '@renderer/store/external'
import { sourceEvents } from './external'

// Busy time from a calendar from elsewhere, copied into one of your Nextcloud calendars as events
// with only a title such as "Busy" (see lib/busy.ts): from today and the coming weeks, kept in step
// whenever the source is fetched. Colleagues see you're busy, in their scheduling and in shared
// calendars, but not what it is.

/** How far ahead busy time is copied */
export const BUSY_DAYS = 60
/** Copies are removed over this span when busy time is turned off */
const CLEAR_PAST = 400
const CLEAR_FUTURE = 800

/** What was last written per source, so an unchanged calendar costs one REPORT an hour at most */
const done = new Map<string, { signature: string; at: number }>()

async function storedBlocks(
  accountId: string,
  calendarHref: string,
  sourceId: string,
  from: number,
  to: number
): Promise<(StoredBlock & { title: string })[]> {
  const xml = await window.hubbub.calendarEvents(accountId, calendarHref, utcStamp(from), utcStamp(to))
  const prefix = busyPrefix(sourceId)
  return parseEvents(xml, { calendarHref, serverUrl: '', myEmails: [] })
    .filter((e) => e.uid.startsWith(prefix))
    .map((e) => ({ uid: e.uid, href: e.href, start: e.start, end: e.end, allDay: e.allDay, title: e.title }))
}

const put = async (accountId: string, href: string, ics: string, etag: string | null): Promise<number> =>
  (await window.hubbub.calendarObject(accountId, { method: 'PUT', href, body: ics, etag })).status

/** Brings a source's busy copies in its Nextcloud calendar up to date */
export async function syncBusy(source: CalendarSourceConfig): Promise<void> {
  const busy = source.busy
  if (!busy) return
  const target = useCalendar
    .getState()
    .accounts[source.accountId]?.calendars?.find((c) => c.href === busy.calendarHref)
  if (!target?.writable) {
    // The list may not be loaded yet; an error only when it is and the calendar isn't in it
    if (useCalendar.getState().accounts[source.accountId]?.calendars) {
      setSourceStatus(source.id, {
        busy: { at: Date.now(), count: 0, error: 'The Nextcloud calendar for busy time isn’t available' }
      })
    }
    return
  }
  const from = startOfDay(Date.now())
  const to = addDays(from, BUSY_DAYS)
  const wanted = wantedBlocks(source.id, sourceEvents(source.id, from, to), busy.allDay)
  const signature = JSON.stringify([busy, wanted.map((b) => [b.uid, b.start, b.end])])
  const last = done.get(source.id)
  if (last && last.signature === signature && Date.now() - last.at < 3_600_000) return
  try {
    const stored = await storedBlocks(source.accountId, busy.calendarHref, source.id, from, to)
    const plan = planBusy(wanted, stored)
    const retitled = stored.filter(
      (s) => s.title !== busy.title && !plan.update.some((u) => u.href === s.href) && !plan.remove.includes(s)
    )
    const folder = busy.calendarHref.replace(/\/?$/, '/')
    const write = async (block: BusyBlock, href: string | null): Promise<void> => {
      const ics = busyIcs(block, busy.title)
      if (!href) {
        const status = await put(source.accountId, `${folder}${block.uid}.ics`, ics, null)
        // 412: already there (made from another computer meanwhile)
        if (status >= 300 && status !== 412) throw new Error(`HTTP ${status} adding busy time`)
        return
      }
      const now = await window.hubbub.calendarObject(source.accountId, { method: 'GET', href })
      if (now.status !== 200) return
      const status = await put(source.accountId, href, ics, now.etag)
      if (status >= 300 && status !== 412) throw new Error(`HTTP ${status} changing busy time`)
    }
    for (const block of plan.create) await write(block, null)
    for (const { block, href } of plan.update) await write(block, href)
    for (const s of retitled) await write(s, s.href)
    for (const s of plan.remove) {
      await window.hubbub.calendarObject(source.accountId, { method: 'DELETE', href: s.href })
    }
    done.set(source.id, { signature, at: Date.now() })
    setSourceStatus(source.id, { busy: { at: Date.now(), count: wanted.length } })
  } catch (err) {
    setSourceStatus(source.id, {
      busy: { at: Date.now(), count: wanted.length, error: err instanceof Error ? err.message : String(err) }
    })
  }
}

/** Removes every busy copy a source made in a Nextcloud calendar */
export async function clearBusy(accountId: string, calendarHref: string, sourceId: string): Promise<void> {
  done.delete(sourceId)
  const today = startOfDay(Date.now())
  const stored = await storedBlocks(
    accountId,
    calendarHref,
    sourceId,
    addDays(today, -CLEAR_PAST),
    addDays(today, CLEAR_FUTURE)
  )
  for (const s of stored) {
    const res = await window.hubbub.calendarObject(accountId, { method: 'DELETE', href: s.href })
    if (res.status >= 300 && res.status !== 404) throw new Error(`HTTP ${res.status} removing busy time`)
  }
}
