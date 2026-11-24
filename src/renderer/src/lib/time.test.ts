import { describe, expect, it } from 'vitest'
import { choiceHint, formatAt, fromLocalInput, laterChoices, toLocalInput } from './time'

describe('laterChoices', () => {
  it('offers the next morning and the next Monday at 9:00', () => {
    // Wednesday 26 November 2025, 14:00 local time
    const now = new Date(2025, 10, 26, 14, 0)
    const choices = laterChoices(now)
    const at = (label: string): Date => new Date(choices.find((c) => c.label === label)!.at * 1000)
    expect(at('In 1 hour').getHours()).toBe(15)
    expect(at('Tomorrow at 9:00')).toEqual(new Date(2025, 10, 27, 9, 0))
    expect(at('Monday at 9:00')).toEqual(new Date(2025, 11, 1, 9, 0))
  })

  it('picks the Monday a week ahead on a Monday', () => {
    const now = new Date(2025, 11, 1, 8, 0)
    const monday = laterChoices(now).find((c) => c.label === 'Monday at 9:00')!
    expect(new Date(monday.at * 1000)).toEqual(new Date(2025, 11, 8, 9, 0))
  })
})

describe('choiceHint', () => {
  it('adds the time to relative choices and the date to Monday, nothing to tomorrow', () => {
    const now = new Date(2025, 10, 26, 14, 0)
    const hints = Object.fromEntries(laterChoices(now).map((c) => [c.label, choiceHint(c, now)]))
    const time = (h: number): string =>
      new Date(2025, 10, 26, h).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    expect(hints['In 1 hour']).toBe(time(15))
    expect(hints['Tomorrow at 9:00']).toBeUndefined()
    expect(hints['Monday at 9:00']).toBeTruthy()
    expect(hints['Monday at 9:00']).not.toContain(time(9))
  })
})

describe('formatting', () => {
  it('names today and tomorrow', () => {
    const now = new Date(2025, 10, 26, 14, 0)
    expect(formatAt(new Date(2025, 10, 26, 16, 30).getTime() / 1000, now)).toMatch(/^Today /)
    expect(formatAt(new Date(2025, 10, 27, 9, 0).getTime() / 1000, now)).toMatch(/^Tomorrow /)
  })

  it('round-trips the datetime input format', () => {
    const t = new Date(2025, 10, 26, 9, 5).getTime() / 1000
    expect(toLocalInput(t)).toBe('2025-11-26T09:05')
    expect(fromLocalInput('2025-11-26T09:05')).toBe(t)
  })
})
