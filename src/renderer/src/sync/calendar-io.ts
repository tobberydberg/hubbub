import type { CalendarInfo } from '@renderer/lib/caldav'
import { invitationFileName } from '@renderer/lib/invitations'
import type { ImportItem } from '@renderer/lib/ics-import'
import { showToast } from '@renderer/store/app'
import { refreshCalendars } from './calendar'
import { saveQuietly } from './mail-invitations'

// Exporting a calendar to an .ics file, and importing the events of one into a calendar.

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export async function exportCalendar(accountId: string, calendar: CalendarInfo): Promise<void> {
  try {
    const path = await window.hubbub.exportCalendar(accountId, calendar.href, calendar.name)
    if (path) showToast(`${calendar.name} saved to ${path}`)
  } catch (err) {
    showToast(`${calendar.name} couldn’t be exported: ${errorText(err)}`, 'error')
  }
}

export interface ImportResult {
  added: number
  /** Already in the calendar (same UID): left as they are */
  skipped: number
  failed: { title: string; error: string }[]
}

/**
 * Adds the events to a calendar. Events already in it are left alone. Nothing is sent to anyone:
 * Nextcloud would otherwise mail invitations for imported meetings you organize (see saveQuietly).
 */
export async function importEvents(
  accountId: string,
  calendarHref: string,
  items: ImportItem[],
  onProgress?: (done: number) => void
): Promise<ImportResult> {
  const result: ImportResult = { added: 0, skipped: 0, failed: [] }
  const folder = calendarHref.replace(/\/?$/, '/')
  for (const [i, item] of items.entries()) {
    try {
      const existing = await window.hubbub
        .calendarFindByUid(accountId, calendarHref, item.uid)
        .catch(() => null)
      if (existing) {
        result.skipped++
      } else {
        let status = await saveQuietly(accountId, `${folder}${invitationFileName(item.uid)}`, item.ics, null)
        // The file name is taken by another event: under a name of its own
        if (status === 412) {
          status = await saveQuietly(accountId, `${folder}hubbub-${crypto.randomUUID()}.ics`, item.ics, null)
        }
        if (status >= 200 && status < 300) result.added++
        else result.failed.push({ title: item.title, error: `HTTP ${status}` })
      }
    } catch (err) {
      result.failed.push({ title: item.title, error: errorText(err) })
    }
    onProgress?.(i + 1)
  }
  void refreshCalendars(accountId, true)
  return result
}
