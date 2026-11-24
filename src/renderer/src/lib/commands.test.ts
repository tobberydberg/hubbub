import { describe, expect, it } from 'vitest'
import { commandInProgress, commandSuggestions, parseCommand, splitMentions, unescapeSlash } from './commands'

describe('parseCommand', () => {
  it('finds known commands and their arguments', () => {
    expect(parseCommand('/away')).toMatchObject({ command: { name: 'away' }, args: '' })
    expect(parseCommand('/msg @bob hello there')).toMatchObject({
      command: { name: 'msg' },
      args: '@bob hello there'
    })
    expect(parseCommand('/DM @bob')).toMatchObject({ command: { name: 'msg' } })
    expect(parseCommand('/code line 1\nline 2')).toMatchObject({ args: 'line 1\nline 2' })
  })

  it('leaves unknown commands, escaped slashes and normal text alone', () => {
    expect(parseCommand('/weather Stockholm')).toBeNull()
    expect(parseCommand('//away')).toBeNull()
    expect(parseCommand('hello /away')).toBeNull()
    expect(unescapeSlash('//away')).toBe('/away')
    expect(unescapeSlash('/weather')).toBe('/weather')
  })
})

describe('suggestions', () => {
  it('lists commands while the first word is typed', () => {
    expect(commandSuggestions('/')?.length).toBeGreaterThan(10)
    expect(commandSuggestions('/ca')?.map((c) => c.name)).toEqual(['call'])
    expect(commandSuggestions('/d')?.map((c) => c.name)).toEqual(['dnd', 'msg'])
    expect(commandSuggestions('/call ')).toBeNull()
    expect(commandSuggestions('hello')).toBeNull()
  })

  it('knows the command whose arguments are being typed', () => {
    expect(commandInProgress('/msg @b')?.name).toBe('msg')
    expect(commandInProgress('/msg')).toBeNull()
    expect(commandInProgress('/nope x')).toBeNull()
  })
})

describe('splitMentions', () => {
  it('takes the mentioned users off the front', () => {
    expect(splitMentions('@bob @"anna svensson" hi there')).toEqual({
      users: ['bob', 'anna svensson'],
      text: 'hi there'
    })
    expect(splitMentions('no mentions')).toEqual({ users: [], text: 'no mentions' })
  })
})
