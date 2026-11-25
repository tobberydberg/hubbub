import { talk, TalkError } from '@renderer/api/talk'
import {
  cancellationOf,
  cancelledInvitation,
  includesMe,
  myAnswerIn,
  revives,
  scheduledByClient,
  withMe,
  invitationFileName,
  parseMailInvitation,
  sequenceOf,
  updatedInvitation,
  type MailInvitation
} from '@renderer/lib/invitations'
import { showToast, useApp } from '@renderer/store/app'
import { useCalendar } from '@renderer/store/calendar'
import { usePrefs } from '@renderer/store/prefs'
import { myAddresses, refreshCalendars } from './calendar'
import { logMailDebug } from './mail-debug'

// Invitations that arrive by mail (from Microsoft Teams, Outlook, Google, …) in the calendar.
//
// They're read from Nextcloud Mail (which recognises invitations and hands out their calendar part)
// or straight from a mail server over IMAP (see main/imap.ts); either way the mails stay unread.
// Hubbub puts each one into the calendar chosen as default (once: an event with the same UID
// anywhere in the user's calendars is updated instead), takes the organizer's updates and
// cancellations, and leaves meetings that are over alone. The user then answers in the calendar,
// and Nextcloud mails the answer to the organizer.

const POLL = 5 * 60_000
/** How far back the inbox is looked through */
const LOOK_BACK = 30 * 86_400_000
/** Messages per request, and at most this many requests per inbox and scan */
const PAGE = 100
const PAGES = 10
/** How many handled message ids are remembered per account (from a mail server: every message looked at) */
const REMEMBER = 3000

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

/** Where this server's invitations come from */
export function sourceOf(accountId: string): 'nextcloud' | 'imap' {
  return usePrefs.getState().mailInvitationSource[accountId] ?? 'nextcloud'
}

export function setMailInvitationSource(accountId: string, source: 'nextcloud' | 'imap'): void {
  const prefs = usePrefs.getState()
  prefs.set({ mailInvitationSource: { ...prefs.mailInvitationSource, [accountId]: source } })
}

function noteCheck(accountId: string, result: { error?: string; added?: number; changed?: number }): void {
  const prefs = usePrefs.getState()
  prefs.set({
    mailInvitationCheck: { ...prefs.mailInvitationCheck, [accountId]: { at: Date.now(), ...result } }
  })
}

