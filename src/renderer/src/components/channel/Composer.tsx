import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessagesSquare,
  Paperclip,
  Quote,
  SendHorizontal,
  Smile,
  Strikethrough,
  X
} from 'lucide-react'
import type { MentionSuggestion } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { toEditableText, toPlainText } from '@renderer/lib/messages'
import { chatKey, hasFeature, setApp, useApp } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import { sendMessage, uploadFiles } from '@renderer/sync/actions'
import { Avatar } from '../common/Avatar'
import { EmojiPopover } from '../common/EmojiPopover'
import { anchorFrom, type Anchor } from '../common/Menu'

const isMac = window.hubbub.platform === 'darwin'

function autosize(el: HTMLTextAreaElement | null): void {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/** Wraps the current selection with markdown markers, Mattermost formatting-bar style. */
function applyFormat(
  el: HTMLTextAreaElement,
  value: string,
  kind: string
): { value: string; caret: [number, number] } {
  const { selectionStart: a, selectionEnd: b } = el
  const sel = value.slice(a, b)
  const wrap = (pre: string, post = pre, placeholder = ''): { value: string; caret: [number, number] } => {
    const inner = sel || placeholder
    const next = value.slice(0, a) + pre + inner + post + value.slice(b)
    return { value: next, caret: [a + pre.length, a + pre.length + inner.length] }
  }
  const prefixLines = (prefix: (i: number) => string): { value: string; caret: [number, number] } => {
    const lineStart = value.lastIndexOf('\n', a - 1) + 1
    const block = value.slice(lineStart, b)
    const replaced = block
      .split('\n')
      .map((l, i) => prefix(i) + l)
      .join('\n')
    const next = value.slice(0, lineStart) + replaced + value.slice(b)
    return { value: next, caret: [lineStart + replaced.length, lineStart + replaced.length] }
  }
  switch (kind) {
    case 'bold':
      return wrap('**', '**', 'bold')
    case 'italic':
      return wrap('*', '*', 'italic')
    case 'strike':
      return wrap('~~', '~~', 'strikethrough')
    case 'code':
      return sel.includes('\n') ? wrap('```\n', '\n```') : wrap('`', '`', 'code')
    case 'link': {
      const next = value.slice(0, a) + `[${sel || 'text'}](url)` + value.slice(b)
      const urlStart = a + (sel || 'text').length + 3
      return { value: next, caret: [urlStart, urlStart + 3] }
    }
    case 'quote':
      return prefixLines(() => '> ')
    case 'ul':
      return prefixLines(() => '- ')
    case 'ol':
      return prefixLines((i) => `${i + 1}. `)
    default:
      return { value, caret: [a, b] }
  }
}

function mentionToken(s: MentionSuggestion): string {
  const id = s.mentionId ?? (s.source === 'calls' ? 'all' : s.source === 'groups' ? `group/${s.id}` : s.id)
  return /[\s/]/.test(id) ? `@"${id}"` : `@${id}`
}

interface ComposerProps {
  accountId: string
  token: string
  placeholder: string
  /** Set when composing inside the thread panel */
  thread?: { rootId: number; native: boolean }
  disabled?: boolean
}

export function Composer({ accountId, token, placeholder, thread, disabled }: ComposerProps) {
  const key = chatKey(accountId, token)
  const draftKey = thread ? `${key}#${thread.rootId}` : key
  const draft = useApp((s) => s.drafts[draftKey] ?? '')
  const replyTo = useApp((s) => (thread ? null : s.replyTo[key]))
  const threadsSupported = useApp((s) => hasFeature(s.accounts[accountId], 'threads'))
  const sendOnCtrlEnter = usePrefs((s) => s.sendOnCtrlEnter)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [emoji, setEmoji] = useState<Anchor | null>(null)
  const [threadTitle, setThreadTitle] = useState<string | null>(null)
  const [suggest, setSuggest] = useState<{
    query: string
    start: number
    items: MentionSuggestion[]
    index: number
  } | null>(null)

  const setDraft = useCallback(
    (value: string) =>
      setApp((s) => {
        if (value) s.drafts[draftKey] = value
        else delete s.drafts[draftKey]
      }),
    [draftKey]
  )

  useLayoutEffect(() => autosize(ref.current), [draft])

  useEffect(() => {
    if (!disabled) ref.current?.focus()
  }, [draftKey, disabled])

  // Focus the box when a quote-reply is chosen
  useEffect(() => {
    if (replyTo) ref.current?.focus()
  }, [replyTo])

  // Mention autocomplete
  const query = suggest?.query
  useEffect(() => {
    if (query === undefined) return
    const t = setTimeout(() => {
      talk(accountId)
        .mentions(token, query)
        .then((items) => setSuggest((s) => (s && s.query === query ? { ...s, items, index: 0 } : s)))
        .catch(() => undefined)
    }, 150)
    return () => clearTimeout(t)
  }, [query, accountId, token])

  const updateSuggest = (value: string, caret: number): void => {
    const before = value.slice(0, caret)
    const m = /(^|\s)@([^\s@]*)$/.exec(before)
    if (m) {
      const start = caret - m[2].length - 1
      setSuggest((s) => ({ query: m[2], start, items: s?.items ?? [], index: 0 }))
    } else if (suggest) {
      setSuggest(null)
    }
  }

  const insertMention = (s: MentionSuggestion): void => {
    if (!suggest || !ref.current) return
    const caret = ref.current.selectionStart
    const token = `${mentionToken(s)} `
    const next = draft.slice(0, suggest.start) + token + draft.slice(caret)
    setDraft(next)
    setSuggest(null)
    const pos = suggest.start + token.length
    requestAnimationFrame(() => ref.current?.setSelectionRange(pos, pos))
  }

  const submit = (): void => {
    const text = draft.trim()
    if (!text || disabled) return
    const extras = thread
      ? thread.native
        ? { threadId: thread.rootId }
        : { replyTo: thread.rootId }
      : { replyTo: replyTo?.id, threadTitle: threadTitle?.trim() || undefined }
    void sendMessage(accountId, token, text, extras)
    setDraft('')
    setThreadTitle(null)
    setSuggest(null)
    if (replyTo) setApp((s) => void (s.replyTo[key] = null))
  }

  const editLastOwn = (): boolean => {
    const s = useApp.getState()
    const chat = s.chats[key]
    const selfId = s.accounts[accountId]?.user?.id
    if (!chat || !hasFeature(s.accounts[accountId], 'edit-messages')) return false
    for (let i = chat.ids.length - 1; i >= 0; i--) {
      const m = chat.byId[chat.ids[i]]
      if (
        m.actorType === 'users' &&
        m.actorId === selfId &&
        !m.systemMessage &&
        m.messageType === 'comment'
      ) {
        if (toEditableText(m) === null) return false
        setApp({ editing: { chatKey: key, id: m.id } })
        return true
      }
    }
    return false
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (suggest && suggest.items.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setSuggest({ ...suggest, index: (suggest.index + d + suggest.items.length) % suggest.items.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(suggest.items[suggest.index])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSuggest(null)
        return
      }
    }
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      const mod = e.ctrlKey || e.metaKey
      if ((sendOnCtrlEnter && mod) || (!sendOnCtrlEnter && !e.shiftKey && !mod && !e.altKey)) {
        e.preventDefault()
        submit()
      }
      return
    }
    if (e.key === 'ArrowUp' && !draft && !thread) {
      if (editLastOwn()) e.preventDefault()
      return
    }
    if (e.key === 'Escape' && replyTo) {
      setApp((s) => void (s.replyTo[key] = null))
    }
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (mod && !e.shiftKey && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault()
      format(e.key === 'b' ? 'bold' : 'italic')
    }
  }

  const format = (kind: string): void => {
    const el = ref.current
    if (!el) return
    const { value, caret } = applyFormat(el, draft, kind)
    setDraft(value)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret[0], caret[1])
    })
  }

  const insertText = (text: string): void => {
    const el = ref.current
    const pos = el?.selectionStart ?? draft.length
    setDraft(draft.slice(0, pos) + text + draft.slice(el?.selectionEnd ?? pos))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos + text.length, pos + text.length)
    })
  }

  const upload = (files: File[]): void => {
    if (files.length)
      void uploadFiles(accountId, token, files, { threadId: thread?.native ? thread.rootId : undefined })
  }

  const sendHint = sendOnCtrlEnter ? `${isMac ? '⌘' : 'Ctrl'}+Enter to send` : 'Shift+Enter for a new line'

  return (
    <div className="composer-wrap">
      <div className="composer">
        {suggest && suggest.items.length > 0 && (
          <div className="suggestion-list">
            <div className="suggestion-header">Mentions</div>
            {suggest.items.map((s, i) => (
              <button
                key={`${s.source}:${s.id}`}
                className={`suggestion${i === suggest.index ? ' selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(s)
                }}
              >
                <Avatar
                  accountId={accountId}
                  userId={s.source === 'users' ? s.id : undefined}
                  name={s.label}
                  size={24}
                  status={s.source === 'users' ? (s.status ?? null) : null}
                />
                <span>{s.label}</span>
                <span className="sub">
                  {s.source === 'calls' ? (s.details ?? 'Notify everyone') : `@${s.mentionId ?? s.id}`}
                </span>
              </button>
            ))}
          </div>
        )}
        {replyTo && (
          <div className="composer-banner">
            <Quote size={14} />
            <span className="banner-text">
              Replying to <b>{replyTo.actorDisplayName}</b>: {toPlainText(replyTo)}
            </span>
            <button
              className="icon-btn small"
              onClick={() => setApp((s) => void (s.replyTo[key] = null))}
              title="Cancel reply"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {threadTitle !== null && (
          <input
            className="composer-title-input"
            placeholder="Thread title"
            value={threadTitle}
            onChange={(e) => setThreadTitle(e.target.value)}
            autoFocus
          />
        )}
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          disabled={disabled}
          placeholder={disabled ? 'This conversation is read-only' : placeholder}
          onChange={(e) => {
            setDraft(e.target.value)
            updateSuggest(e.target.value, e.target.selectionStart)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setSuggest(null), 150)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) {
              e.preventDefault()
              upload(files)
            }
          }}
        />
        <div className="composer-toolbar">
          <button className="icon-btn small" title="Bold" onClick={() => format('bold')}>
            <Bold size={16} />
          </button>
          <button className="icon-btn small" title="Italic" onClick={() => format('italic')}>
            <Italic size={16} />
          </button>
          <button className="icon-btn small" title="Strikethrough" onClick={() => format('strike')}>
            <Strikethrough size={16} />
          </button>
          <button className="icon-btn small" title="Link" onClick={() => format('link')}>
            <Link2 size={16} />
          </button>
          <button className="icon-btn small" title="Code" onClick={() => format('code')}>
            <Code size={16} />
          </button>
          <button className="icon-btn small" title="Quote" onClick={() => format('quote')}>
            <Quote size={16} />
          </button>
          <button className="icon-btn small" title="Bulleted list" onClick={() => format('ul')}>
            <List size={16} />
          </button>
          <button className="icon-btn small" title="Numbered list" onClick={() => format('ol')}>
            <ListOrdered size={16} />
          </button>
          <span className="sep" />
          <button
            className="icon-btn small"
            title="Attach files"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
          >
            <Paperclip size={16} />
          </button>
          <button
            className="icon-btn small"
            title="Emoji"
            onClick={(e) => setEmoji(anchorFrom(e.currentTarget))}
          >
            <Smile size={16} />
          </button>
          {!thread && threadsSupported && (
            <button
              className={`icon-btn small${threadTitle !== null ? ' active' : ''}`}
              title="Start a new thread"
              onClick={() => setThreadTitle(threadTitle === null ? '' : null)}
            >
              <MessagesSquare size={16} />
            </button>
          )}
          <span className="spacer" />
          <button className="send-btn" disabled={!draft.trim() || disabled} onClick={submit} title="Send">
            <SendHorizontal size={16} />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            upload(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      <div className="composer-hint">{draft ? sendHint : ''}</div>
      {emoji && <EmojiPopover anchor={emoji} onClose={() => setEmoji(null)} onSelect={insertText} />}
    </div>
  )
}

export function MessageEditor({
  initial,
  onSave,
  onCancel
}: {
  initial: string
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => autosize(ref.current), [value])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  return (
    <div className="edit-box">
      <div className="composer">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (value.trim()) onSave(value)
            }
          }}
        />
      </div>
      <div className="edit-hint">
        Escape to <button onClick={onCancel}>cancel</button> • Enter to{' '}
        <button onClick={() => value.trim() && onSave(value)}>save</button>
      </div>
    </div>
  )
}
