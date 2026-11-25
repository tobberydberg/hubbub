import { talk, TalkError, type CurrentAbsence, type OutOfOffice } from '@renderer/api/talk'
import { setApp, showToast, useApp } from '@renderer/store/app'

// Out of office (Nextcloud 28+): your absence with a message and someone to contact instead, which
// Nextcloud shows to people who message you; and other people's, on their card and in your direct
// messages with them.

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function setOwn(accountId: string, absence: OutOfOffice | null, supported = true): void {
  setApp((s) => {
    const a = s.accounts[accountId]
    if (!a) return
    a.ownAbsence = absence
    a.absenceSupported = supported
  })
}

/** Loads your own out-of-office settings (and whether the server has them) */
export async function loadOwnAbsence(accountId: string): Promise<void> {
  const a = useApp.getState().accounts[accountId]
  if (!a) return
  const api = talk(accountId)
  try {
    if (a.absenceSupported === undefined && !(await api.supportsAbsence())) {
      setOwn(accountId, null, false)
      return
    }
    setOwn(accountId, await api.outOfOffice(a.info.userId))
  } catch (err) {
    if (err instanceof TalkError && err.status === 404) setOwn(accountId, null)
  }
}

export async function saveOwnAbsence(accountId: string, data: OutOfOffice): Promise<boolean> {
  const a = useApp.getState().accounts[accountId]
  if (!a) return false
  try {
    setOwn(accountId, await talk(accountId).setOutOfOffice(a.info.userId, data))
    forget(accountId, a.info.userId)
    showToast('Out of office is set')
    return true
  } catch (err) {
    showToast(`Out of office couldn’t be set: ${errorText(err)}`, 'error')
    return false
  }
}

export async function clearOwnAbsence(accountId: string): Promise<boolean> {
  const a = useApp.getState().accounts[accountId]
  if (!a) return false
  try {
    await talk(accountId).clearOutOfOffice(a.info.userId)
    setOwn(accountId, null)
    forget(accountId, a.info.userId)
    showToast('Out of office is off')
    return true
  } catch (err) {
    showToast(`Out of office couldn’t be turned off: ${errorText(err)}`, 'error')
    return false
  }
}

/** Whether your absence covers today (yyyy-mm-dd days, both included) */
export function absentToday(absence: OutOfOffice | null | undefined, now = new Date()): boolean {
  if (!absence) return false
  const pad = (n: number): string => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return absence.firstDay <= today && today <= absence.lastDay
}

const current = new Map<string, { at: number; absence: Promise<CurrentAbsence | null> }>()

function forget(accountId: string, userId: string): void {
  current.delete(`${accountId}/${userId}`)
}

/** Someone's absence right now, or null; kept for ten minutes */
export function absenceOf(accountId: string, userId: string): Promise<CurrentAbsence | null> {
  const key = `${accountId}/${userId}`
  const cached = current.get(key)
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.absence
  const absence =
    useApp.getState().accounts[accountId]?.absenceSupported === false
      ? Promise.resolve(null)
      : talk(accountId)
          .currentAbsence(userId)
          .catch(() => null)
  current.set(key, { at: Date.now(), absence })
  return absence
}

/** "until Wed 3 Dec" for an absence's end (unix seconds; the last second of the last day) */
export function absenceUntil(endDate: number): string {
  const d = new Date(endDate * 1000)
  return `until ${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`
}
