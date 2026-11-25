import { useEffect, useState } from 'react'
import { talk, type AiTask } from '@renderer/api/talk'
import { cleanAiOutput } from '@renderer/lib/ai-output'
import { hasFeature, useApp } from '@renderer/store/app'

// Nextcloud's AI (task processing): whatever the server has set up, such as Nextcloud Assistant with
// a local model or the OpenAI integration. Hubbub schedules a task and waits for the result; tasks
// run on the server, which can take a while when it's busy.

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export interface TaskTypeInfo {
  name: string
  inputShapeEnumValues?: Record<string, { name: string; value: string }[]>
  inputShapeDefaults?: Record<string, unknown>
}

const typesCache = new Map<string, { at: number; types: Promise<Record<string, TaskTypeInfo>> }>()

/** The AI task types the server offers, kept for ten minutes */
export function aiTaskTypes(accountId: string): Promise<Record<string, TaskTypeInfo>> {
  const cached = typesCache.get(accountId)
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.types
  const types = talk(accountId)
    .taskTypes()
    .then((r) => (Array.isArray(r.types) ? {} : (r.types as Record<string, TaskTypeInfo>)))
    .catch(() => ({}))
  typesCache.set(accountId, { at: Date.now(), types })
  return types
}

/** Whether the server's AI offers a task type */
export function useHasAiTask(accountId: string | undefined, type: string): boolean {
  const [has, setHas] = useState(false)
  useEffect(() => {
    if (!accountId) return
    let current = true
    void aiTaskTypes(accountId).then((t) => current && setHas(type in t))
    return () => {
      current = false
    }
  }, [accountId, type])
  return has
}

export class TaskFailed extends Error {}

/** The text of an AI answer without the model's reasoning; an error when there's nothing left */
function answerOf(out: unknown): string {
  const answer = typeof out === 'string' ? cleanAiOutput(out) : ''
  if (!answer) {
    throw new TaskFailed(
      'The AI gave no answer. Reasoning models sometimes spend the whole answer on thinking; try again, or ask your Nextcloud admin about the model’s answer length.'
    )
  }
  return answer
}

const POLL = 1_500
const GIVE_UP = 5 * 60_000

/** Waits for a task to finish and resolves with its text output */
export async function waitForTask(
  accountId: string,
  id: number,
  signal?: AbortSignal,
  onStatus?: (task: AiTask) => void
): Promise<string> {
  const api = talk(accountId)
  const started = Date.now()
  for (;;) {
    if (signal?.aborted) {
      void api.cancelTask(id).catch(() => undefined)
      throw new DOMException('Cancelled', 'AbortError')
    }
    const { task } = await api.task(id)
    onStatus?.(task)
    if (task.status === 'STATUS_SUCCESSFUL') return answerOf(task.output?.output)
    if (task.status === 'STATUS_FAILED' || task.status === 'STATUS_CANCELLED') {
      throw new TaskFailed(task.errorMessage || 'The AI couldn’t do it')
    }
    if (Date.now() - started > GIVE_UP) {
      throw new TaskFailed('The server’s AI is taking too long; try again later')
    }
    await new Promise((r) => setTimeout(r, POLL))
  }
}

/** Runs a task of a type with its input, and resolves with its text output */
export async function runTask(
  accountId: string,
  type: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  onStatus?: (task: AiTask) => void
): Promise<string> {
  const { task } = await talk(accountId).scheduleTask(type, input, `hubbub:${type}`)
  return waitForTask(accountId, task.id, signal, onStatus)
}

// --- Summaries ----------------------------------------------------------------

export function canSummarizeChat(accountId: string): boolean {
  return hasFeature(useApp.getState().accounts[accountId], 'chat-summary-api')
}

/** Summarizes a conversation from a message on (Talk does it in parts when there's a lot) */
export async function summarizeChat(
  accountId: string,
  token: string,
  fromMessageId: number,
  signal?: AbortSignal,
  onPart?: (done: number) => void
): Promise<string> {
  const api = talk(accountId)
  const parts: string[] = []
  let from = fromMessageId
  for (let i = 0; i < 10; i++) {
    const res = await api.summarizeChat(token, from)
    if (!res) break
    parts.push(await waitForTask(accountId, res.taskId, signal))
    onPart?.(parts.length)
    if (!res.nextOffset) break
    from = res.nextOffset
  }
  if (!parts.length) throw new TaskFailed('There’s nothing to summarize')
  return parts.join('\n\n')
}

/** Summarizes some text (a thread) with the server's summary task */
export function summarizeText(accountId: string, text: string, signal?: AbortSignal): Promise<string> {
  return runTask(accountId, 'core:text2text:summary', { input: text }, signal)
}

// --- Translation --------------------------------------------------------------

export interface Language {
  id: string
  name: string
}

/** The languages messages can be translated to, by the server's translation apps or its AI */
export async function translationTargets(accountId: string): Promise<Language[]> {
  const a = useApp.getState().accounts[accountId]
  const chat = a?.caps?.config.chat
  if (chat?.['has-translation-providers']) {
    const { languages } = await talk(accountId).translationLanguages()
    const seen = new Map<string, string>()
    for (const l of languages) if (!seen.has(l.to)) seen.set(l.to, l.toLabel)
    return [...seen].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name))
  }
  const types = await aiTaskTypes(accountId)
  const values = types['core:text2text:translate']?.inputShapeEnumValues?.target_language ?? []
  return values.map((v) => ({ id: v.value, name: v.name })).sort((x, y) => x.name.localeCompare(y.name))
}

export function canTranslate(accountId: string): boolean {
  const chat = useApp.getState().accounts[accountId]?.caps?.config.chat
  return !!chat?.['has-translation-providers'] || !!chat?.['has-translation-task-providers']
}

export async function translateText(
  accountId: string,
  text: string,
  to: string,
  signal?: AbortSignal
): Promise<string> {
  const chat = useApp.getState().accounts[accountId]?.caps?.config.chat
  if (chat?.['has-translation-providers']) {
    return answerOf((await talk(accountId).translate(text, to)).text)
  }
  const types = await aiTaskTypes(accountId)
  const origins = types['core:text2text:translate']?.inputShapeEnumValues?.origin_language ?? []
  const origin = origins.some((o) => o.value === 'detect_language')
    ? 'detect_language'
    : (origins[0]?.value ?? 'detect_language')
  return runTask(
    accountId,
    'core:text2text:translate',
    { input: text, origin_language: origin, target_language: to },
    signal
  )
}

/** The language to translate to: the one chosen last, else the app's language when offered */
export function preferredTarget(
  languages: Language[],
  chosen: string | null | undefined
): string | undefined {
  if (chosen && languages.some((l) => l.id === chosen)) return chosen
  const ui = navigator.language.toLowerCase()
  return (
    languages.find((l) => l.id.toLowerCase() === ui)?.id ??
    languages.find((l) => l.id.toLowerCase() === ui.split('-')[0])?.id ??
    languages.find((l) => l.id === 'en')?.id ??
    languages[0]?.id
  )
}

// --- Writing help ---------------------------------------------------------------

/** Rewrites Hubbub offers for a draft, when the server has them */
export const REWRITES: { type: string; label: string }[] = [
  { type: 'core:text2text:reformulation', label: 'Rephrase' },
  { type: 'core:text2text:simplification', label: 'Make it simpler' },
  { type: 'core:text2text:formalization', label: 'Make it more formal' }
]

export { errorText as aiErrorText }
