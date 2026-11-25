// What the server's AI answers, without the model's reasoning: reasoning models (DeepSeek R1, Qwen 3,
// gpt-oss, …) put their thinking in front of the answer, marked in one of a few ways, and some
// providers pass it on as it is.

/** The answer of an AI task without the model's thinking, trimmed; '' when there is no answer */
export function cleanAiOutput(text: string): string {
  let s = text.replace(/\r\n/g, '\n')

  // gpt-oss (harmony format): the answer is the "final" channel
  const final = s.lastIndexOf('<|channel|>final<|message|>')
  if (final !== -1) s = s.slice(final + '<|channel|>final<|message|>'.length)
  // … and with the special tokens stripped: "analysis…assistantfinal<answer>"
  else if (/^\s*analysis/i.test(s) && s.includes('assistantfinal')) {
    s = s.slice(s.lastIndexOf('assistantfinal') + 'assistantfinal'.length)
  }
  s = s.replace(/<\|(?:end|return|start|message|channel)\|>/g, '')

  // <think>…</think> and the like, also when the opening tag is missing (the model's template added it)
  for (const tag of ['think', 'thinking', 'reasoning', 'thought', 'analysis']) {
    s = s.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'gi'), '')
    const close = s.toLowerCase().lastIndexOf(`</${tag}>`)
    if (close !== -1) s = s.slice(close + tag.length + 3)
    // Thinking that never ended: there's no answer after it
    const open = s.toLowerCase().indexOf(`<${tag}>`)
    if (open !== -1) s = s.slice(0, open)
  }
  // Kimi-style ◁think▷…◁/think▷
  s = s.replace(/◁think▷[\s\S]*?◁\/think▷/g, '')
  // Ollama's text form: "Thinking...\n…\n...done thinking.\n\n<answer>"
  const done = s.indexOf('...done thinking.')
  if (/^\s*Thinking\.\.\./.test(s) && done !== -1) s = s.slice(done + '...done thinking.'.length)

  return s.trim()
}
