import { useState } from 'react'
import { ChevronDown, ChevronRight, Play, Square, X } from 'lucide-react'
import { stageText, isFileShape, isListShape, type Shape, type TaskType } from '@renderer/lib/ai-tasks'
import { updateAssistant, useAssistant, type ToolRun } from '@renderer/store/assistant'
import { usePrefs } from '@renderer/store/prefs'
import { openPage, runTool, stopRun } from '@renderer/sync/assistant'
import { MessageText } from '../channel/MessageText'
import { FileField, type PickedFile } from './FileField'
import { TaskOutput } from './TaskOutput'

// One of the server's AI tools (summarize, generate an image, transcribe, …): a form made from what
// the task takes, its other options under "More options" (with the OpenAI integration: the model and
// the answer length), and what it gave.

type FormValue = string | number | PickedFile | PickedFile[] | undefined

export function ToolPane({
  accountId,
  type: typeId,
  runId
}: {
  accountId: string
  type: string
  runId?: string
}) {
  const type = useAssistant((s) => s.accounts[accountId]?.types?.[typeId])
  const form = useAssistant((s) => s.accounts[accountId]?.forms[typeId]) ?? {}
  const run = useAssistant((s) => {
    const runs = s.accounts[accountId]?.runs ?? []
    return runId ? runs.find((r) => r.id === runId) : runs.find((r) => r.type === typeId)
  })
  const hasAssistant = useAssistant((s) => typeof s.accounts[accountId]?.assistant === 'string')
  const chosen = usePrefs((s) => s.aiOptions[accountId])
  const [more, setMore] = useState(false)
  const [notify, setNotify] = useState(false)

  if (!type) {
    return (
      <main className="center ai-pane">
        <div className="empty-state">
          <p>This tool isn’t offered by the server any more.</p>
        </div>
      </main>
    )
  }

  const set = (key: string, value: FormValue): void =>
    updateAssistant(accountId, (a) => {
      const f = (a.forms[typeId] ??= {})
      if (value === undefined || value === '') delete f[key]
      else f[key] = value
    })
  const valueOf = (key: string, optional: boolean): FormValue => {
    const v = form[key] as FormValue
    if (v !== undefined || optional) return v
    const d = type.inputShapeDefaults?.[key]
    return typeof d === 'string' || typeof d === 'number' ? d : undefined
  }

  const required = Object.entries(type.inputShape)
  const optional = Object.entries(type.optionalInputShape ?? {})
  const missing = required.some(([key, shape]) => {
    const v = valueOf(key, false)
    if (isFileShape(shape)) return !v || (Array.isArray(v) && !v.length)
    return v === undefined || v === '' || (typeof v === 'string' && !v.trim())
  })
  const running = run && (run.status === 'starting' || run.status === 'waiting')

  const start = (): void => {
    const input: Record<string, unknown> = {}
    const add = (key: string, shape: Shape, v: FormValue): void => {
      if (v !== undefined && v !== '') input[key] = toInput(shape, v)
    }
    for (const [key, shape] of required) add(key, shape, valueOf(key, false))
    for (const [key, shape] of optional) add(key, shape, valueOf(key, true))
    void runTool(accountId, typeId, input, notify)
  }

  const textInput = required.find(([, s]) => s.type === 'Text')?.[0]
  const outputText = run?.task?.output?.output

  return (
    <main className="center ai-pane">
      <div className="channel-header">
        <div className="ch-main">
          <div className="ch-title-row">
            <span className="ch-title">{type.name}</span>
          </div>
          {type.description && <div className="ch-meta">{type.description}</div>}
        </div>
      </div>
      <div className="ai-tool-scroll">
        <div className="ai-tool">
          {required.map(([key, shape]) => (
            <Field
              key={key}
              accountId={accountId}
              shape={shape}
              values={type.inputShapeEnumValues?.[key]}
              value={valueOf(key, false)}
              onChange={(v) => set(key, v)}
              autoFocus={key === textInput}
            />
          ))}
          {optional.length > 0 && (
            <>
              <button className="ai-more" onClick={() => setMore(!more)}>
                {more ? <ChevronDown size={14} /> : <ChevronRight size={14} />} More options
              </button>
              {more &&
                optional.map(([key, shape]) => (
                  <Field
                    key={key}
                    accountId={accountId}
                    shape={shape}
                    values={type.optionalInputShapeEnumValues?.[key]}
                    value={valueOf(key, true)}
                    onChange={(v) => set(key, v)}
                    fallback={defaultText(type, key, chosen?.[key])}
                  />
                ))}
            </>
          )}
          <div className="ai-run-row">
            {hasAssistant && (
              <label className="ai-notify">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                Notify me in Nextcloud when it’s done
              </label>
            )}
            {running ? (
              <button className="btn btn-tertiary" onClick={() => void stopRun(accountId, run.id)}>
                <Square size={13} fill="currentColor" /> Stop
              </button>
            ) : (
              <button className="btn btn-primary" disabled={missing} onClick={start}>
                <Play size={14} /> Run
              </button>
            )}
          </div>

          {run && (
            <RunResult
              accountId={accountId}
              run={run}
              type={type}
              canSave={hasAssistant}
              onUseAsInput={
                textInput && typeof outputText === 'string' && run.status === 'done'
                  ? () => set(textInput, outputText)
                  : undefined
              }
            />
          )}
          {run && (
            <button
              className="link-btn ai-history-link"
              onClick={() => openPage(accountId, { kind: 'history' })}
            >
              All earlier results
            </button>
          )}
        </div>
      </div>
    </main>
  )
}

