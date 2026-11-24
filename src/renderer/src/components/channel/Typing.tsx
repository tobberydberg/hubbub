import { useCallback, useEffect, useRef } from 'react'
import { sendTypingInCall } from '@renderer/calls/call'
import { sendTypingSignal } from '@renderer/sync/presence'
import { typingKey, typingText, useTyping } from '@renderer/store/typing'

// "Alice is typing…" under the message box, and our own typing signals, timed like Talk on the web:
// a signal on the first keystroke, repeated every 10 seconds while typing goes on.

const REPEAT = 10_000

function send(accountId: string, token: string, typing: boolean): void {
  if (!sendTypingInCall(accountId, token, typing)) sendTypingSignal(accountId, token, typing)
}

/** Returns `keystroke` (call on every change) and `stop` (after sending or clearing the message). */
export function useTypingSignal(accountId: string, token: string, enabled: boolean) {
  const interval = useRef<ReturnType<typeof setInterval> | null>(null)
  const typedSinceLast = useRef(false)

  const stop = useCallback(() => {
    if (!interval.current) return
    clearInterval(interval.current)
    interval.current = null
    send(accountId, token, false)
  }, [accountId, token])

  const keystroke = useCallback(() => {
    if (!enabled) return
    if (interval.current) {
      typedSinceLast.current = true
      return
    }
    send(accountId, token, true)
    typedSinceLast.current = false
    interval.current = setInterval(() => {
      if (typedSinceLast.current) {
        typedSinceLast.current = false
        send(accountId, token, true)
      } else if (interval.current) {
        // Paused typing: let the others' indicator run out instead of flickering
        clearInterval(interval.current)
        interval.current = null
      }
    }, REPEAT)
  }, [accountId, token, enabled])

  // Switching conversations or closing the box ends our typing there
  useEffect(() => stop, [stop])
  return { keystroke, stop }
}

export function TypingIndicator({ accountId, token }: { accountId: string; token: string }) {
  const typers = useTyping((s) => s.typing[typingKey(accountId, token)])
  const names = [...new Set(Object.values(typers ?? {}).map((t) => t.name))]
  if (!names.length) return null
  return (
    <span className="typing" aria-live="polite">
      <span className="typing-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      {typingText(names)}
    </span>
  )
}
