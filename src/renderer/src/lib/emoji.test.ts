import { describe, expect, it } from 'vitest'
import { convertAtCaret, convertLastWord, emojiForCode, emojiQuery, searchEmoji } from './emoji'

const at = (text: string): ReturnType<typeof convertAtCaret> => convertAtCaret(text, text.length)

describe('emojiQuery', () => {
  it('starts at a colon at the beginning of a word, after two characters', () => {
    expect(emojiQuery(':th', 3)).toEqual({ start: 0, query: 'th' })
    expect(emojiQuery('hi :Tada', 8)).toEqual({ start: 3, query: 'tada' })
    expect(emojiQuery(':t', 2)).toBeNull()
  })

  it('leaves times, URLs and emoticons alone', () => {
    expect(emojiQuery('at 12:30', 8)).toBeNull()
    expect(emojiQuery('http://ex', 9)).toBeNull()
    expect(emojiQuery(':-)', 3)).toBeNull()
  })
})

describe('searchEmoji', () => {
  it('ranks the obvious match first', () => {
    expect(searchEmoji('thumbsup')[0].emoji).toBe('👍')
    expect(searchEmoji('fire')[0].emoji).toBe('🔥')
    expect(searchEmoji('heart')[0].emoji).toBe('❤️')
    expect(searchEmoji('+1')[0].emoji).toBe('👍')
  })

  it('leaves out names that merely contain the query when others start with it', () => {
    expect(searchEmoji('thu').map((s) => s.code)).not.toContain('flag_lithuania')
  })

  it('finds emoji by name and shows a shortcode', () => {
    const r = searchEmoji('slightly_smil')
    expect(r[0]).toEqual({ emoji: '🙂', code: 'slightly_smiling_face' })
  })
})

describe('converting', () => {
  it('turns emoticons into emoji when the word ends', () => {
    expect(at('nice :-) ')?.text).toBe('nice 🙂 ')
    expect(at(';)\n')?.text).toBe('😉\n')
    expect(at('<3 ')?.text).toBe('❤️ ')
  })

  it('turns complete shortcodes into emoji', () => {
    expect(at('party :tada:')?.text).toBe('party 🎉')
    expect(at(':slightly_smiling_face:')?.text).toBe('🙂')
    expect(at(':nosuchemoji:')).toBeNull()
  })

  it('keeps the caret after the emoji and remembers the original', () => {
    const c = at('ok :) ')!
    expect(c.caret).toBe('ok 🙂 '.length)
    expect(c.undo).toEqual({ text: 'ok :) ', caret: 6 })
  })

  it('leaves URLs, words and code alone', () => {
    expect(at('see http://x.se ')).toBeNull()
    expect(at('a:) ')).toBeNull()
    expect(at('`:-) ')).toBeNull()
    expect(at('```\n:-) ')).toBeNull()
  })

  it('converts a message ending with an emoticon when sent', () => {
    expect(convertLastWord('thanks :)')).toBe('thanks 🙂')
    expect(convertLastWord('done :white_check_mark:')).toBe('done ✅')
    expect(convertLastWord('see http://x')).toBe('see http://x')
  })

  it('knows shortcodes by alias and by name', () => {
    expect(emojiForCode('joy')).toBe('😂')
    expect(emojiForCode('party_popper')).toBe('🎉')
  })
})
