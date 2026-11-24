import { talk, TalkError } from '@renderer/api/talk'
import {
  cancelledInvitation,
  invitationFileName,
  parseMailInvitation,
  sequenceOf,
  updatedInvitation,
  type MailInvitation
} from '@renderer/lib/invitations'
import { showToast, useApp } from '@renderer/store/app'
import { useCalendar } from '@renderer/store/calendar'
import { usePrefs } from '@renderer/store/prefs'
import { refreshCalendars } from './calendar'

// Invitations that arrive by mail (from Microsoft Teams, Outlook, Google, …) in the calendar.
//
// Nextcloud Mail recognises invitations and hands out their calendar part; reading it doesn't
// mark the mail read. Hubbub puts each one into the calendar chosen as default (once: an event
// with the same UID anywhere in the user's calendars is updated instead), takes the organizer's
// updates and cancellations, and leaves meetings that are over alone. The user then answers in
// the calendar, and Nextcloud mails the answer to the organizer.

const POLL = 5 * 60_000
/** How far back the inbox is looked through */
const LOOK_BACK = 30 * 86_400_000
/** Messages per request, and at most this many requests per inbox and scan */
const PAGE = 100
const PAGES = 10
/** How many handled message ids are remembered per account */
const REMEMBER = 500

export interface MailInvitationState {
  /** Whether this server has Nextcloud Mail with an account */
  available: boolean
  /** Why it isn't available */
  reason?: string
}

export async function mailInvitationState(accountId: string): Promise<MailInvitationState> {
  try {
    const accounts = await talk(accountId).mailAccounts()
    if (!accounts.length) return { available: false, reason: 'You have no account in Nextcloud Mail.' }
    return { available: true }
  } catch (err) {
    const missing = err instanceof TalkError && (err.status === 404 || err.status === 403)
    return {
      available: false,
      reason: missing
        ? 'Nextcloud Mail isn’t available on this server.'
        : 'Nextcloud Mail couldn’t be reached.'
    }
  }
}

export function setMailInvitations(accountId: string, on: boolean): void {
  const prefs = usePrefs.getState()
  prefs.set({ mailInvitations: { ...prefs.mailInvitations, [accountId]: on } })
  if (on) void scanMail(accountId)
}

/** The calendar invitations go into: the default for new events, else the user's first own one */
function targetCalendar(accountId: string): string | undefined {
  const calendars = useCalendar.getState().accounts[accountId]?.calendars ?? []
  const writable = calendars.filter((c) => c.writable)
  const chosen = usePrefs.getState().defaultCalendars[accountId]
  return (writable.find((c) => c.href === chosen) ?? writable.find((c) => !c.sharedBy) ?? writable[0])?.href
}

/** The stored event with this UID in any of the user's calendars */
async function findStored(
  accountId: string,
  uid: string
): Promise<{ href: string; etag: string | null } | null> {
  for (const c of useCalendar.getState().accounts[accountId]?.calendars ?? []) {
    const found = await window.hubbub.calendarFindByUid(accountId, c.href, uid).catch(() => null)
    if (found) return found
  }
  return null
}

/** Puts one invitation into the calendar; resolves with what happened, for the summary */
async function apply(
  accountId: string,
  inv: MailInvitation
): Promise<'added' | 'updated' | 'cancelled' | null> {
  const email = useApp.getState().accounts[accountId]?.user?.email
  const stored = await findStored(accountId, inv.uid)
  if (inv.method === 'CANCEL') {
    if (!stored) return null
    const res = await window.hubbub.calendarObject(accountId, { method: 'GET', href: stored.href })
    if (res.status !== 200 || /STATUS:CANCELLED/.test(res.body)) return null
    await put(accountId, stored.href, cancelledInvitation(res.body), res.etag)
    return 'cancelled'
  }
  if (stored) {
    const res = await window.hubbub.calendarObject(accountId, { method: 'GET', href: stored.href })
    if (res.status !== 200 || sequenceOf(res.body) >= inv.sequence) return null
    await put(accountId, stored.href, updatedInvitation(res.body, inv.ics, email ? [email] : []), res.etag)
    return 'updated'
  }
  if (inv.end < Date.now()) return null
  const calendar = targetCalendar(accountId)
  if (!calendar) return null
  await put(accountId, `${calendar.replace(/\/?$/, '/')}${invitationFileName(inv.uid)}`, inv.ics, null)
  return 'added'
}