function RunResult({
  accountId,
  run,
  type,
  canSave,
  onUseAsInput
}: {
  accountId: string
  run: ToolRun
  type: TaskType
  canSave: boolean
  onUseAsInput?: () => void
}) {
  return (
    <div className="ai-result">
      <div className="ai-result-head">
        Result
        <span className="ai-result-when">
          {new Date(run.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      </div>
      {run.status === 'failed' ? (
        <p className="ai-error">{run.error}</p>
      ) : run.status === 'done' && run.task ? (
        <>
          <TaskOutput accountId={accountId} task={run.task} type={type} canSave={canSave} />
          {onUseAsInput && (
            <button className="btn btn-tertiary small" onClick={onUseAsInput}>
              Use it as the input
            </button>
          )}
          <p className="ai-note">Made by AI on your Nextcloud server. Check anything important.</p>
        </>
      ) : run.partial ? (
        <MessageText markdown={run.partial} className="ai-output-text writing" />
      ) : (
        <div className="ai-wait">
          <span className="ai-dots">
            <i />
            <i />
            <i />
          </span>
          {stageText(run.stage)}
        </div>
      )}
    </div>
  )
}

/** "Default: …" for an option left empty: what's chosen in Settings → AI, else the server's own */
function defaultText(type: TaskType, key: string, chosen: string | number | undefined): string {
  const values = type.optionalInputShapeEnumValues?.[key]
  const name = (v: unknown): string => values?.find((x) => x.value === v)?.name ?? String(v)
  if (chosen !== undefined && (!values || values.some((v) => v.value === chosen))) {
    return `${name(chosen)} (your choice in Settings → AI)`
  }
  const d = type.optionalInputShapeDefaults?.[key]
  return d === undefined || d === null || d === ''
    ? 'The server’s default'
    : `${name(d)} (the server’s default)`
}

function toInput(shape: Shape, value: FormValue): unknown {
  if (isFileShape(shape)) {
    const files = Array.isArray(value) ? value : [value as PickedFile]
    const list = files.map((f) => f.fileId)
    return isListShape(shape) ? list : list[0]
  }
  if (shape.type === 'Number') return Number(value)
  if (shape.type === 'ListOfText') {
    return String(value)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return value
}

function Field({
  accountId,
  shape,
  values,
  value,
  onChange,
  fallback,
  autoFocus
}: {
  accountId: string
  shape: Shape
  values?: { name: string; value: string }[]
  value: FormValue
  onChange: (value: FormValue) => void
  /** For an optional input: what's used when it's left empty */
  fallback?: string
  autoFocus?: boolean
}) {
  const label = (
    <label className="ai-field-label" title={shape.description}>
      {shape.name}
    </label>
  )
  const help = shape.description && shape.description !== shape.name && (
    <div className="help">{shape.description}</div>
  )
  if (isFileShape(shape)) {
    return (
      <div className="field">
        {label}
        <FileField
          accountId={accountId}
          shape={shape}
          value={value as PickedFile | PickedFile[] | undefined}
          onChange={(v) => onChange(v)}
        />
        {help}
      </div>
    )
  }
  if (shape.type === 'Enum') {
    return (
      <div className="field">
        {label}
        <select
          className="input"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          {(fallback !== undefined || value === undefined) && (
            <option value="">{fallback ?? 'Choose…'}</option>
          )}
          {(values ?? []).map((v) => (
            <option key={v.value} value={v.value}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
    )
  }
  if (shape.type === 'Number') {
    return (
      <div className="field">
        {label}
        <input
          className="input ai-number"
          type="number"
          value={value === undefined ? '' : String(value)}
          placeholder={fallback}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
        {help}
      </div>
    )
  }
  // Text, and lists of text one per line
  const long = shape.type === 'ListOfText' || fallback === undefined
  return (
    <div className="field">
      {label}
      {long ? (
        <textarea
          className="input ai-textarea"
          autoFocus={autoFocus}
          rows={shape.type === 'ListOfText' ? 4 : 6}
          value={typeof value === 'string' ? value : value === undefined ? '' : String(value)}
          placeholder={shape.type === 'ListOfText' ? 'One per line' : shape.description}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="ai-input-row">
          <input
            className="input"
            value={typeof value === 'string' ? value : ''}
            placeholder={fallback}
            onChange={(e) => onChange(e.target.value)}
          />
          {value !== undefined && (
            <button className="icon-btn small" title="Clear" onClick={() => onChange(undefined)}>
              <X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
