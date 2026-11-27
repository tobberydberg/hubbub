import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { sharedOptions, toolTypes, type SharedOption, type TaskType } from '@renderer/lib/ai-tasks'
import { useApp } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import { aiTaskTypes, assistantVersion } from '@renderer/sync/ai'
import { showAssistant } from '@renderer/sync/assistant'

// Settings → AI: per server, what its AI can do and the choices it leaves to you (with the OpenAI
// integration: the model and the answer length), used for everything Hubbub asks it.

export function AiSettings({ onClose }: { onClose: () => void }) {
  const ids = useApp((s) => s.accountOrder)
  const accounts = useApp((s) => s.accounts)
  const online = ids.filter((id) => accounts[id]?.status === 'online')
  if (!online.length) return <p className="help">Connect to a server to see what its AI can do.</p>
  return (
    <>
      {online.map((id) => (
        <ServerAi
          key={id}
          accountId={id}
          label={online.length > 1 ? accounts[id]!.info.label : undefined}
          onClose={onClose}
        />
      ))}
    </>
  )
}

function ServerAi({ accountId, label, onClose }: { accountId: string; label?: string; onClose: () => void }) {
  const [types, setTypes] = useState<Record<string, TaskType> | null>(null)
  const [assistant, setAssistant] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const options = usePrefs((s) => s.aiOptions[accountId])

  useEffect(() => {
    let current = true
    const fresh = reload > 0
    void aiTaskTypes(accountId, fresh).then((t) => current && setTypes(t))
    void assistantVersion(accountId, fresh).then((v) => current && setAssistant(v))
    return () => {
      current = false
    }
  }, [accountId, reload])

  const set = (key: string, value: string | number | undefined): void => {
    const all = usePrefs.getState().aiOptions
    const next = { ...all[accountId] }
    if (value === undefined || value === '') delete next[key]
    else next[key] = value
    usePrefs.getState().set({ aiOptions: { ...all, [accountId]: next } })
  }

  const tools = types ? toolTypes(types) : []
  const shared = types ? sharedOptions(types) : []

  return (
    <div className="ai-settings">
      <div className="ai-settings-head">
        {label && <div className="sr-title">{label}</div>}
        <button
          className="btn btn-tertiary small"
          title="Ask the server again"
          onClick={() => setReload((r) => r + 1)}
        >
          <RefreshCw size={13} /> Check again
        </button>
      </div>
      {!types ? (
        <p className="help">Asking the server…</p>
      ) : !tools.length ? (
        <p className="help">
          This server has no AI set up. An administrator can add one, such as Nextcloud Assistant with a local
          model, or the OpenAI and LocalAI integration with any OpenAI-compatible service.
        </p>
      ) : (
        <>
          {shared.length ? (
            shared.map((o) => (
              <OptionRow key={o.key} option={o} value={options?.[o.key]} onChange={(v) => set(o.key, v)} />
            ))
          ) : (
            <p className="help">
              Your server’s AI doesn’t let you choose a model: the administrator chooses it for each kind of
              task.
            </p>
          )}
          <div className="setting-row">
            <div className="sr-label">
              <div className="sr-title">What it can do</div>
              <div className="sr-sub">
                {assistant !== null ? (
                  <>Chat with AI (Nextcloud Assistant {assistant}), and </>
                ) : (
                  <>No chat (that needs Nextcloud Assistant on the server). </>
                )}
                {tools.length} tools: {tools.map((t) => t.name).join(', ')}.
              </div>
            </div>
            <button
              className="btn btn-tertiary small"
              onClick={() => {
                onClose()
                showAssistant(accountId)
              }}
            >
              Open
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const HELP: Record<string, string> = {
  model:
    'Used for writing help, translations, thread summaries and Ask AI, wherever the task offers it. The summary of unread messages is made by Talk, with the server’s default.',
  max_tokens:
    'How long an answer may be, up to the limit your administrator set. Raise it when answers come back empty or cut off: reasoning models spend part of it on thinking.'
}

function OptionRow({
  option,
  value,
  onChange
}: {
  option: SharedOption
  value: string | number | undefined
  onChange: (value: string | number | undefined) => void
}) {
  const fallback = option.serverDefault !== undefined ? ` (${option.serverDefault})` : ''
  return (
    <div className="setting-row">
      <div className="sr-label">
        <div className="sr-title">{option.name}</div>
        <div className="sr-sub">{HELP[option.key] ?? option.description}</div>
      </div>
      {option.type === 'Enum' ? (
        <select
          className="input ai-option"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Server’s default{fallback}</option>
          {option.values.map((v) => (
            <option key={v.value} value={v.value}>
              {v.name}
            </option>
          ))}
        </select>
      ) : (
        <NumberOption
          value={typeof value === 'number' ? value : undefined}
          placeholder={option.serverDefault !== undefined ? String(option.serverDefault) : 'Server’s default'}
          onChange={onChange}
        />
      )}
    </div>
  )
}

function NumberOption({
  value,
  placeholder,
  onChange
}: {
  value: number | undefined
  placeholder: string
  onChange: (value: number | undefined) => void
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  const commit = (): void => {
    const n = Math.round(Number(draft))
    if (!draft.trim() || !Number.isFinite(n) || n <= 0) {
      setDraft('')
      onChange(undefined)
    } else {
      setDraft(String(n))
      onChange(n)
    }
  }
  return (
    <input
      className="input ai-option"
      type="number"
      min={1}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}
