// The calendars a meeting can be put in: from a CalDAV PROPFIND of the user's calendar home, the
// calendars that hold events and that the user may write to.

export interface Calendar {
  /** Last part of its URL, which Talk wants as calendarUri */
  uri: string
  name: string
  color?: string
}

/** Elements regardless of their namespace prefix (d:, D:, cal:, x1:, …) */
const element = (name: string, xml: string): string[] =>
  xml.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*?(?:/>|>[\\s\\S]*?</(?:[\\w-]+:)?${name}>)`, 'g')) ?? []

const text = (name: string, xml: string): string =>
  (element(name, xml)[0] ?? '').replace(/^<[^>]*>|<\/[^>]*>$/g, '').trim()

const decode = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

export function parseCalendars(xml: string): Calendar[] {
  const calendars: Calendar[] = []
  for (const response of element('response', xml)) {
    const isCalendar = element('calendar', text('resourcetype', response)).length > 0
    const components = element('comp', response).map((c) => /name="([^"]+)"/.exec(c)?.[1])
    const privileges = text('current-user-privilege-set', response)
    const writable = /<(?:[\w-]+:)?(write|write-content|all)\b/.test(privileges)
    if (!isCalendar || !components.includes('VEVENT') || !writable) continue
    const href = decode(text('href', response)).replace(/\/+$/, '')
    const uri = decodeURIComponent(href.split('/').pop() ?? '')
    if (!uri) continue
    calendars.push({
      uri,
      name: decode(text('displayname', response)) || uri,
      color: text('calendar-color', response) || undefined
    })
  }
  return calendars
}
