import { describe, expect, it } from 'vitest'
import { reactorText } from './ReactionChip'

describe('reactorText', () => {
  it('lists the people who reacted', () => {
    expect(reactorText(['You'], 1)).toBe('You')
    expect(reactorText(['Alice', 'Bob'], 2)).toBe('Alice and Bob')
    expect(reactorText(['You', 'Alice', 'Bob'], 3)).toBe('You, Alice and Bob')
  })
  it('sums up the rest', () => {
    const names = Array.from({ length: 12 }, (_, i) => `P${i + 1}`)
    expect(reactorText(names, 12)).toBe('P1, P2, P3, P4, P5, P6, P7, P8, P9, P10 and 2 others')
    expect(reactorText([], 3)).toBe('3 people')
  })
})
