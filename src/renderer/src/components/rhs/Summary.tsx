import { useEffect, useState } from 'react'
import { Copy, RefreshCw, Sparkles } from 'lucide-react'
import { toPlainText, belongsTo } from '@renderer/lib/messages'
import { chatKey, useApp } from '@renderer/store/app'
import { copyText } from '@renderer/sync/actions'
import { aiErrorText, summarizeChat, summarizeText } from '@renderer/sync/ai'
import { MessageText } from '../channel/MessageText'

// A summary by the server's AI, in the side panel: of what you missed in a conversation (Talk's own
// "summarize unread messages"), or of a thread.

export function SummaryPanel({
  accountId,
  token,
  fromMessageId,
  rootId
}: {
  accountId: string
  token: string
  fromMessageId?: number
  rootId?: number
}) {
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parts, setParts] = useState(0)
  const [run, setRun] = useState(0)

  useEffect(() => {
    const abort = new AbortController()
    setSummary(null)
    setError(null)
    setParts(0)
    const work = rootId
      ? summarizeText(accountId, threadText(accountId, token, rootId), abort.signal)
      : summarizeChat(accountId, token, fromMessageId ?? 0, abort.signal, setParts)
    work
      .then((s) => !abort.signal.aborted && setSummary(s))
      .catch((err: unknown) => {
        if (!abort.signal.aborted) setError(aiErrorText(err))
      })
    return () => abort.abort()
  }, [accountId, token, fromMessageId, rootId, run])

  return (
    <div className="rhs-body summary-panel">
      {summary ? (
        <>
          <div className="summary-note">
            <Sparkles size={14} /> Written by AI on your Nextcloud server; check anything important.
          </div>
          <MessageText markdown={summary} className="summary-text" />
          <div className="summary-actions">
            <button
              className="btn btn-tertiary small"
              onClick={() => void copyText(summary, 'Summary copied')}
            >
              <Copy size={14} /> Copy
            </button>
            <button className="btn btn-tertiary small" onClick={() => setRun((r) => r + 1)}>
              <RefreshCw size={14} /> Again
            </button>
          </div>
        </>
      ) : error ? (
        <div className="empty-state">
          <p>{error}</p>
          <button className="btn btn-tertiary" onClick={() => setRun((r) => r + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <div className="empty-state">
          <div className="spinner" />
          <p>
            Summarizing{parts ? ` (part ${parts + 1})` : ''}… This can take a moment, depending on how busy
            your server’s AI is.
          </p>
        </div>
      )}
    </div>
  )
}

/** A thread as text for the summary: "Name: message" per message, oldest first */
function threadText(accountId: string, token: string, rootId: number): string {
  const chat = useApp.getState().chats[chatKey(accountId, token)]
  if (!chat) return ''
  const root = chat.byId[rootId]
  const replies = chat.ids.map((id) => chat.byId[id]).filter((m) => m && belongsTo(m, rootId, chat.byId))
  return [root, ...replies]
    .filter((m) => m && !m.systemMessage)
    .map((m) => `${m.actorDisplayName || 'Guest'}: ${toPlainText(m)}`)
    .join('\n\n')
}
