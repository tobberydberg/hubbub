import { create } from 'zustand'

// Who is typing in which conversation, from Talk's typing signals. A signal that isn't repeated
// within 15 seconds expires, like in Talk on the web.

const EXPIRES = 15_000

interface Typer {
  name: string
  userId?: string
}

interface TypingStore {
  /** typing[accountId/token][signaling session id] */
  typing: Record<string, Record<string, Typer>>
}

export const useTyping = create<TypingStore>()(() => ({ typing: {} }))

const timers = new Map<string, ReturnType<typeof setTimeout>>()

export const typingKey = (accountId: string, token: string): string => `${accountId}/${token}`

export function setTyping(key: string, sessionId: string, typer: Typer | null): void {
  const timer = `${key}#${sessionId}`
  clearTimeout(timers.get(timer))
  timers.delete(timer)
  useTyping.setState((s) => {
    const room = { ...s.typing[key] }
    if (typer) room[sessionId] = typer
    else delete room[sessionId]
    return { typing: { ...s.typing, [key]: room } }
  })
  if (typer)
    timers.set(
      timer,
      setTimeout(() => setTyping(key, sessionId, null), EXPIRES)
    )
}

export function clearTyping(key: string): void {
  for (const sessionId of Object.keys(useTyping.getState().typing[key] ?? {})) setTyping(key, sessionId, null)
}

/** "Alice is typing…", "Alice and Bob are typing…", "Several people are typing…" */
export function typingText(names: string[]): string {
  if (!names.length) return ''
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing…`
  return 'Several people are typing…'
}
