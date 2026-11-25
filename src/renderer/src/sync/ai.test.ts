import { describe, expect, it } from 'vitest'
import { preferredTarget } from './ai'

describe('preferredTarget', () => {
  const langs = [
    { id: 'de', name: 'German' },
    { id: 'en', name: 'English' },
    { id: 'sv', name: 'Swedish' }
  ]
  it('keeps the language chosen last when it is offered', () => {
    expect(preferredTarget(langs, 'sv')).toBe('sv')
  })
  it('falls back to the app’s language, then English', () => {
    expect(preferredTarget(langs, 'fr')).toBe(
      langs.find((l) => l.id === navigator.language.split('-')[0])?.id ?? 'en'
    )
    expect(preferredTarget([], null)).toBeUndefined()
  })
})
