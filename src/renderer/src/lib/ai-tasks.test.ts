import { describe, expect, it } from 'vitest'
import { groupOf, ordinal, readTaskTypes, sharedOptions, stageText, toolTypes, withOptions } from './ai-tasks'

// Shaped like Nextcloud 35 with the OpenAI integration (5.x): most text tasks take a model and an
// answer length; empty shapes come as [] from PHP
const model = { name: 'Model', description: 'The model used to generate the completion', type: 'Enum' }
const maxTokens = { name: 'Maximum output words', description: 'The maximum number of words', type: 'Number' }
const models = [
  { name: 'mock-fast', value: 'mock-fast' },
  { name: 'mock-smart', value: 'mock-smart' }
]
const text = (name: string) => ({ name, description: '', type: 'Text' })
const textTask = (name: string) => ({
  name,
  description: '',
  inputShape: { input: text('Input') },
  inputShapeEnumValues: [],
  inputShapeDefaults: [],
  optionalInputShape: { max_tokens: maxTokens, model },
  optionalInputShapeEnumValues: { model: models },
  optionalInputShapeDefaults: { max_tokens: 1000, model: 'mock-fast' },
  outputShape: { output: text('Output') },
  optionalOutputShape: []
})

const raw = {
  'core:text2text': textTask('Free text to text prompt'),
  'core:text2text:summary': textTask('Summarize'),
  'core:text2text:headline': {
    ...textTask('Generate a headline'),
    optionalInputShapeDefaults: { max_tokens: 100, model: 'mock-fast' }
  },
  'core:text2text:chat': { ...textTask('Chat'), isInternal: false },
  'core:contextagent:interaction': { ...textTask('Context agent'), isInternal: true },
  'core:text2image': {
    name: 'Generate image',
    inputShape: {
      input: text('Prompt'),
      numberOfImages: { name: 'Number of images', description: '', type: 'Number' }
    },
    optionalInputShape: { size: text('Size'), model },
    optionalInputShapeEnumValues: { model: [{ name: 'dall-e-3', value: 'dall-e-3' }] },
    outputShape: { images: { name: 'Output images', description: '', type: 'ListOfImages' } }
  },
  'core:audio2text': {
    name: 'Transcribe audio',
    inputShape: { input: { name: 'Audio input', description: '', type: 'Audio' } },
    optionalInputShape: { language: { name: 'Language', description: '', type: 'Enum' } },
    optionalInputShapeEnumValues: { language: [{ name: 'English', value: 'en' }] },
    outputShape: { output: text('Transcription') }
  },
  broken: { name: 'No shapes' }
}

describe('task types', () => {
  const types = readTaskTypes(raw)

  it('reads them with their ids, empty shapes as objects, and skips broken ones', () => {
    expect(types['core:text2text:summary'].id).toBe('core:text2text:summary')
    expect(types['core:text2text'].inputShapeDefaults).toEqual({})
    expect(types.broken).toBeUndefined()
    expect(readTaskTypes([])).toEqual({})
  })

  it('offers tools without the chat’s and agent’s own tasks, common ones first', () => {
    expect(toolTypes(types).map((t) => t.id)).toEqual([
      'core:text2text',
      'core:text2text:summary',
      'core:text2text:headline',
      'core:text2image',
      'core:audio2text'
    ])
  })

  it('groups tools by what they take and give', () => {
    expect(groupOf(types['core:text2text'])).toBe('text')
    expect(groupOf(types['core:text2image'])).toBe('images')
    expect(groupOf(types['core:audio2text'])).toBe('audio')
  })

  it('finds the options most tasks share, with every model offered', () => {
    const shared = sharedOptions(types)
    expect(shared.map((o) => o.key)).toEqual(['max_tokens', 'model'])
    const m = shared.find((o) => o.key === 'model')!
    expect(m.values.map((v) => v.value)).toEqual(['mock-fast', 'mock-smart', 'dall-e-3'])
    // Not every task has the same answer length by default
    expect(shared.find((o) => o.key === 'max_tokens')!.serverDefault).toBeUndefined()
  })

  it('adds the chosen options only where a task takes them', () => {
    const options = { model: 'mock-smart', max_tokens: 4000 }
    expect(withOptions(types['core:text2text'], { input: 'hi' }, options)).toEqual({
      input: 'hi',
      model: 'mock-smart',
      max_tokens: 4000
    })
    // The image task doesn't offer that model, and has no answer length
    expect(withOptions(types['core:text2image'], { input: 'a cat' }, options)).toEqual({ input: 'a cat' })
    // What the input already says wins; an empty setting is the server's default
    expect(
      withOptions(types['core:text2text'], { input: 'x', model: 'mock-fast' }, { model: 'mock-smart' }).model
    ).toBe('mock-fast')
    expect(withOptions(types['core:text2text'], { input: 'x' }, { model: '' })).toEqual({ input: 'x' })
  })

  it('says where a task is', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st'
    ])
    expect(stageText({ stage: 'scheduled', position: 2 })).toBe('Waiting for the server’s AI (2nd in line)…')
    expect(stageText({ stage: 'running', progress: 0.5 })).toBe('Working… 50%')
  })
})
