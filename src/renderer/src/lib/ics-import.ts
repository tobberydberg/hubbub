import ICAL from 'ical.js'

// An .ics file split into the events a calendar stores one by one: each event (a series with its
// changed occurrences) with the time zones it uses, as its own calendar object.

export interface ImportItem {
  uid: string
  title: string
  /** ms; 0 when it has no start */
  start: number
  ics: string
}

/** The events in an iCalendar file; throws when it isn't one */
export function splitIcs(text: string): ImportItem[] {
  const root = new ICAL.Component(ICAL.parse(text))
  if (root.name !== 'vcalendar') throw new Error('Not a calendar file')
  const zones = root.getAllSubcomponents('vtimezone')
  const byUid = new Map<string, ICAL.Component[]>()
  for (const v of root.getAllSubcomponents('vevent')) {
    let uid = v.getFirstPropertyValue('uid')?.toString()
    if (!uid) {
      uid = `hubbub-import-${crypto.randomUUID()}`
      v.updatePropertyWithValue('uid', uid)
    }
    byUid.set(uid, [...(byUid.get(uid) ?? []), v])
  }
  const items: ImportItem[] = []
  for (const [uid, events] of byUid) {
    const cal = new ICAL.Component('vcalendar')
    cal.addPropertyWithValue('prodid', '-//Hubbub//Hubbub Calendar//EN')
    cal.addPropertyWithValue('version', '2.0')
    // Only the time zones its times are in
    const used = new Set<string>()
    for (const e of events) {
      for (const p of e.getAllProperties()) {
        const tzid = p.getParameter('tzid')
        if (typeof tzid === 'string') used.add(tzid)
      }
    }
    for (const z of zones) {
      if (used.has(String(z.getFirstPropertyValue('tzid'))))
        cal.addSubcomponent(new ICAL.Component(ICAL.helpers.clone(z.toJSON(), true)))
    }
    for (const e of events) cal.addSubcomponent(new ICAL.Component(ICAL.helpers.clone(e.toJSON(), true)))
    const master = events.find((e) => !e.hasProperty('recurrence-id')) ?? events[0]
    const event = new ICAL.Event(master)
    items.push({
      uid,
      title: event.summary || 'Untitled event',
      start: event.startDate ? event.startDate.toJSDate().getTime() : 0,
      ics: cal.toString()
    })
  }
  return items.sort((a, b) => a.start - b.start)
}
