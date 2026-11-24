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
  X,
  BarChart3,
  BellOff,
  CalendarClock,
  ChevronDown,
  Clock
} from 'lucide-react'
import { RoomType, type MentionSuggestion } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { toEditableText, toPlainText } from '@renderer/lib/messages'
import { chatKey, hasFeature, setApp, useApp } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import { sendMessage, uploadFiles } from '@renderer/sync/actions'
import { Avatar } from '../common/Avatar'
import { EmojiPopover } from '../common/EmojiPopover'
import { anchorFrom, Menu, MenuItem, MenuSeparator, MenuTitle, type Anchor } from '../common/Menu'
import { TypingIndicator, useTypingSignal } from './Typing'
import {
  commandInProgress,
  commandSuggestions,
  parseCommand,
  unescapeSlash,
  type SlashCommand
} from '@renderer/lib/commands'
import { runCommand } from '@renderer/sync/commands'
import { pickTime, scheduleMessage } from '@renderer/sync/messaging'
import { choiceHint, laterChoices } from '@renderer/lib/time'
import {
  convertAtCaret,
  convertLastWord,
  emojiQuery,
  searchEmoji,
  type Conversion,
  type EmojiSuggestion
} from '@renderer/lib/emoji'

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
  const pollsSupported = useApp((s) => hasFeature(s.accounts[accountId], 'talk-polls'))
  const scheduling = useApp((s) => hasFeature(s.accounts[accountId], 'scheduled-messages'))
  const silentSupported = useApp((s) => hasFeature(s.accounts[accountId], 'silent-send'))
  const roomType = useApp((s) => s.accounts[accountId]?.rooms[token]?.type)
  const hasScheduled = useApp((s) => !!s.accounts[accountId]?.rooms[token]?.hasScheduledMessages)
  const [sendMenu, setSendMenu] = useState<Anchor | null>(null)
  const sendOnCtrlEnter = usePrefs((s) => s.sendOnCtrlEnter)
  const convertEmoticons = usePrefs((s) => s.convertEmoticons)
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

  // Emoji: suggestions for ":name", and the last emoticon conversion, which Backspace undoes
  const [emojiSuggest, setEmojiSuggest] = useState<{
    start: number
    query: string
    items: EmojiSuggestion[]
    index: number
  } | null>(null)
  const emojiDismissed = useRef<string | null>(null)
  const lastConversion = useRef<(Conversion['undo'] & { after: string; caret: number }) | null>(null)
  /** Where the caret goes once the changed text is rendered */
  const caretAfterRender = useRef<number | null>(null)

  // Slash commands: suggestions while the command's name is typed, a usage hint after it
  const [commandIndex, setCommandIndex] = useState(0)
  const [commandsDismissed, setCommandsDismissed] = useState(false)
  const commands = commandsDismissed ? null : commandSuggestions(draft)
  const commandHint = commandInProgress(draft)
  useEffect(() => {
    setCommandIndex(0)
    setCommandsDismissed(false)
  }, [draft])

  // Typing signals belong to the conversation, so the thread panel's box doesn't send them
  const typing = useTypingSignal(accountId, token, !thread && !disabled)

  const setDraft = useCallback(
    (value: string) =>
      setApp((s) => {
        if (value) s.drafts[draftKey] = value
        else delete s.drafts[draftKey]
      }),
    [draftKey]
  )

  useLayoutEffect(() => {
    autosize(ref.current)
    const caret = caretAfterRender.current
    caretAfterRender.current = null
    if (caret !== null) ref.current?.setSelectionRange(caret, caret)
  }, [draft])

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

  const updateEmojiSuggest = (value: string, caret: number): void => {
    const q = emojiQuery(value, caret)
    if (!q || q.query === emojiDismissed.current) {
      if (emojiSuggest) setEmojiSuggest(null)
      return
    }
    emojiDismissed.current = null
    const items = searchEmoji(q.query)
    setEmojiSuggest(items.length ? { ...q, items, index: 0 } : null)
  }

  const insertEmoji = (s: EmojiSuggestion): void => {
    if (!emojiSuggest || !ref.current) return
    const caret = ref.current.selectionStart
    const text = `${s.emoji} `
    setDraft(draft.slice(0, emojiSuggest.start) + text + draft.slice(caret))
    setEmojiSuggest(null)
    caretAfterRender.current = emojiSuggest.start + text.length
  }

  /** As typed, with ":-) " or ":tada:" turned into the emoji when that's on */
  const onInput = (el: HTMLTextAreaElement): void => {
    let value = el.value
    let caret = el.selectionStart
    lastConversion.current = null
    const typedOne = value.length === draft.length + 1 && caret === el.selectionEnd
    const conversion = convertEmoticons && typedOne ? convertAtCaret(value, caret) : null
    if (conversion) {
      value = conversion.text
      caret = conversion.caret
      lastConversion.current = { ...conversion.undo, after: value, caret }
      caretAfterRender.current = caret
    }
    setDraft(value)
    updateSuggest(value, caret)
    updateEmojiSuggest(value, caret)
    if (value) typing.keystroke()
    else typing.stop()
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

  const extras = (): { replyTo?: number; threadId?: number; threadTitle?: string } =>
    thread
      ? thread.native
        ? { threadId: thread.rootId }
        : { replyTo: thread.rootId }
      : { replyTo: replyTo?.id, threadTitle: threadTitle?.trim() || undefined }

  const post = (text: string, silent = false): void => {
    void sendMessage(accountId, token, text, { ...extras(), ...(silent ? { silent: true } : {}) })
  }

  /** Clears the box after the message left it (sent, scheduled or run as a command) */
  const sent = (): void => {
    typing.stop()
    setDraft('')
    setThreadTitle(null)
    setSuggest(null)
    setEmojiSuggest(null)
    lastConversion.current = null
    if (replyTo) setApp((s) => void (s.replyTo[key] = null))
  }

  const withEmoji = (text: string): string => (convertEmoticons ? convertLastWord(text) : text)

  const sendLater = async (at: number): Promise<void> => {
    const text = unescapeSlash(withEmoji(draft.trim()))
    if (!text) return
    if (await scheduleMessage(accountId, token, text, at, extras())) sent()
  }

  const submit = (value = draft): void => {
    const text = value.trim()
    if (!text || disabled) return
    const command = parseCommand(text)
    // Cleared first: a command may put text back into the box (/help, usage hints)
    sent()
    if (command) {
      void runCommand(
        {
          accountId,
          token,
          threadId: thread?.native ? thread.rootId : undefined,
          send: post,
          setDraft: (next) => {
            setDraft(next)
            requestAnimationFrame(() => ref.current?.focus())
          }
        },
        command.command,
        command.args
      )
    } else {
      post(unescapeSlash(withEmoji(text)))
    }
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

  const pickCommand = (c: SlashCommand, run: boolean): void => {
    if (run && !c.argsRequired && !c.args) submit(`/${c.name}`)
    else {
      setDraft(`/${c.name} `)
      requestAnimationFrame(() => ref.current?.focus())
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (commands?.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setCommandIndex((i) => (i + d + commands.length) % commands.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        pickCommand(commands[commandIndex] ?? commands[0], e.key === 'Enter')
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setCommandsDismissed(true)
        return
      }
    }
    if (emojiSuggest) {
      const n = emojiSuggest.items.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setEmojiSuggest({ ...emojiSuggest, index: (emojiSuggest.index + d + n) % n })
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        insertEmoji(emojiSuggest.items[emojiSuggest.index])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        emojiDismissed.current = emojiSuggest.query
        setEmojiSuggest(null)
        return
      }
    }
    // Backspace right after an emoticon became an emoji brings the emoticon back
    const conversion = lastConversion.current
    if (
      e.key === 'Backspace' &&
      conversion &&
      draft === conversion.after &&
      e.currentTarget.selectionStart === conversion.caret &&
      e.currentTarget.selectionEnd === conversion.caret
    ) {
      e.preventDefault()
      lastConversion.current = null
      caretAfterRender.current = conversion.caret
      setDraft(conversion.text)
      return
    }
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
        {commands && commands.length > 0 && (
          <div className="suggestion-list">
            <div className="suggestion-header">Commands</div>
            {commands.map((c, i) => (
              <button
                key={c.name}
                className={`suggestion command${i === commandIndex ? ' selected' : ''}`}
                onMouseEnter={() => setCommandIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickCommand(c, false)
                }}
              >
                <span className="cmd-name">
                  /{c.name}
                  {c.args && <span className="cmd-args"> {c.args}</span>}
                </span>
                <span className="sub">{c.description}</span>
              </button>
            ))}
          </div>
        )}
        {!commands?.length && commandHint && !suggest?.items.length && (
          <div className="command-hint">
            <b>/{commandHint.name}</b> {commandHint.args} — {commandHint.description}
          </div>
        )}
        {emojiSuggest && (
          <div className="suggestion-list">
            <div className="suggestion-header">Emoji matching “:{emojiSuggest.query}”</div>
            {emojiSuggest.items.map((s, i) => (
              <button
                key={s.emoji}
                className={`suggestion emoji${i === emojiSuggest.index ? ' selected' : ''}`}
                onMouseEnter={() => setEmojiSuggest({ ...emojiSuggest, index: i })}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertEmoji(s)
                }}
              >
                <span className="emoji-char">{s.emoji}</span>
                <span>:{s.code}:</span>
              </button>
            ))}
          </div>
        )}
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
        {hasScheduled && !thread && (
          <button
            className="composer-scheduled"
            onClick={() => setApp({ rhs: { type: 'scheduled', accountId, token } })}
          >
            <Clock size={13} /> You have scheduled messages here
          </button>
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
          onChange={(e) => onInput(e.target)}
          onKeyDown={onKeyDown}
          onBlur={() =>
            setTimeout(() => {
              setSuggest(null)
              setEmojiSuggest(null)
            }, 150)
          }
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
          <button className="icon-btn small fmt-extra" title="Strikethrough" onClick={() => format('strike')}>
            <Strikethrough size={16} />
          </button>
          <button className="icon-btn small" title="Link" onClick={() => format('link')}>
            <Link2 size={16} />
          </button>
          <button className="icon-btn small" title="Code" onClick={() => format('code')}>
            <Code size={16} />
          </button>
          <button className="icon-btn small fmt-extra" title="Quote" onClick={() => format('quote')}>
            <Quote size={16} />
          </button>
          <button className="icon-btn small fmt-extra" title="Bulleted list" onClick={() => format('ul')}>
            <List size={16} />
          </button>
          <button className="icon-btn small fmt-extra" title="Numbered list" onClick={() => format('ol')}>
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
          {pollsSupported && roomType !== RoomType.OneToOne && roomType !== RoomType.NoteToSelf && (
            <button
              className="icon-btn small"
              title="Create a poll"
              disabled={disabled}
              onClick={() =>
                setApp({
                  modal: {
                    type: 'poll',
                    accountId,
                    token,
                    threadId: thread?.native ? thread.rootId : undefined
                  }
                })
              }
            >
              <BarChart3 size={16} />
            </button>
          )}
          <span className="spacer" />
          <span className="send-group">
            <button
              className="send-btn"
              disabled={!draft.trim() || disabled}
              onClick={() => submit()}
              title="Send"
            >
              <SendHorizontal size={16} />
            </button>
            {(scheduling || silentSupported) && (
              <button
                className="send-more"
                disabled={!draft.trim() || disabled}
                title="Send later or without notification"
                onClick={(e) => setSendMenu(anchorFrom(e.currentTarget, 'right'))}
              >
                <ChevronDown size={14} />
              </button>
            )}
          </span>
          {sendMenu && (
            <Menu anchor={sendMenu} onClose={() => setSendMenu(null)}>
              {scheduling && (
                <>
                  <MenuTitle>Send later</MenuTitle>
                  {laterChoices().map((c) => (
                    <MenuItem
                      key={c.label}
                      icon={<Clock size={18} />}
                      label={c.label}
                      hint={choiceHint(c)}
                      onClick={() => {
                        setSendMenu(null)
                        void sendLater(c.at)
                      }}
                    />
                  ))}
                  <MenuItem
                    icon={<CalendarClock size={18} />}
                    label="Custom time…"
                    onClick={() => {
                      setSendMenu(null)
                      pickTime('Send later', 'Schedule', laterChoices()[3].at, (at) => void sendLater(at))
                    }}
                  />
                </>
              )}
              {silentSupported && (
                <>
                  {scheduling && <MenuSeparator />}
                  <MenuItem
                    icon={<BellOff size={18} />}
                    label="Send without notification"
                    onClick={() => {
                      setSendMenu(null)
                      const text = draft.trim()
                      if (!text) return
                      sent()
                      post(unescapeSlash(text), true)
                    }}
                  />
                </>
              )}
            </Menu>
          )}
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
      <div className="composer-hint">
        {!thread && <TypingIndicator accountId={accountId} token={token} />}
        <span className="composer-hint-text">{draft ? sendHint : ''}</span>
      </div>
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
