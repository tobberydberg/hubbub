import { describe, expect, it } from 'vitest'
import { splitIcs } from './ics-import'

const file = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'METHOD:PUBLISH',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Stockholm',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:STANDARD',
  'DTSTART:19701101T020000',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:series-1',
  'DTSTART;TZID=Europe/Stockholm:20261201T100000',
  'DTEND;TZID=Europe/Stockholm:20261201T110000',
  'RRULE:FREQ=WEEKLY;COUNT=3',
  'SUMMARY:Weekly',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:series-1',
  'RECURRENCE-ID;TZID=Europe/Stockholm:20261208T100000',
  'DTSTART;TZID=Europe/Stockholm:20261208T120000',
  'DTEND;TZID=Europe/Stockholm:20261208T130000',
  'SUMMARY:Weekly (moved)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261124',
  'SUMMARY:No UID',
  'END:VEVENT',
  'BEGIN:VTODO',
  'UID:todo-1',
  'SUMMARY:A task',
  'END:VTODO',
  'END:VCALENDAR'
].join('\r\n')

describe('splitIcs', () => {
  it('keeps a series with its changed occurrences, and only the time zones it uses', () => {
    const items = splitIcs(file)
    expect(items.map((i) => i.title)).toEqual(['No UID', 'Weekly'])
    const series = items[1]
    expect(series.uid).toBe('series-1')
    expect(series.ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(series.ics).toContain('TZID:Europe/Stockholm')
    expect(series.ics).not.toContain('America/New_York')
    expect(series.ics).not.toContain('METHOD')
  })

  it('gives events without an ID one, and leaves tasks out', () => {
    const items = splitIcs(file)
    expect(items[0].uid).toMatch(/^hubbub-import-/)
    expect(items.some((i) => i.ics.includes('VTODO'))).toBe(false)
  })

  it('refuses what isn’t a calendar', () => {
    expect(() => splitIcs('hello')).toThrow()
  })
})
