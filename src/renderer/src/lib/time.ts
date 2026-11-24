// Choices like "In 1 hour" or "Tomorrow at 9:00" for reminders and scheduled messages.

export interface TimeChoice {
  label: string
  /** Unix seconds */
  at: number
}

const MORNING = 9

function atHour(day: Date, hour: number): Date {
  const d = new Date(day)
  d.setHours(hour, 0, 0, 0)
  return d
}

const seconds = (d: Date): number => Math.floor(d.getTime() / 1000)

export function laterChoices(now = new Date()): TimeChoice[] {
  const tomorrow = atHour(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), MORNING)
  // Next Monday, a week ahead when today is Monday
  const daysToMonday = (8 - now.getDay()) % 7 || 7
  const monday = atHour(new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToMonday), MORNING)
  const base = seconds(now)
  return [
    { label: 'In 20 minutes', at: base + 20 * 60 },
    { label: 'In 1 hour', at: base + 60 * 60 },
    { label: 'In 3 hours', at: base + 3 * 60 * 60 },
    { label: `Tomorrow at ${MORNING}:00`, at: seconds(tomorrow) },
    { label: `Monday at ${MORNING}:00`, at: seconds(monday) }
  ]
}

/** What a choice adds to its label: the time for "In 20 minutes", the date for "Monday at 9:00" */
export function choiceHint(c: TimeChoice, now = new Date()): string | undefined {
  const at = formatAt(c.at, now)
  return c.label.startsWith('In ') ? at.replace(/^(Today|Tomorrow) /, '') : at.match(/^(.*), /)?.[1]
}

/** "Today 14:35", "Tomorrow 9:00", "Mon 24 Nov, 9:00" */
export function formatAt(unix: number, now = new Date()): string {
  const d = new Date(unix * 1000)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(now)) / 86_400_000)
  if (diff === 0) return `Today ${time}`
  if (diff === 1) return `Tomorrow ${time}`
  const date = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  return `${date}, ${time}`
}

/** Value for <input type="datetime-local"> */
export function toLocalInput(unix: number): string {
  const d = new Date(unix * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): number | null {
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : Math.floor(t / 1000)
}
