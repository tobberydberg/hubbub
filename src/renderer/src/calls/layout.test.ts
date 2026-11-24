import { describe, expect, it } from 'vitest'
import { gridShape, pickTiles, type TileCandidate } from './layout'

const p = (id: string, partial: Partial<TileCandidate> = {}): TileCandidate => ({
  id,
  speaking: false,
  videoOn: false,
  lastSpokeAt: 0,
  ...partial
})

describe('pickTiles', () => {
  it('shows everyone when they fit', () => {
    const people = [p('me', { self: true }), p('a'), p('b')]
    expect(pickTiles(people, 4)).toEqual({ shown: people, hidden: 0 })
  })

  it('keeps us, speakers, cameras and recent speakers, in the original order', () => {
    const people = [
      p('a'),
      p('b', { lastSpokeAt: 100 }),
      p('c', { videoOn: true }),
      p('me', { self: true }),
      p('d', { speaking: true }),
      p('e', { lastSpokeAt: 50 }),
      p('f')
    ]
    const { shown, hidden } = pickTiles(people, 5)
    expect(shown.map((x) => x.id)).toEqual(['b', 'c', 'me', 'd'])
    expect(hidden).toBe(3)
  })
})

describe('gridShape', () => {
  it('uses one tile for one person', () => {
    expect(gridShape(1, 1000, 600)).toEqual({ cols: 1, rows: 1, tileWidth: 1000 })
  })

  it('puts two people side by side in a wide view and stacked in a tall one', () => {
    expect(gridShape(2, 1600, 600)).toMatchObject({ cols: 2, rows: 1 })
    expect(gridShape(2, 500, 900)).toMatchObject({ cols: 1, rows: 2 })
  })

  it('makes a 3×3 grid for nine people in a 16:9 view', () => {
    expect(gridShape(9, 1600, 900, 8)).toMatchObject({ cols: 3, rows: 3, tileWidth: 523 })
  })
})
