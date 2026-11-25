import { useEffect, useState } from 'react'

// A log of what the checks for invitations from mail did, kept for an hour on this computer, for
// finding out why an invitation didn't show up. Shown under "Show debug" in Settings → Calendar.

export interface MailDebugEntry {
  at: number
  accountId: string
  level: 'info' | 'error'
  text: string
}

const KEY = 'hubbub.mailDebug'
const KEEP = 60 * 60_000
const MAX = 2000

let entries: MailDebugEntry[] | null = null
const listeners = new Set<() => void>()

function all(): MailDebugEntry[] {
  if (!entries) {
    try {
      entries = JSON.parse(localStorage.getItem(KEY) ?? '[]') as MailDebugEntry[]
    } catch {
      entries = []
    }
  }
  const since = Date.now() - KEEP
  if (entries.length && entries[0].at < since) entries = entries.filter((e) => e.at >= since)
  return entries
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries ?? []))
  } catch {
    // Kept until Hubbub quits, then
  }
  for (const l of listeners) l()
}

export function logMailDebug(accountId: string, level: MailDebugEntry['level'], text: string): void {
  entries = [...all(), { at: Date.now(), accountId, level, text }].slice(-MAX)
  save()
}

export function clearMailDebug(accountId: string): void {
  entries = all().filter((e) => e.accountId !== accountId)
  save()
}

/** The last hour's entries for a server, newest first */
export function useMailDebug(accountId: string): MailDebugEntry[] {
  const [list, setList] = useState(() =>
    all()
      .filter((e) => e.accountId === accountId)
      .reverse()
  )
  useEffect(() => {
    const update = (): void =>
      setList(
        all()
          .filter((e) => e.accountId === accountId)
          .reverse()
      )
    update()
    listeners.add(update)
    // Entries older than an hour drop off even without new ones
    const t = setInterval(update, 60_000)
    return () => {
      listeners.delete(update)
      clearInterval(t)
    }
  }, [accountId])
  return list
}

/** The entries as text, for pasting into a bug report */
export function mailDebugText(list: MailDebugEntry[]): string {
  return [...list]
    .reverse()
    .map((e) => `${new Date(e.at).toLocaleTimeString()} ${e.level === 'error' ? 'ERROR ' : ''}${e.text}`)
    .join('\n')
}
