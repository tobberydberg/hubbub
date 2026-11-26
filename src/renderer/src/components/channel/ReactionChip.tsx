import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { talk } from '@renderer/api/talk'
import { useApp } from '@renderer/store/app'

// A reaction under a message ("👍 3"); hovering it shows who reacted, as in Mattermost.

const cache = new Map<string, Promise<string[]>>()

/** Names of who reacted with an emoji; cached until the count changes */
function whoReacted(
  accountId: string,
  token: string,
  messageId: number,
  emoji: string,
  count: number
): Promise<string[]> {
  const key = `${accountId}/${token}/${messageId}/${emoji}/${count}`
  let names = cache.get(key)
  if (!names) {
    const selfId = useApp.getState().accounts[accountId]?.user?.id
    names = talk(accountId)
      .reactionsOf(token, messageId, emoji)
      .then((data) =>
        (Array.isArray(data) ? [] : (data[emoji] ?? []))
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((r) =>
            r.actorType === 'users' && r.actorId === selfId ? 'You' : r.actorDisplayName || 'Guest'
          )
      )
    names.catch(() => cache.delete(key))
    cache.set(key, names)
  }
  return names
}

/** "You", "Alice and Bob", "Alice, Bob and Carol", "Alice, Bob and 4 others" */
export function reactorText(names: string[], count: number): string {
  const listed = names.length ? names : []
  const others = Math.max(0, count - Math.min(listed.length, 10))
  const shown = listed.slice(0, 10)
  if (!shown.length) return `${count} ${count === 1 ? 'person' : 'people'}`
  if (others > 0) return `${shown.join(', ')} and ${others} ${others === 1 ? 'other' : 'others'}`
  if (shown.length === 1) return shown[0]
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

export function ReactionChip({
  accountId,
  token,
  messageId,
  emoji,
  count,
  self,
  onToggle
}: {
  accountId: string
  token: string
  messageId: number
  emoji: string
  count: number
  self: boolean
  onToggle: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)

  const show = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const at = { x: r.left + r.width / 2, y: r.top }
      setTip({ text: '…', ...at })
      void whoReacted(accountId, token, messageId, emoji, count)
        .then((names) => setTip((t) => (t ? { ...t, text: reactorText(names, count) } : t)))
        .catch(() => setTip((t) => (t ? { ...t, text: reactorText([], count) } : t)))
    }, 350)
  }
  const hide = (): void => {
    if (timer.current) clearTimeout(timer.current)
    setTip(null)
  }

  return (
    <>
      <button
        ref={ref}
        className={`reaction${self ? ' self' : ''}`}
        onClick={() => {
          hide()
          onToggle()
        }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <span className="emoji">{emoji}</span>
        {count}
      </button>
      {tip &&
        createPortal(
          <div className="reaction-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
            <span className="reaction-tip-emoji">{emoji}</span>
            <span>
              {tip.text}
              {tip.text !== '…' && <span className="reaction-tip-sub"> reacted</span>}
            </span>
          </div>,
          ref.current?.ownerDocument.body ?? document.body
        )}
    </>
  )
}