/** Forgets which mails were handled, so the next check looks at all of the last 30 days again */
export function forgetHandledMail(accountId: string): void {
  const prefs = usePrefs.getState()
  const seen = { ...prefs.mailInvitesSeen }
  delete seen[accountId]
  prefs.set({ mailInvitesSeen: seen })
  logMailDebug(
    accountId,
    'info',
    'Forgot which mails were handled: the next check looks at all of them again'
  )
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

type Result = 'added' | 'updated' | 'cancelled' | null

/** What happened to an invitation, and why, for the summary and the debug log */
interface Outcome {
  result: Result
  note: string
}

/** A calendar that didn't take a change: the reason in words, with the request for the debug log */
class CalendarRefused extends Error {
  constructor(
    readonly status: number,
    readonly request: string
  ) {
    super(failure(status))
  }
}

const nameOf = (href: string): string =>
  decodeURIComponent(href.replace(/\/+$/, '').split('/').slice(-2).join('/'))

/** Puts one invitation into the calendar; resolves with what happened */
/** You in an invitation: your addresses, and the one to add you with when it doesn't list you */
interface Me {
  email: string
  name: string
  emails: string[]
}

/** The address the mail reached you at when your calendar knows it, else your main address */
function meFor(accountId: string, recipients: string[]): Me | null {
  const emails = myAddresses(accountId)
  const a = useApp.getState().accounts[accountId]
  const email = recipients.map((r) => r.toLowerCase()).find((r) => emails.includes(r)) ?? emails[0]
  if (!email) return null
  return { email, name: a?.user?.displayname ?? a?.info.displayName ?? '', emails }
}

async function apply(accountId: string, inv: MailInvitation, recipients: string[]): Promise<Outcome> {
  const me = meFor(accountId, recipients)
  if (!me) return { result: null, note: 'your account has no email address' }
  const stored = await findStored(accountId, inv.uid)
  if (inv.method === 'CANCEL') {
    if (!stored) return { result: null, note: 'cancelled, but not in your calendar' }
    const res = await window.hubbub.calendarObject(accountId, { method: 'GET', href: stored.href })
    if (res.status !== 200)
      return { result: null, note: `cancelled; reading ${nameOf(stored.href)} gave HTTP ${res.status}` }
    if (cancellationOf(res.body).cancelled) return { result: null, note: 'already marked cancelled' }
    const have = sequenceOf(res.body)
    // A cancellation older than the meeting in the calendar was overtaken by a newer invitation
    if (inv.sequence < have) {
      return {
        result: null,
        note: `older than the meeting in ${nameOf(stored.href)} (cancellation version ${inv.sequence}, meeting version ${have}): left as it is`
      }
    }
    await save(accountId, stored.href, cancelledInvitation(res.body, inv.sequence), res.etag)
    return { result: 'cancelled', note: `marked cancelled in ${nameOf(stored.href)}` }
  }
  if (stored) return update(accountId, stored.href, inv, me)
  if (inv.end < Date.now())
    return { result: null, note: `over (ended ${new Date(inv.end).toLocaleString()})` }
  const calendar = targetCalendar(accountId)
  if (!calendar) return { result: null, note: 'no calendar to add it to' }
  const folder = calendar.replace(/\/?$/, '/')
  const href = `${folder}${invitationFileName(inv.uid)}`
  // Forwarded to you, or sent to an address your calendar doesn't know: you're added, unanswered
  const ics = withMe(inv.ics, me, me.emails)
  const added = ics !== inv.ics ? `; you were added to the invitees as ${me.email}` : ''
  const status = await saveQuietly(accountId, href, ics, null)
  if (status === 412) {
    // The name is taken: by this meeting (kept where the search didn't find it), or by something else
    const there = await window.hubbub.calendarObject(accountId, { method: 'GET', href })
    if (there.status === 200 && uidOf(there.body) === inv.uid) return update(accountId, href, inv, me)
    const other = `${folder}hubbub-${crypto.randomUUID()}.ics`
    await save(accountId, other, ics, null)
    return {
      result: 'added',
      note: `added to ${nameOf(other)} (its own name was taken by another event)${added}`
    }
  }
  if (status < 200 || status >= 300) throw new CalendarRefused(status, `PUT ${nameOf(href)} (new)`)
  return { result: 'added', note: `added to ${nameOf(href)}${added}` }
}

/** The organizer's newer version of a stored event, keeping the user's answer */
async function update(accountId: string, href: string, inv: MailInvitation, me: Me): Promise<Outcome> {
  const res = await window.hubbub.calendarObject(accountId, { method: 'GET', href })
  if (res.status !== 200)
    return { result: null, note: `in ${nameOf(href)}, but reading it gave HTTP ${res.status}` }
  const have = sequenceOf(res.body)
  const revive = revives(res.body, inv.sequence)
  const newer = inv.sequence > have || revive
  const missing = !includesMe(res.body, me.emails)
  if (!newer && !missing) {
    const cancelled = cancellationOf(res.body).cancelled ? ', marked cancelled' : ''
    return {
      result: null,
      note: `already in ${nameOf(href)} and up to date (version ${have}${cancelled}, this mail ${inv.sequence})`
    }
  }
  const merged = newer ? updatedInvitation(res.body, inv.ics, me.emails) : res.body
  // Forwarded to you: you stay among the invitees with your answer
  const next = withMe(merged, me, me.emails, myAnswerIn(res.body, me.emails))
  await save(accountId, href, next, res.etag)
  const added =
    missing || !includesMe(merged, me.emails) ? `; you were added to the invitees as ${me.email}` : ''
  return {
    result: newer ? 'updated' : null,
    note: revive
      ? `brought back in ${nameOf(href)}: it was marked cancelled, this invitation is as new or newer (version ${inv.sequence})${added}`
      : newer
        ? `updated in ${nameOf(href)} (version ${have} → ${inv.sequence})${added}`
        : `in ${nameOf(href)}, up to date${added}`
  }
}

/** Why the calendar didn't take an event, in words */
function failure(status: number): string {
  if (status === 403) return 'you may not add events to the default calendar'
  if (status === 412) return 'the event was changed elsewhere at the same time'
  if (status === 507) return 'the calendar is full (no storage left)'
  if (status === 400 || status === 409) return `the calendar refused the event (HTTP ${status})`
  return `HTTP ${status}`
}

/**
 * Saves an invitation from mail without Nextcloud answering the organizer on the user's behalf.
 * Saved as it is, Nextcloud sees the user's "needs action" as an answer and mails it to the organizer
 * (Outlook shows it as accepted). So it's saved with the organizer marked as scheduling the meeting
 * (SCHEDULE-AGENT=CLIENT), which makes Nextcloud send nothing, and then once more without the mark:
 * the answer hasn't changed then, so again nothing is sent, and later answers reach the organizer.
 * Resolves with the status of the first save.
 */
async function saveQuietly(
  accountId: string,
  href: string,
  ics: string,
  etag: string | null
): Promise<number> {
  const res = await window.hubbub.calendarObject(accountId, {
    method: 'PUT',
    href,
    body: scheduledByClient(ics, true),
    etag
  })
  if (res.status < 200 || res.status >= 300) return res.status
  const now = await window.hubbub.calendarObject(accountId, { method: 'GET', href })
  if (now.status === 200) {
    // Left marked if this fails: answering in Hubbub takes the mark off
    await window.hubbub.calendarObject(accountId, {
      method: 'PUT',
      href,
      body: scheduledByClient(now.body, false),
      etag: now.etag
    })
  }
  return res.status
}

async function save(accountId: string, href: string, ics: string, etag: string | null): Promise<void> {
  const status = await saveQuietly(accountId, href, ics, etag)
  if (status < 200 || status >= 300) {
    throw new CalendarRefused(status, `PUT ${nameOf(href)} ${etag ? `If-Match ${etag}` : '(new)'}`)
  }
}

const uidOf = (ics: string): string | undefined =>
  /^UID:(.*(?:\r?\n[ \t].*)*)/m
    .exec(ics)?.[1]
    .replace(/\r?\n[ \t]/g, '')
    .trim()

/**
 * A page of an inbox's messages. Mail answers 412 while it hasn't copied the mailbox yet: then it
 * is asked to, and asked again once.
 */
async function mailMessages(
  accountId: string,
  mailboxId: number,
  opts: { limit: number; since: number; cursor?: number }
): ReturnType<ReturnType<typeof talk>['mailMessages']> {
  const api = talk(accountId)
  try {
    return await api.mailMessages(mailboxId, opts)
  } catch (err) {
    if (!(err instanceof TalkError && err.status === 412)) throw err
    await api.mailSync(mailboxId, true)
    try {
      return await api.mailMessages(mailboxId, opts)
    } catch (again) {
      if (again instanceof TalkError && again.status === 412) {
        throw new Error(
          'Nextcloud Mail is still copying your inbox from the mail server; try again in a few minutes'
        )
      }
      throw again
    }
  }
}

/** The newest messages of the Nextcloud Mail inboxes, through Mail's web API */
async function scanNextcloudMail(
  accountId: string,
  done: Set<number | string>,
  handled: (number | string)[],
  take: (
    parts: { method: string; contents: string }[],
    mail: string,
    recipients: string[]
  ) => Promise<boolean>
): Promise<void> {
  const api = talk(accountId)
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
    let listed = 0
    let invitations = 0
    const fresh: {
      databaseId: number
      subject?: string
      dateInt?: number
      to?: { email?: string }[]
      cc?: { email?: string }[]
    }[] = []
    for (let page = 0; page < PAGES; page++) {
      const messages = await mailMessages(accountId, inbox.databaseId, { limit: PAGE, since, cursor })
      listed += messages.length
      for (const msg of messages) {
        if (msg.imipMessage) invitations++
        if (msg.imipMessage && !done.has(msg.databaseId)) fresh.push(msg)
      }
      cursor = messages[messages.length - 1]?.dateInt
      if (messages.length < PAGE || cursor === undefined) break
    }
    logMailDebug(
      accountId,
      'info',
      `Nextcloud Mail ${account.emailAddress}: ${listed} messages in the inbox from the last ${LOOK_BACK / 86_400_000} days, ${invitations} with invitations, ${fresh.length} not handled before`
    )
    // Oldest first, so that a later update or cancellation has the last word
    fresh.sort((a, b) => (a.dateInt ?? 0) - (b.dateInt ?? 0) || a.databaseId - b.databaseId)
    for (const msg of fresh) {
      const { scheduling = [] } = await api.mailScheduling(msg.databaseId)
      const mail = `mail “${msg.subject ?? '(no subject)'}” (Nextcloud Mail #${msg.databaseId})`
      const to = [...(msg.to ?? []), ...(msg.cc ?? [])].map((r) => r.email ?? '').filter(Boolean)
      if (await take(scheduling, mail, to)) handled.push(msg.databaseId)
    }
  }
}

