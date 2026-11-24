import { useState } from 'react'
import type { Repeat } from '@renderer/lib/ical-edit'
import {
  dayName,
  defaultRule,
  describeRule,
  monthName,
  POSITIONS,
  presetOf,
  presetRule,
  WEEKDAYS,
  type Frequency,
  type Preset,
  type RepeatRule,
  type Weekday
} from '@renderer/lib/repeat'

// How an event repeats: quick choices for the usual cases, and the full rule (every N days, weeks,
// months or years; which weekdays, days or months; until when) for the rest.

interface Props {
  value: Repeat
  /** The event's start, which the quick choices are named after */
  start: number
  disabled?: boolean
  onChange: (value: Repeat) => void
}

const pad = (n: number): string => String(n).padStart(2, '0')
const dateInput = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const ordinal = (n: number): string =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`

export function RepeatEditor({ value, start, disabled, onChange }: Props) {
  const rule = value && value !== 'keep' ? value : null
  const preset: Preset | 'keep' = value === 'keep' ? 'keep' : presetOf(rule, start)
  const [open, setOpen] = useState(preset === 'custom')
  const d = new Date(start)
  const dayLong = dayName(WEEKDAYS[(d.getDay() + 6) % 7])

  const choose = (p: string): void => {
    if (p === 'keep') return
    if (p === 'none') {
      onChange(null)
      setOpen(false)
    } else if (p === 'custom') {
      onChange(rule ?? defaultRule('WEEKLY', start))
      setOpen(true)
    } else {
      onChange(presetRule(p as Exclude<Preset, 'none' | 'custom'>, start))
    }
  }
  const set = (patch: Partial<RepeatRule>): void => {
    if (rule) onChange({ ...rule, ...patch })
  }
  const toggle = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? (list.length > 1 ? list.filter((x) => x !== item) : list) : [...list, item]

  return (
    <div className="repeat">
      <div className="repeat-head">
        <select
          className="input"
          aria-label="Repeat"
          value={open && preset !== 'keep' ? 'custom' : preset}
          disabled={disabled}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="none">Doesn’t repeat</option>
          <option value="daily">Every day</option>
          <option value="weekdays">Every weekday (Monday to Friday)</option>
          <option value="weekly">Every week on {dayLong}</option>
          <option value="monthly">Every month on the {ordinal(d.getDate())}</option>
          <option value="yearly">
            Every year on {d.getDate()} {monthName(d.getMonth() + 1)}
          </option>
          <option value="custom">Custom…</option>
          {preset === 'keep' && <option value="keep">As set in Nextcloud Calendar</option>}
        </select>
        {rule && !open && (
          <button className="btn-link" disabled={disabled} onClick={() => setOpen(true)}>
            More options
          </button>
        )}
      </div>
      {preset === 'keep' && (
        <p className="help">
          This event repeats in a way Hubbub can’t show; it stays as it is unless you change it.
        </p>
      )}

      {rule && open && (
        <div className="repeat-box">
          <div className="repeat-row">
            <span>Every</span>
            <input
              className="input repeat-number"
              type="number"
              min={1}
              max={99}
              aria-label="Interval"
              value={rule.interval}
              onChange={(e) => set({ interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
            />
            <select
              className="input repeat-unit"
              aria-label="Unit"
              value={rule.freq}
              onChange={(e) => {
                const freq = e.target.value as Frequency
                onChange({
                  ...defaultRule(freq, start),
                  interval: rule.interval,
                  end: rule.end,
                  count: rule.count,
                  until: rule.until
                })
              }}
            >
              <option value="DAILY">{rule.interval > 1 ? 'days' : 'day'}</option>
              <option value="WEEKLY">{rule.interval > 1 ? 'weeks' : 'week'}</option>
              <option value="MONTHLY">{rule.interval > 1 ? 'months' : 'month'}</option>
              <option value="YEARLY">{rule.interval > 1 ? 'years' : 'year'}</option>
            </select>
          </div>

          {rule.freq === 'WEEKLY' && (
            <div className="repeat-row">
              <span>On</span>
              <div className="repeat-days" role="group" aria-label="Weekdays">
                {WEEKDAYS.map((w) => (
                  <button
                    key={w}
                    className={rule.byDay.includes(w) ? 'on' : ''}
                    aria-pressed={rule.byDay.includes(w)}
                    title={dayName(w)}
                    onClick={() => set({ byDay: toggle(rule.byDay, w) })}
                  >
                    {dayName(w).slice(0, 2)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {rule.freq === 'YEARLY' && (
            <div className="repeat-row top">
              <span>In</span>
              <div className="repeat-months" role="group" aria-label="Months">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <button
                    key={m}
                    className={rule.byMonth.includes(m) ? 'on' : ''}
                    aria-pressed={rule.byMonth.includes(m)}
                    onClick={() => set({ byMonth: toggle(rule.byMonth, m) })}
                  >
                    {monthName(m).slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') && (
            <div className="repeat-choice">
              <label className="repeat-radio">
                <input
                  type="radio"
                  name="repeat-month-mode"
                  checked={rule.monthMode === 'day'}
                  onChange={() => set({ monthMode: 'day' })}
                />
                {rule.freq === 'YEARLY' ? `On the ${ordinal(d.getDate())}` : 'On these days'}
              </label>
              {rule.freq === 'MONTHLY' && rule.monthMode === 'day' && (
                <div className="repeat-monthdays" role="group" aria-label="Days of the month">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      className={rule.byMonthDay.includes(n) ? 'on' : ''}
                      aria-pressed={rule.byMonthDay.includes(n)}
                      onClick={() => set({ byMonthDay: toggle(rule.byMonthDay, n) })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
              <label className="repeat-radio">
                <input
                  type="radio"
                  name="repeat-month-mode"
                  checked={rule.monthMode === 'weekday'}
                  onChange={() => set({ monthMode: 'weekday' })}
                />
                On the
                <select
                  className="input repeat-inline"
                  aria-label="Which"
                  value={rule.setPos}
                  onChange={(e) => set({ monthMode: 'weekday', setPos: Number(e.target.value) })}
                >
                  {POSITIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <select
                  className="input repeat-inline"
                  aria-label="Weekday"
                  value={rule.weekday}
                  onChange={(e) => set({ monthMode: 'weekday', weekday: e.target.value as Weekday })}
                >
                  {WEEKDAYS.map((w) => (
                    <option key={w} value={w}>
                      {dayName(w)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="repeat-choice">
            <span className="repeat-label">Ends</span>
            <label className="repeat-radio">
              <input
                type="radio"
                name="repeat-end"
                checked={rule.end === 'never'}
                onChange={() => set({ end: 'never' })}
              />
              Never
            </label>
            <label className="repeat-radio">
              <input
                type="radio"
                name="repeat-end"
                checked={rule.end === 'count'}
                onChange={() => set({ end: 'count' })}
              />
              After
              <input
                className="input repeat-number"
                type="number"
                min={1}
                max={999}
                aria-label="Number of times"
                value={rule.count}
                onChange={(e) => set({ end: 'count', count: Math.max(1, Number(e.target.value) || 1) })}
              />
              times
            </label>
            <label className="repeat-radio">
              <input
                type="radio"
                name="repeat-end"
                checked={rule.end === 'until'}
                onChange={() =>
                  set({
                    end: 'until',
                    until: rule.until ?? new Date(d.getFullYear(), d.getMonth() + 3, d.getDate()).getTime()
                  })
                }
              />
              On
              <input
                className="input repeat-date"
                type="date"
                aria-label="Last day"
                value={rule.until !== null ? dateInput(rule.until) : ''}
                min={dateInput(start)}
                onChange={(e) => {
                  const t = new Date(`${e.target.value}T00:00`).getTime()
                  if (!Number.isNaN(t)) set({ end: 'until', until: t })
                }}
              />
            </label>
          </div>

          <p className="repeat-summary">{describeRule(rule, start)}</p>
        </div>
      )}
      {rule && !open && <p className="help repeat-summary-inline">{describeRule(rule, start)}</p>}
    </div>
  )
}
