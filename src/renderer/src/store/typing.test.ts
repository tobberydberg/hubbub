import { describe, expect, it } from 'vitest'
import { typingText } from './typing'

describe('typingText', () => {
  it('names up to three people, then gives up', () => {
    expect(typingText([])).toBe('')
    expect(typingText(['Alice'])).toBe('Alice is typing…')
    expect(typingText(['Alice', 'Bob'])).toBe('Alice and Bob are typing…')
    expect(typingText(['Alice', 'Bob', 'Carol'])).toBe('Alice, Bob and Carol are typing…')
    expect(typingText(['Alice', 'Bob', 'Carol', 'Dave'])).toBe('Several people are typing…')
  })
})
