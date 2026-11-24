// Repeat rules (iCalendar RRULE) as the event dialog edits them: every N days, weeks, months or
// years; on chosen weekdays, days of the month, or "the second Tuesday"; in chosen months; ending
// never, after a number of times or on a date. Rules this can't express are kept as they are.

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

export const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

export interface RepeatRule {
  freq: Frequency
  /** Every `interval` days, weeks, … */
  interval: number
  /** Weekly: the days of the week */
  byDay: Weekday[]
  /** Monthly and yearly: on days of the month, or on "the second Tuesday" */
  monthMode: 'day' | 'weekday'
  /** Monthly, monthMode 'day': days of the month (yearly uses the event's own day) */
  byMonthDay: number[]
  /** monthMode 'weekday': 1–4 for first to fourth, -1 for last */
  setPos: number
  weekday: Weekday
  /** Yearly: months, 1–12 */
  byMonth: number[]
  end: 'never' | 'count' | 'until'
  count: number
  /** The last day (local midnight), for end 'until' */
  until: number | null
}

/** JS getDay() (Sunday 0) to iCalendar weekday */
export const weekdayOf = (ms: number): Weekday => WEEKDAYS[(new Date(ms).getDay() + 6) % 7]

/** Which of its weekday a date is in its month: 1–4, or -1 when it is the last one */
export function setPosOf(ms: number): number {
  const d = new Date(ms)
  const nth = Math.ceil(d.getDate() / 7)
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return d.getDate() + 7 > daysInMonth ? -1 : Math.min(nth, 4)
}

/** A rule repeating with `freq`, fitted to the event's start date */
export function defaultRule(freq: Frequency, start: number): RepeatRule {
  const d = new Date(start)
  return {
    freq,
    interval: 1,
    byDay: [weekdayOf(start)],
    monthMode: 'day',
    byMonthDay: [d.getDate()],
    setPos: setPosOf(start),
    weekday: weekdayOf(start),
    byMonth: [d.getMonth() + 1],
    end: 'never',
    count: 10,
    until: null
  }
}

export type Preset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom'

export function presetRule(preset: Exclude<Preset, 'none' | 'custom'>, start: number): RepeatRule {
  if (preset === 'weekdays') return { ...defaultRule('WEEKLY', start), byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }
  const freq = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' } as const
  return defaultRule(freq[preset], start)
}

