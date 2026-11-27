import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Brain, Copy, Pencil, RefreshCw, Send, Sparkles, Square, Trash2 } from 'lucide-react'
import type { ChatMessage } from '@renderer/api/assistant'
import { cleanAiOutput } from '@renderer/lib/ai-output'
import { stageText } from '@renderer/lib/ai-tasks'
import { setApp } from '@renderer/store/app'
import { updateAssistant, useAssistant } from '@renderer/store/assistant'
import { usePrefs } from '@renderer/store/prefs'
import { copyText } from '@renderer/sync/actions'
import {
  deleteSession,
  loadOlder,
  regenerate,
  rememberSession,
  renameSession,
  retryAnswer,
  sendMessage,
  stopAnswer
} from '@renderer/sync/assistant'
import { Toggle } from '../common/Modal'
import { MessageText } from '../channel/MessageText'
import { AgentConfirm } from './AgentConfirm'

// A conversation with the AI (Nextcloud Assistant's "Chat with AI"): your messages and its answers,
// the answer as it's being written, and the agent's questions before it acts for you.

export function ChatPane({ accountId, sessionId }: { accountId: string; sessionId: number | null }) {
  const session = useAssistant((s) =>
    sessionId === null ? undefined : s.accounts[accountId]?.sessions?.find((x) => x.id === sessionId)
  )
  const chat = useAssistant((s) => (sessionId === null ? undefined : s.accounts[accountId]?.chats[sessionId]))
  const canAct = useAssistant(
    (s) =>
      !!s.accounts[accountId]?.types &&
      Object.keys(s.accounts[accountId]!.types!).some((t) => t.includes('contextagent'))
  )
  const draftKey = sessionId === null ? 'new' : String(sessionId)
  const draft = useAssistant((s) => s.accounts[accountId]?.drafts[draftKey] ?? '')
  const sendOnCtrlEnter = usePrefs((s) => s.sendOnCtrlEnter)
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)

  const messages = (chat?.messages ?? []).filter(
    (m) => m.role !== 'human' || m.content || m.attachments?.length
  )
  const generating = chat?.generating
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const waitingForAnswer =
    !generating && !chat?.sending && !chat?.failed && !chat?.pending && messages.at(-1)?.role === 'human'

  // Follow the conversation down as answers come in, unless you scrolled up to read
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages.length, generating?.partial, chat?.pending, chat?.failed, sessionId])
  useEffect(() => {
    stick.current = true
    box.current?.focus()
  }, [sessionId])

  const setDraft = (text: string): void => updateAssistant(accountId, (a) => void (a.drafts[draftKey] = text))
  const send = (): void => {
    const text = draft.trim()
    if (!text || generating) return
    setDraft('')
    stick.current = true
    void sendMessage(accountId, sessionId, text)
  }

  return (
    <main className="center ai-pane">
      <ChatHeader
        accountId={accountId}
        sessionId={sessionId}
        title={session?.title ?? null}
        remembered={session?.is_remembered}
      />
      <div
        className="ai-chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        <div className="ai-chat">
          {chat?.hasOlder && sessionId !== null && (
            <button className="link-btn ai-older" onClick={() => void loadOlder(accountId, sessionId)}>
              Earlier messages
            </button>
          )}
          {sessionId === null || (chat?.messages && !messages.length && !generating) ? (
            <div className="ai-intro">
              <Sparkles size={40} strokeWidth={1.5} />
              <h2>What can I help with?</h2>
              <p>
                Answers are written by your Nextcloud server’s AI.
                {canAct &&
                  ' It can also do things for you in Nextcloud, such as adding events or sending messages, and always asks you first.'}
              </p>
            </div>
          ) : chat?.messages === null || chat === undefined ? (
            <div className="empty-state">
              <div className="spinner" />
            </div>
          ) : null}
          {chat?.error && <p className="ai-error">{chat.error}</p>}
          {messages.map((m) => (
            <Message
              key={m.id}
              message={m}
              onRegenerate={
                m.id === lastAssistant?.id && !generating && sessionId !== null
                  ? () => void regenerate(accountId, sessionId, m.id)
                  : undefined
              }
            />
          ))}
          {generating && (
            <div className="ai-msg assistant">
              <div className="ai-msg-avatar">
                <Sparkles size={16} />
              </div>
              <div className="ai-msg-body">
                {generating.reasoning && !generating.partial && (
                  <div className="ai-thinking">
                    <Brain size={13} /> Thinking…
                  </div>
                )}
                {generating.partial ? (
                  <MessageText markdown={generating.partial} className="ai-msg-text writing" />
                ) : (
                  <div className="ai-wait">
                    <span className="ai-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    {stageText(generating.stage)}
                  </div>
                )}
                {generating.stage?.stage === 'scheduled' && generating.stage.slow && (
                  <p className="ai-slow">
                    Your server is slow to start AI tasks. If this keeps happening, ask your administrator to
                    run background workers for AI tasks.
                  </p>
                )}
              </div>
            </div>
          )}
          {chat?.pending && sessionId !== null && (
            <AgentConfirm accountId={accountId} sessionId={sessionId} actions={chat.pending} />
          )}
          {chat?.failed && sessionId !== null && (
            <div className="ai-failed">
              <span>{chat.failed}</span>
              <button
                className="btn btn-tertiary small"
                onClick={() => void retryAnswer(accountId, sessionId)}
              >
                Try again
              </button>
            </div>
          )}
          {waitingForAnswer && sessionId !== null && chat?.messages && (
            <div className="ai-failed">
              <span>No answer yet.</span>
              <button
                className="btn btn-tertiary small"
                onClick={() => void retryAnswer(accountId, sessionId)}
              >
                Ask for one
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="ai-compose">
        <div className="composer">
          <textarea
            ref={box}
            rows={1}
            value={draft}
            placeholder={chat?.pending ? 'Or tell it what to do instead…' : 'Ask anything'}
            onChange={(e) => {
              setDraft(e.target.value)
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              const ctrl = e.metaKey || e.ctrlKey
              if (sendOnCtrlEnter ? ctrl : !e.shiftKey && !ctrl) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="composer-toolbar">
            <span className="ai-compose-note">Written by AI. Check anything important.</span>
            {generating && sessionId !== null ? (
              <button className="send-btn" title="Stop" onClick={() => void stopAnswer(accountId, sessionId)}>
                <Square size={13} fill="currentColor" /> Stop
              </button>
            ) : (
              <button className="send-btn" title="Send" disabled={!draft.trim()} onClick={send}>
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

function ChatHeader({
  accountId,
  sessionId,
  title,
  remembered
}: {
  accountId: string
  sessionId: number | null
  title: string | null
  remembered?: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const save = (): void => {
    const t = editing?.trim()
    setEditing(null)
    if (t && sessionId !== null && t !== title) void renameSession(accountId, sessionId, t)
  }
  return (
    <div className="channel-header">
      <div className="ch-main">
        {editing !== null ? (
          <input
            className="input ai-title-input"
            autoFocus
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') {
                e.stopPropagation()
                setEditing(null)
              }
            }}
          />
        ) : (
          <div className="ch-title-row">
            <span className="ch-title">{sessionId === null ? 'New chat' : title || 'New conversation'}</span>
            {sessionId !== null && (
              <button className="icon-btn small" title="Rename" onClick={() => setEditing(title ?? '')}>
                <Pencil size={13} />
              </button>
            )}
          </div>
        )}
      </div>
      {sessionId !== null && remembered !== undefined && (
        <label
          className="ai-remember"
          title="Let the AI remember what was said here in your other conversations"
        >
          Remember
          <Toggle on={remembered} onChange={(v) => void rememberSession(accountId, sessionId, v)} />
        </label>
      )}
      {sessionId !== null && (
        <button
          className="icon-btn"
          title="Delete the conversation"
          onClick={() =>
            setApp({
              modal: {
                type: 'confirm',
                title: 'Delete this conversation?',
                body: `“${title || 'New conversation'}” is deleted on your Nextcloud server, also for the web Assistant.`,
                confirmLabel: 'Delete',
                danger: true,
                onConfirm: () => void deleteSession(accountId, sessionId)
              }
            })
          }
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  )
}

function Message({ message, onRegenerate }: { message: ChatMessage; onRegenerate?: () => void }) {
  if (message.role === 'human') {
    return (
      <div className="ai-msg human">
        <div className="ai-msg-body">
          <div className="ai-msg-text">{message.content}</div>
        </div>
      </div>
    )
  }
  const text = cleanAiOutput(message.content)
  const sources = parseSources(message.sources)
  return (
    <div className="ai-msg assistant">
      <div className="ai-msg-avatar">
        <Sparkles size={16} />
      </div>
      <div className="ai-msg-body">
        {message.reasoning && (
          <details className="ai-reasoning">
            <summary>
              <Brain size={13} /> How it thought about it
            </summary>
            <div>{message.reasoning}</div>
          </details>
        )}
        <MessageText markdown={text || '…'} className="ai-msg-text" />
        {sources.length > 0 && <div className="ai-sources">Used: {sources.join(', ')}</div>}
        <div className="ai-msg-actions">
          <button
            className="icon-btn small"
            title="Copy"
            onClick={() => void copyText(text, 'Answer copied')}
          >
            <Copy size={13} />
          </button>
          {onRegenerate && (
            <button className="icon-btn small" title="Write the answer again" onClick={onRegenerate}>
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** What an answer used (the agent's tools, documents), from the JSON list the Assistant keeps */
function parseSources(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && !!s.trim()) : []
  } catch {
    return []
  }
}
