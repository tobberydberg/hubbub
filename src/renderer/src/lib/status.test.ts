import { describe, expect, it } from 'vitest'
import { clearAfterOf, clearAtFor, formatLastSeen, formatUntil } from './status'

// Wednesday 25 November 2026, 14:30 local time
const now = new Date(2026, 10, 25, 14, 30)
const unix = (d: Date): number => Math.floor(d.getTime() / 1000)

describe('clearAtFor', () => {
  it('counts periods from now', () => {
    expect(clearAtFor('30m', now)).toBe(unix(now) + 1800)
    expect(clearAtFor('4h', now)).toBe(unix(now) + 4 * 3600)
  })

  it('ends today at midnight and the week before Monday', () => {
    expect(clearAtFor('today', now)).toBe(unix(new Date(2026, 10, 26)))
    expect(clearAtFor('week', now)).toBe(unix(new Date(2026, 10, 30)))
    // On a Monday the week runs to the next one
    expect(clearAtFor('week', new Date(2026, 10, 30, 9))).toBe(unix(new Date(2026, 11, 7)))
  })

  it('never clears, or at the chosen time', () => {
    expect(clearAtFor('never', now)).toBeNull()
    expect(clearAtFor('custom', now, 1_800_000_000)).toBe(1_800_000_000)
  })
})

describe('clearAfterOf', () => {
  it('follows Nextcloud’s suggestions', () => {
    expect(clearAfterOf({ type: 'period', time: 3600 })).toBe('1h')
    expect(clearAfterOf({ type: 'period', time: 900 })).toBe('15m')
    expect(clearAfterOf({ type: 'end-of', time: 'day' })).toBe('today')
    expect(clearAfterOf({ type: 'end-of', time: 'week' })).toBe('week')
    expect(clearAfterOf(null)).toBe('never')
  })
})

describe('formatUntil', () => {
  it('reads as a time, the end of a day, or a date', () => {
    expect(formatUntil(unix(new Date(2026, 10, 25, 17)), now)).toMatch(/^until (17[:.]00|5:00\sPM)$/)
    expect(formatUntil(unix(new Date(2026, 10, 26)), now)).toBe('until the end of today')
    expect(formatUntil(unix(new Date(2026, 10, 26, 9)), now)).toMatch(/^until tomorrow 0?9[:.]00(\sAM)?$/)
    expect(formatUntil(unix(new Date(2026, 10, 30)), now)).toMatch(/^until the end of Sun/)
  })
})

describe('formatLastSeen', () => {
  const ago = (minutes: number): number => now.getTime() - minutes * 60_000
  it('reads naturally', () => {
    expect(formatLastSeen(ago(1), now)).toBe('Active just now')
    expect(formatLastSeen(ago(25), now)).toBe('Active 25 minutes ago')
    expect(formatLastSeen(ago(130), now)).toBe('Active 2 hours ago')
    expect(formatLastSeen(new Date(2026, 10, 25, 7, 5).getTime(), now)).toMatch(
      /^Active today at 0?7[:.]05(\sAM)?$/
    )
    expect(formatLastSeen(new Date(2026, 10, 24, 16, 0).getTime(), now)).toMatch(/^Active yesterday at/)
  })
})
