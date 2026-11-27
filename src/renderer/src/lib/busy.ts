import type { CalendarEvent } from './caldav'
import { utcStamp } from './caldav'

// Busy time from a private calendar, copied into a Nextcloud calendar so colleagues booking a
// meeting see you're busy, without seeing what it is: the copies have the source's times and a title
// such as "Busy", nothing else, and no invitees (so nobody is ever sent anything). Each copy's UID
// comes from the occurrence it copies, so running again, or on another computer, finds the same
// copies instead of making new ones.

const PREFIX = 'hubbub-busy-'

export interface BusyBlock {
  uid: string
  start: number
  end: number
  allDay: boolean
}

/** A copy that's in the Nextcloud calendar */
export interface StoredBlock extends BusyBlock {
  href: string
}

/** The UID prefix of a source's copies */
export const busyPrefix = (sourceId: string): string => `${PREFIX}${sourceId}-`

/** Whether an event is a busy copy Hubbub made, and from which source */
export function busySourceOf(uid: string): string | null {
  return uid.startsWith(PREFIX) ? (uid.slice(PREFIX.length).split('-')[0] ?? null) : null
}

/** A short, stable hash (two FNV-1a variants) */
function hash(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

/** The copies a source's events call for: not free, not cancelled, and all-day ones only if wanted */
export function wantedBlocks(sourceId: string, events: CalendarEvent[], allDay: boolean): BusyBlock[] {
  const blocks = new Map<string, BusyBlock>()
  for (const e of events) {
    if (e.free || e.status === 'CANCELLED' || e.myAnswer === 'DECLINED') continue
    if (e.allDay && !allDay) continue
    if (e.end <= e.start) continue
    const uid = `${busyPrefix(sourceId)}${hash(`${e.calendarHref}|${e.uid}|${e.recurrenceId ?? ''}`)}`
    blocks.set(uid, { uid, start: e.start, end: e.end, allDay: e.allDay })
  }
  return [...blocks.values()]
}

export interface BusyPlan {
  create: BusyBlock[]
  update: { block: BusyBlock; href: string }[]
  remove: StoredBlock[]
}

/** What to change in the Nextcloud calendar so its copies match the wanted ones */
export function planBusy(wanted: BusyBlock[], stored: StoredBlock[]): BusyPlan {
  const byUid = new Map(stored.map((s) => [s.uid, s]))
  const plan: BusyPlan = { create: [], update: [], remove: [] }
  for (const block of wanted) {
    const have = byUid.get(block.uid)
    byUid.delete(block.uid)
    if (!have) plan.create.push(block)
    else if (have.start !== block.start || have.end !== block.end || have.allDay !== block.allDay)
      plan.update.push({ block, href: have.href })
  }
  plan.remove = [...byUid.values()]
  return plan
}

const pad = (n: number): string => String(n).padStart(2, '0')
const dateStamp = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}
const escape = (s: string): string => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n')

/** A copy as an iCalendar object */
export function busyIcs(block: BusyBlock, title: string): string {
  const times = block.allDay
    ? [`DTSTART;VALUE=DATE:${dateStamp(block.start)}`, `DTEND;VALUE=DATE:${dateStamp(block.end)}`]
    : [`DTSTART:${utcStamp(block.start)}`, `DTEND:${utcStamp(block.end)}`]
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hubbub//Busy time//EN',
    'BEGIN:VEVENT',
    `UID:${block.uid}`,
    `DTSTAMP:${utcStamp(Date.now())}`,
    ...times,
    `SUMMARY:${escape(title)}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n')
}