async function put(accountId: string, href: string, ics: string, etag: string | null): Promise<void> {
  const res = await window.hubbub.calendarObject(accountId, { method: 'PUT', href, body: ics, etag })
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
}

const scanning = new Set<string>()

/** Looks through the last 30 days of the inbox for invitations not handled yet. */
export async function scanMail(accountId: string): Promise<void> {
  if (scanning.has(accountId)) return
  scanning.add(accountId)
  const added: string[] = []
  let changed = false
  try {
    const api = talk(accountId)
    // Finding events that are already there needs the calendar list
    if (!useCalendar.getState().accounts[accountId]?.calendars) await refreshCalendars(accountId)
    if (!useCalendar.getState().accounts[accountId]?.calendars) return
    const done = new Set(usePrefs.getState().mailInvitesSeen[accountId] ?? [])
    const handled: number[] = []
    for (const account of await api.mailAccounts()) {
      const { mailboxes } = await api.mailMailboxes(account.id)
      const inbox = mailboxes.find((m) => m.specialRole === 'inbox')
      if (!inbox) continue
      // Mail lists what it has copied from the mail server, which without its web page open may be
      // hours old: fetch what is new first
      const synced = await api.mailSync(inbox.databaseId)
      if (synced.status === 412) await api.mailSync(inbox.databaseId, true)
      const since = Math.floor((Date.now() - LOOK_BACK) / 1000)
      let cursor: number | undefined
      for (let page = 0; page < PAGES; page++) {
        const messages = await api.mailMessages(inbox.databaseId, { limit: PAGE, since, cursor })
        for (const msg of messages) {
          if (!msg.imipMessage || done.has(msg.databaseId)) continue
          const { scheduling = [] } = await api.mailScheduling(msg.databaseId)
          for (const part of scheduling) {
            const inv = parseMailInvitation(part.contents, part.method)
            if (!inv) continue
            const result = await apply(accountId, inv)
            if (result) changed = true
            if (result === 'added') added.push(inv.title)
          }
          handled.push(msg.databaseId)
        }
        cursor = messages[messages.length - 1]?.dateInt
        if (messages.length < PAGE || cursor === undefined) break
      }
    }
    if (handled.length) {
      const prefs = usePrefs.getState()
      const all = [...(prefs.mailInvitesSeen[accountId] ?? []), ...handled].slice(-REMEMBER)
      prefs.set({ mailInvitesSeen: { ...prefs.mailInvitesSeen, [accountId]: all } })
    }
  } catch (err) {
    // Mail unreachable for now: the next scan tries again, nothing was marked as handled
    console.warn('Invitations from mail:', err)
  } finally {
    scanning.delete(accountId)
  }
  if (added.length) {
    showToast(
      added.length === 1
        ? `Invitation added: ${added[0]}`
        : `${added.length} invitations added to your calendar`
    )
  }
  if (changed) void refreshCalendars(accountId, true)
}

let timer: ReturnType<typeof setInterval> | null = null

export function startMailInvitationSync(): void {
  if (timer) return
  const tick = (): void => {
    const s = useApp.getState()
    for (const [id, on] of Object.entries(usePrefs.getState().mailInvitations)) {
      if (on && s.accounts[id]?.status === 'online') void scanMail(id)
    }
  }
  timer = setInterval(tick, POLL)
  setTimeout(tick, 15_000)
}
