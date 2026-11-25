import { describe, expect, it } from 'vitest'
import { cleanAiOutput } from './ai-output'

describe('cleanAiOutput', () => {
  it('keeps plain answers', () => {
    expect(cleanAiOutput('  Hej allihop!\n')).toBe('Hej allihop!')
  })

  it('drops <think> blocks, also without their opening tag', () => {
    expect(cleanAiOutput('<think>\nThe user wants Swedish.\n</think>\n\nHej allihop!')).toBe('Hej allihop!')
    expect(cleanAiOutput('The user wants Swedish. Let me translate.\n</think>\nHej allihop!')).toBe(
      'Hej allihop!'
    )
    expect(cleanAiOutput('<thinking>hmm</thinking>Answer')).toBe('Answer')
  })

  it('gives nothing when the model never stopped thinking', () => {
    expect(cleanAiOutput('<think>Let me consider the tone of this message and')).toBe('')
  })

  it('takes the final channel of gpt-oss', () => {
    expect(
      cleanAiOutput(
        '<|channel|>analysis<|message|>Need to translate to Swedish.<|end|><|start|>assistant<|channel|>final<|message|>Hej allihop!<|return|>'
      )
    ).toBe('Hej allihop!')
    expect(cleanAiOutput('analysisNeed to translate to Swedish.assistantfinalHej allihop!')).toBe(
      'Hej allihop!'
    )
  })

  it('drops Ollama’s thinking text', () => {
    expect(cleanAiOutput('Thinking...\nTranslate it.\n...done thinking.\n\nHej allihop!')).toBe(
      'Hej allihop!'
    )
  })
})