const scanning = new Map<string, Promise<void>>()

/** Looks through the last 30 days of the inbox for invitations not handled yet. */
/** Looks for invitations now; a check already running is waited for instead of starting another */
export function scanMail(accountId: string): Promise<void> {
  const running = scanning.get(accountId)
  if (running) return running
  const scan = runScan(accountId).finally(() => scanning.delete(accountId))
  scanning.set(accountId, scan)
  return scan
}

async function runScan(accountId: string): Promise<void> {
  const log = (level: 'info' | 'error', text: string): void => logMailDebug(accountId, level, text)
  const added: string[] = []
  let updated = 0
  let changed = false
  try {
    // Finding events that are already there needs the calendar list
    if (!useCalendar.getState().accounts[accountId]?.calendars) await refreshCalendars(accountId)
    const calendars = useCalendar.getState().accounts[accountId]?.calendars
    if (!calendars) {
      log('error', 'Check skipped: the calendars couldn’t be loaded')
      return
    }
    const target = calendars.find((c) => c.href === targetCalendar(accountId))
    log(
      'info',
      `Check started (${sourceOf(accountId) === 'imap' ? 'mail server' : 'Nextcloud Mail'}); new invitations go to ${target ? `“${target.name}”` : 'no calendar'}, ${calendars.length} calendars searched for existing ones`
    )
    const done = new Set<number | string>(usePrefs.getState().mailInvitesSeen[accountId] ?? [])
    const handled: (number | string)[] = []
    const failed: string[] = []
    /** Handles a message's invitations; false when one failed (the message is tried again next time) */
    const take = async (
      parts: { method: string; contents: string }[],
      mail: string,
      recipients: string[]
    ): Promise<boolean> => {
      let ok = true
      if (!parts.length) log('info', `${mail}: no calendar part`)
      for (const part of parts) {
        const inv = parseMailInvitation(part.contents, part.method)
        if (!inv) {
          log('info', `${mail}: ${part.method || 'no method'}, not an invitation Hubbub handles`)
          continue
        }
        const what = `“${inv.title}” (${inv.method}, version ${inv.sequence}, ${inv.start ? new Date(inv.start).toLocaleString() : 'no start'}${inv.organizer ? `, from ${inv.organizer}` : ''}, UID ${inv.uid.slice(0, 24)}${inv.uid.length > 24 ? '…' : ''}) in ${mail}`
        try {
          const { result, note } = await apply(accountId, inv, recipients)
          if (result) changed = true
          if (result === 'updated' || result === 'cancelled') updated++
          if (result === 'added') added.push(inv.title)
          log('info', `${what}: ${note}`)
        } catch (err) {
          ok = false
          const reason = err instanceof Error ? err.message : String(err)
          failed.push(`“${inv.title}”: ${reason}`)
          log(
            'error',
            `${what}: ${reason}${err instanceof CalendarRefused ? ` [${err.request} → HTTP ${err.status}]` : ''}; tried again next time`
          )
        }
      }
      return ok
    }
    if (sourceOf(accountId) === 'imap') {
      // Straight from the mail server: messages already looked at are left out there
      const skip = [...done].filter((d): d is string => typeof d === 'string' && d.startsWith('imap:'))
      const messages = await window.hubbub.imap.invitations(accountId, {
        sinceDays: LOOK_BACK / 86_400_000,
        skip: skip.map((d) => d.slice(5))
      })
      const withParts = messages.filter((m) => m.parts.length)
      log(
        'info',
        `Mail server: ${messages.length} messages from the last ${LOOK_BACK / 86_400_000} days not looked at before, ${withParts.length} with calendar parts`
      )
      for (const m of messages) {
        const mail = `mail “${m.subject ?? '(no subject)'}”${m.date ? ` of ${new Date(m.date).toLocaleString()}` : ''}`
        if (!m.parts.length) {
          handled.push(`imap:${m.id}`)
          continue
        }
        if (
          await take(
            m.parts.map((p) => ({ method: p.method, contents: p.ics })),
            mail,
            m.to ?? []
          )
        )
          handled.push(`imap:${m.id}`)
      }
    } else {
      await scanNextcloudMail(accountId, done, handled, take)
    }
    if (handled.length) {
      const prefs = usePrefs.getState()
      const all = [...(prefs.mailInvitesSeen[accountId] ?? []), ...handled].slice(-REMEMBER)
      prefs.set({ mailInvitesSeen: { ...prefs.mailInvitesSeen, [accountId]: all } })
    }
    log(
      failed.length ? 'error' : 'info',
      `Check done: ${added.length} added, ${updated} updated, ${failed.length} failed, ${handled.length} messages done`
    )
    noteCheck(accountId, {
      added: added.length,
      changed: updated,
      error: failed.length
        ? `${failed.length === 1 ? 'An invitation' : `${failed.length} invitations`} couldn’t be added. ${failed[0]}`
        : undefined
    })
  } catch (err) {
    // Mail unreachable for now: the next scan tries again, nothing was marked as handled
    console.warn('Invitations from mail:', err)
    log('error', `Check failed: ${err instanceof Error ? err.message : String(err)}`)
    noteCheck(accountId, {
      error:
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(err)
    })
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