/** Which quick choice a rule is, for the dropdown; 'custom' when none */
export function presetOf(rule: RepeatRule | null, start: number): Preset {
  if (!rule) return 'none'
  const same = (p: Exclude<Preset, 'none' | 'custom'>): boolean =>
    toRRule(rule, false) === toRRule(presetRule(p, start), false)
  return (['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const).find(same) ?? 'custom'
}

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * The rule as RRULE text. The end date is the last day itself: for all-day events a date, else the
 * end of that day as UTC (which RFC 5545 requires next to a start with a time zone).
 */
export function toRRule(rule: RepeatRule, allDay: boolean): string {
  const parts = [`FREQ=${rule.freq}`]
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`)
  if (rule.freq === 'WEEKLY') parts.push(`BYDAY=${sortDays(rule.byDay).join(',')}`)
  if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
    if (rule.freq === 'YEARLY') parts.push(`BYMONTH=${[...rule.byMonth].sort((a, b) => a - b).join(',')}`)
    if (rule.monthMode === 'weekday') parts.push(`BYDAY=${rule.weekday}`, `BYSETPOS=${rule.setPos}`)
    else if (rule.freq === 'MONTHLY')
      parts.push(`BYMONTHDAY=${[...rule.byMonthDay].sort((a, b) => a - b).join(',')}`)
  }
  if (rule.end === 'count') parts.push(`COUNT=${Math.max(1, rule.count)}`)
  if (rule.end === 'until' && rule.until !== null) {
    const d = new Date(rule.until)
    if (allDay) parts.push(`UNTIL=${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`)
    else {
      const last = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)
      parts.push(
        `UNTIL=${last
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d{3}Z$/, 'Z')}`
      )
    }
  }
  return parts.join(';')
}

const sortDays = (days: Weekday[]): Weekday[] => WEEKDAYS.filter((d) => days.includes(d))

/** An UNTIL value as the local day it ends on */
function untilDay(value: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(value)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  const at = h
    ? z
      ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
      : new Date(+y, +mo - 1, +d, +h, +mi, +s)
    : new Date(+y, +mo - 1, +d)
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
}

/**
 * RRULE text as the dialog edits it, or null when it uses something the dialog doesn't offer
 * (hourly rules, BYWEEKNO, several weekday positions, …) and has to be kept as it is.
 */
export function fromRRule(text: string, start: number): RepeatRule | null {
  const parts = new Map<string, string>()
  for (const p of text.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = p.split('=')
    if (k && v !== undefined) parts.set(k.toUpperCase(), v.toUpperCase())
  }
  const freq = parts.get('FREQ') as Frequency
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null
  const known = new Set([
    'FREQ',
    'INTERVAL',
    'BYDAY',
    'BYMONTHDAY',
    'BYMONTH',
    'BYSETPOS',
    'COUNT',
    'UNTIL',
    'WKST'
  ])
  if ([...parts.keys()].some((k) => !known.has(k))) return null

  const rule = defaultRule(freq, start)
  rule.interval = Math.max(1, Number(parts.get('INTERVAL') ?? 1) || 1)
  const byDay = parts.get('BYDAY')?.split(',') ?? []
  const setPos = parts.get('BYSETPOS')

  if (freq === 'DAILY' && (byDay.length || parts.has('BYMONTHDAY') || parts.has('BYMONTH'))) return null
  if (freq === 'WEEKLY') {
    if (parts.has('BYMONTHDAY') || parts.has('BYMONTH') || setPos) return null
    if (byDay.length) {
      if (byDay.some((d) => !WEEKDAYS.includes(d as Weekday))) return null
      rule.byDay = byDay as Weekday[]
    }
  }
  if (freq === 'MONTHLY' || freq === 'YEARLY') {
    if (freq === 'YEARLY') {
      const months = parts.get('BYMONTH')?.split(',').map(Number)
      if (months?.some((m) => !(m >= 1 && m <= 12))) return null
      if (months?.length) rule.byMonth = months
    } else if (parts.has('BYMONTH')) return null
    if (byDay.length) {
      // "2TU" or "TU" with BYSETPOS=2: one weekday position only
      if (byDay.length !== 1) return null
      const m = /^(-?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay[0])
      const pos = Number(m?.[1] ?? setPos)
      if (!m || !(pos === -1 || (pos >= 1 && pos <= 4)) || parts.has('BYMONTHDAY')) return null
      rule.monthMode = 'weekday'
      rule.weekday = m[2] as Weekday
      rule.setPos = pos
    } else if (setPos) {
      return null
    } else if (parts.has('BYMONTHDAY')) {
      const days = parts.get('BYMONTHDAY')!.split(',').map(Number)
      if (days.some((d) => !(d >= 1 && d <= 31)) || freq === 'YEARLY') return null
      rule.byMonthDay = days
    }
  }
  if (parts.has('COUNT')) {
    rule.end = 'count'
    rule.count = Math.max(1, Number(parts.get('COUNT')) || 1)
  } else if (parts.has('UNTIL')) {
    const until = untilDay(parts.get('UNTIL')!)
    if (until === null) return null
    rule.end = 'until'
    rule.until = until
  }
  return rule
}

const DAY_NAMES: Record<Weekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday'
}
export const dayName = (d: Weekday): string => DAY_NAMES[d]
export const POSITIONS: { value: number; label: string }[] = [
  { value: 1, label: 'first' },
  { value: 2, label: 'second' },
  { value: 3, label: 'third' },
  { value: 4, label: 'fourth' },
  { value: -1, label: 'last' }
]

const list = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
const ordinal = (n: number): string => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${s}`
}
export const monthName = (m: number): string =>
  new Date(2000, m - 1, 1).toLocaleDateString(undefined, { month: 'long' })

/** The rule in words: "Every 2 weeks on Monday and Wednesday, until 31 Dec 2026" */
export function describeRule(rule: RepeatRule, start: number): string {
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[rule.freq]
  let text = rule.interval > 1 ? `Every ${rule.interval} ${unit}s` : `Every ${unit}`
  const weekdays = sortDays(rule.byDay)
  if (rule.freq === 'WEEKLY') {
    text =
      weekdays.join() === 'MO,TU,WE,TH,FR' && rule.interval === 1
        ? 'Every weekday'
        : `${text} on ${list(weekdays.map(dayName))}`
  }
  const position = (): string =>
    `the ${POSITIONS.find((p) => p.value === rule.setPos)?.label} ${dayName(rule.weekday)}`
  if (rule.freq === 'MONTHLY') {
    text += ` on ${rule.monthMode === 'weekday' ? position() : `the ${list([...rule.byMonthDay].sort((a, b) => a - b).map(ordinal))}`}`
  }
  if (rule.freq === 'YEARLY') {
    const months = [...rule.byMonth].sort((a, b) => a - b).map(monthName)
    text +=
      rule.monthMode === 'weekday'
        ? ` on ${position()} of ${list(months)}`
        : ` on ${list(months.map((m) => `${new Date(start).getDate()} ${m}`))}`
  }
  if (rule.end === 'count') text += `, ${rule.count} ${rule.count === 1 ? 'time' : 'times'}`
  if (rule.end === 'until' && rule.until !== null) {
    text += `, until ${new Date(rule.until).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
  }
  return text
}
