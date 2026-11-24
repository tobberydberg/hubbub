import { describe, expect, it } from 'vitest'
import { defaultRule, describeRule, fromRRule, presetOf, presetRule, setPosOf, toRRule } from './repeat'

// Tuesday 24 November 2026, 14:00
const start = new Date(2026, 10, 24, 14).getTime()

describe('writing rules', () => {
  it('writes weekly rules with days and an interval', () => {
    const rule = { ...defaultRule('WEEKLY', start), interval: 2, byDay: ['WE', 'MO'] as const }
    expect(toRRule({ ...rule, byDay: [...rule.byDay] }, false)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')
  })

  it('writes monthly rules on days of the month or a weekday position', () => {
    expect(toRRule({ ...defaultRule('MONTHLY', start), byMonthDay: [15, 1] }, false)).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=1,15'
    )
    // The 24th is the last Tuesday of November 2026
    expect(toRRule({ ...defaultRule('MONTHLY', start), monthMode: 'weekday' }, false)).toBe(
      'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=-1'
    )
  })

  it('writes yearly rules in chosen months', () => {
    expect(toRRule({ ...defaultRule('YEARLY', start), byMonth: [11, 3] }, false)).toBe(
      'FREQ=YEARLY;BYMONTH=3,11'
    )
  })

  it('ends after a count, or on a day (as UTC for timed events, as a date for all-day ones)', () => {
    expect(toRRule({ ...defaultRule('DAILY', start), end: 'count', count: 5 }, false)).toBe(
      'FREQ=DAILY;COUNT=5'
    )
    const until = new Date(2026, 11, 31).getTime()
    expect(toRRule({ ...defaultRule('DAILY', start), end: 'until', until }, true)).toBe(
      'FREQ=DAILY;UNTIL=20261231'
    )
    const timed = toRRule({ ...defaultRule('DAILY', start), end: 'until', until }, false)
    expect(timed).toMatch(/^FREQ=DAILY;UNTIL=\d{8}T\d{6}Z$/)
    // Read back, it ends on the same local day
    expect(fromRRule(timed, start)?.until).toBe(until)
  })
})

describe('reading rules', () => {
  it('reads what it writes', () => {
    for (const text of [
      'FREQ=WEEKLY;INTERVAL=3;BYDAY=MO,TH',
      'FREQ=MONTHLY;BYMONTHDAY=1,15',
      'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2',
      'FREQ=YEARLY;BYMONTH=3,11;BYDAY=FR;BYSETPOS=-1',
      'FREQ=DAILY;COUNT=7'
    ]) {
      expect(toRRule(fromRRule(text, start)!, false)).toBe(text)
    }
  })

  it('reads the "2TU" form of weekday positions', () => {
    expect(fromRRule('FREQ=MONTHLY;BYDAY=2TU', start)).toMatchObject({
      monthMode: 'weekday',
      setPos: 2,
      weekday: 'TU'
    })
  })

  it('leaves rules it can’t edit alone', () => {
    expect(fromRRule('FREQ=HOURLY', start)).toBeNull()
    expect(fromRRule('FREQ=YEARLY;BYWEEKNO=20', start)).toBeNull()
    expect(fromRRule('FREQ=MONTHLY;BYDAY=1MO,3MO', start)).toBeNull()
  })
})

describe('presets and words', () => {
  it('recognises the quick choices', () => {
    expect(presetOf(presetRule('weekdays', start), start)).toBe('weekdays')
    expect(presetOf(presetRule('monthly', start), start)).toBe('monthly')
    expect(presetOf({ ...presetRule('weekly', start), interval: 2 }, start)).toBe('custom')
    expect(presetOf(null, start)).toBe('none')
  })

  it('knows the weekday’s position in the month', () => {
    expect(setPosOf(new Date(2026, 10, 10).getTime())).toBe(2)
    expect(setPosOf(new Date(2026, 10, 24).getTime())).toBe(-1)
  })

  it('describes rules in words', () => {
    expect(describeRule({ ...defaultRule('WEEKLY', start), interval: 2, byDay: ['MO', 'WE'] }, start)).toBe(
      'Every 2 weeks on Monday and Wednesday'
    )
    expect(describeRule(presetRule('weekdays', start), start)).toBe('Every weekday')
    expect(
      describeRule({ ...defaultRule('MONTHLY', start), byMonthDay: [1, 15], end: 'count', count: 6 }, start)
    ).toBe('Every month on the 1st and 15th, 6 times')
    expect(describeRule({ ...defaultRule('MONTHLY', start), monthMode: 'weekday', setPos: 2 }, start)).toBe(
      'Every month on the second Tuesday'
    )
  })
})
