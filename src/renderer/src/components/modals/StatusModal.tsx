import { useEffect, useMemo, useState } from 'react'
import { Circle, Clock, EyeOff, MinusCircle, Smile, X } from 'lucide-react'
import { talk } from '@renderer/api/talk'
import {
  CLEAR_AFTER,
  clearAfterOf,
  clearAtFor,
  EXTRA_SUGGESTIONS,
  formatUntil,
  type ClearAfter,
  type StatusSuggestion
} from '@renderer/lib/status'
import { fromLocalInput, toLocalInput } from '@renderer/lib/time'
import { setApp, useApp } from '@renderer/store/app'
import { clearOwnStatusMessage, saveOwnStatus } from '@renderer/sync/status'
import type { PredefinedStatus } from '@shared/talk-types'
import { EmojiPopover } from '../common/EmojiPopover'
import { anchorFrom, type Anchor } from '../common/Menu'
import { Modal } from '../common/Modal'

// Your status, as Nextcloud's own status dialog sets it: online, away, busy, do not disturb or
// invisible, and a message with an emoji ("🏡 Working remotely") that can clear itself.

export const STATUS_CHOICES = [
  {
    value: 'online',
    label: 'Online',
    icon: <Circle size={16} fill="var(--online-indicator)" stroke="none" />
  },
  { value: 'away', label: 'Away', icon: <Clock size={16} color="var(--away-indicator)" /> },
  { value: 'busy', label: 'Busy', icon: <Circle size={16} fill="var(--dnd-indicator)" stroke="none" /> },
  { value: 'dnd', label: 'Do not disturb', icon: <MinusCircle size={16} color="var(--dnd-indicator)" /> },
  { value: 'invisible', label: 'Invisible', icon: <EyeOff size={16} /> }
]

const close = (): void => setApp({ modal: null })

export function StatusModal({ accountId }: { accountId: string }) {
  const own = useApp((s) => s.accounts[accountId]?.ownStatus)
  const canBeBusy = useApp((s) => s.accounts[accountId]?.canBeBusy)
  const [status, setStatus] = useState(
    own?.statusIsUserDefined === false ? 'online' : (own?.status ?? 'online')
  )
  const [icon, setIcon] = useState<string | null>(own?.icon ?? null)
  const [message, setMessage] = useState(own?.message ?? '')
  const [predefinedId, setPredefinedId] = useState<string | undefined>(
    own?.messageIsPredefined ? (own.messageId ?? undefined) : undefined
  )
  const [clearAfter, setClearAfter] = useState<ClearAfter>(own?.clearAt ? 'custom' : 'never')
  const [custom, setCustom] = useState<number | null>(own?.clearAt ?? null)
  const [predefined, setPredefined] = useState<PredefinedStatus[]>([])
  const [emoji, setEmoji] = useState<Anchor | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    talk(accountId)
      .predefinedStatuses()
      .then((list) => setPredefined(list.filter((p) => p.visible !== false)))
      .catch(() => undefined)
  }, [accountId])

  const suggestions = useMemo<StatusSuggestion[]>(
    () => [
      ...predefined.map((p) => ({
        id: p.id,
        icon: p.icon,
        message: p.message,
        clearAfter: clearAfterOf(p.clearAt)
      })),
      ...EXTRA_SUGGESTIONS.filter((x) => !predefined.some((p) => p.message === x.message))
    ],
    [predefined]
  )

  const pick = (s: StatusSuggestion): void => {
    setIcon(s.icon)
    setMessage(s.message)
    setPredefinedId(s.id)
    setClearAfter(s.clearAfter)
  }

  const clearAt = clearAtFor(clearAfter, new Date(), custom)
  const customInvalid = clearAfter === 'custom' && (!custom || custom * 1000 <= Date.now())
  const hasMessage = !!message.trim()

  const save = async (): Promise<void> => {
    if (saving || (hasMessage && customInvalid)) return
    setSaving(true)
    const ok = await saveOwnStatus(
      accountId,
      status,
      hasMessage ? { icon, message, predefinedId, clearAt: hasMessage ? clearAt : null } : null
    )
    setSaving(false)
    if (ok) close()
  }

  const statusChoices = STATUS_CHOICES.filter((c) => c.value !== 'busy' || canBeBusy)

  return (
    <Modal
      title="Set your status"
      onClose={close}
      footer={
        <>
          {(own?.message || own?.icon) && (
            <button
              className="btn btn-tertiary status-clear-btn"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                await clearOwnStatusMessage(accountId)
                setSaving(false)
                close()
              }}
            >
              Clear status message
            </button>
          )}
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={saving || (hasMessage && customInvalid)}
            onClick={() => void save()}
          >
            Set status
          </button>
        </>
      }
    >
      <div className="status-types" role="radiogroup" aria-label="Status">
        {statusChoices.map((c) => (
          <button
            key={c.value}
            role="radio"
            aria-checked={status === c.value}
            className={status === c.value ? 'on' : ''}
            onClick={() => setStatus(c.value)}
          >
            {c.icon}
            {c.label}
          </button>
        ))}
      </div>

      <label className="field-label">Status message</label>
      <div className="status-input">
        <button
          className="status-emoji"
          title="Choose an emoji"
          onClick={(e) => setEmoji(anchorFrom(e.currentTarget))}
        >
          {icon || <Smile size={18} />}
        </button>
        <input
          className="input"
          placeholder="What’s your status?"
          maxLength={80}
          value={message}
          autoFocus
          onChange={(e) => {
            setMessage(e.target.value)
            setPredefinedId(undefined)
          }}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        {(message || icon) && (
          <button
            className="icon-btn small status-input-clear"
            title="Clear the message"
            onClick={() => {
              setMessage('')
              setIcon(null)
              setPredefinedId(undefined)
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="status-suggestions">
        {suggestions.map((s) => (
          <button
            key={s.id ?? s.message}
            className={`status-suggestion${message === s.message && icon === s.icon ? ' on' : ''}`}
            onClick={() => pick(s)}
          >
            <span className="status-suggestion-icon">{s.icon}</span>
            <span className="status-suggestion-text">{s.message}</span>
            <span className="status-suggestion-clear">
              {CLEAR_AFTER.find((c) => c.value === s.clearAfter)?.label}
            </span>
          </button>
        ))}
      </div>

      <label className="field-label">Clear status message after</label>
      <div className="status-clear-row">
        <select
          className="input"
          value={clearAfter}
          disabled={!hasMessage}
          onChange={(e) => {
            const v = e.target.value as ClearAfter
            setClearAfter(v)
            if (v === 'custom' && !custom) setCustom(Math.floor(Date.now() / 1000) + 3600)
          }}
        >
          {CLEAR_AFTER.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {clearAfter === 'custom' && (
          <input
            className="input"
            type="datetime-local"
            disabled={!hasMessage}
            value={custom ? toLocalInput(custom) : ''}
            onChange={(e) => setCustom(fromLocalInput(e.target.value))}
          />
        )}
      </div>
      {hasMessage && (
        <p className="help">
          {customInvalid
            ? 'Choose a time in the future.'
            : clearAt
              ? `Shown ${formatUntil(clearAt)}.`
              : 'The message stays until you clear it.'}
        </p>
      )}

      {emoji && (
        <EmojiPopover
          anchor={emoji}
          onClose={() => setEmoji(null)}
          onSelect={(e) => {
            setIcon(e)
            setPredefinedId(undefined)
            setEmoji(null)
          }}
        />
      )}
    </Modal>
  )
}
