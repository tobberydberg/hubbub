import { useState } from 'react'
import { AlertTriangle, ShieldQuestion } from 'lucide-react'
import type { AgentAction } from '@renderer/api/assistant'
import { answerAgent } from '@renderer/sync/assistant'

// The agent (Nextcloud's Context Agent) asks before it acts for you: what it wants to do, with what,
// who it affects and whether it can be undone, as the web Assistant shows it. Nothing happens until
// you say so; writing another message instead means "don't".

const RADIUS: Record<string, string> = {
  self: 'Only affects you',
  individuals: 'Affects specific other people',
  group: 'Affects a group or team',
  external: 'Reaches people or services outside your Nextcloud'
}
const RADII = Object.keys(RADIUS)

/** An argument's value, short */
function show(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** "calendar_name" → "Calendar name" */
const argName = (key: string): string => {
  const s = key.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function AgentConfirm({
  accountId,
  sessionId,
  actions
}: {
  accountId: string
  sessionId: number
  actions: AgentAction[]
}) {
  const [open, setOpen] = useState<number | null>(null)
  const destructive = actions.some((a) => a.destructive)
  const irreversible = actions.some((a) => a.reversibility === 'irreversible')
  const widest = actions.reduce((max, a) => {
    if (!a.impulse_radius) return max
    const i = RADII.indexOf(a.impulse_radius)
    return Math.max(max, i === -1 ? RADII.length - 1 : i)
  }, -1)
  const items = actions.reduce((n, a) => n + (a.item_count ?? 0), 0)
  const warn = destructive || irreversible || widest >= 2

  return (
    <div className={`ai-confirm${warn ? ' warn' : ''}`}>
      <div className="ai-confirm-head">
        {warn ? <AlertTriangle size={16} /> : <ShieldQuestion size={16} />}
        The assistant wants to do this for you:
      </div>
      <ul className="ai-actions">
        {actions.map((a, i) => {
          const args = Object.entries(a.args ?? {}).filter(([, v]) => show(v) !== '')
          const shown = open === i ? args : args.slice(0, 3)
          return (
            <li key={i}>
              {/* The Assistant names the tools it knows; the rest come as delete_calendar_event */}
              <strong>{/_/.test(a.name) ? argName(a.name) : a.name}</strong>
              {shown.map(([k, v]) => (
                <div key={k} className="ai-action-arg" title={show(v)}>
                  <span>{argName(k)}:</span> {show(v)}
                </div>
              ))}
              {args.length > 3 && (
                <button className="link-btn" onClick={() => setOpen(open === i ? null : i)}>
                  {open === i ? 'Less' : `${args.length - 3} more`}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {(widest >= 0 || destructive || irreversible || items > 1) && (
        <ul className="ai-confirm-notes">
          {widest >= 0 && <li>{RADIUS[RADII[widest]]}</li>}
          {destructive && <li>Deletes or overwrites something</li>}
          {irreversible && <li>Can’t be undone</li>}
          {items > 1 && <li>{items} items affected</li>}
        </ul>
      )}
      <div className="ai-confirm-buttons">
        <button className="btn btn-tertiary" onClick={() => void answerAgent(accountId, sessionId, false)}>
          Don’t
        </button>
        <button
          className={`btn ${destructive || irreversible ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => void answerAgent(accountId, sessionId, true)}
        >
          Do it
        </button>
      </div>
    </div>
  )
}
