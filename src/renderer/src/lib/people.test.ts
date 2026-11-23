import { describe, expect, it } from 'vitest'
import { mergePeople, rankPeople, type Person } from './people'

const people: Person[] = [
  { id: 'tobias', name: 'Tobias Rydberg', subline: 'tobias@example.com' },
  { id: 'anna.s', name: 'Anna Svensson', subline: 'anna@example.com' },
  { id: 'ake', name: 'Åke Öberg', subline: 'ake@example.com' },
  { id: 'bob', name: 'Robert Berg', subline: 'bob@example.com' },
  { id: 'svenne', name: 'Sven Andersson', subline: 'sven@example.com' }
]
const ids = (q: string): string[] => rankPeople(people, q).map((p) => p.id)

describe('rankPeople', () => {
  it('lists everyone alphabetically without a query', () => {
    expect(ids('')).toEqual(
      ['ake', 'anna.s', 'bob', 'tobias', 'svenne'].sort((a, b) => {
        const name = (id: string) => people.find((p) => p.id === id)!.name
        return name(a).localeCompare(name(b))
      })
    )
  })

  it('prefers name prefixes over word and substring matches', () => {
    expect(ids('sven')).toEqual(['svenne', 'anna.s'])
    expect(ids('an')).toEqual(['anna.s', 'svenne'])
  })

  it('ignores accents and case', () => {
    expect(ids('ake')).toEqual(['ake'])
    expect(ids('OBERG')).toEqual(['ake'])
  })

  it('does not match everyone on a shared e-mail domain', () => {
    expect(ids('example')).toEqual([])
    expect(ids('anna@example')).toEqual(['anna.s'])
  })

  it('requires every word of the query to match', () => {
    expect(ids('sven and')).toEqual(['svenne'])
    expect(ids('tobias svensson')).toEqual([])
  })

  it('matches the user id', () => {
    expect(ids('bob')).toEqual(['bob'])
  })
})

describe('mergePeople', () => {
  it('dedupes by id, later entries winning', () => {
    const merged = mergePeople([{ id: 'a', name: 'A', status: 'away' }], [{ id: 'a', name: 'A2' }])
    expect(merged).toEqual([{ id: 'a', name: 'A2', status: 'away' }])
  })
})
