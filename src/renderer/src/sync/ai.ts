import { useEffect, useState } from 'react'
import { talk, type AiTask } from '@renderer/api/talk'
import { cleanAiOutput } from '@renderer/lib/ai-output'
import {
  answersWithText,
  readTaskTypes,
  withOptions,
  type TaskStage,
  type TaskType
} from '@renderer/lib/ai-tasks'
import { hasFeature, useApp } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'

// Nextcloud's AI (task processing): whatever the server has set up, such as Nextcloud Assistant with
// a local model or the OpenAI integration. Hubbub schedules a task and waits for the result; tasks
// run on the server, which can take a while when it's busy. The model and answer length chosen in
// Settings → AI go with every task that takes them.

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const typesCache = new Map<string, { at: number; types: Promise<Record<string, TaskType>> }>()

/** The AI task types the server offers, kept for ten minutes (or fetched again when asked) */
export function aiTaskTypes(accountId: string, fresh = false): Promise<Record<string, TaskType>> {
  const cached = typesCache.get(accountId)
  if (!fresh && cached && Date.now() - cached.at < 10 * 60_000) return cached.types
  const types = talk(accountId)
    .taskTypes()
    .then((r) => readTaskTypes(r.types))
    .catch(() => ({}))
  typesCache.set(accountId, { at: Date.now(), types })
  return types
}

/** The server's AI task types; undefined until known */
export function useAiTaskTypes(accountId: string | undefined): Record<string, TaskType> | undefined {
  const [types, setTypes] = useState<{ accountId: string; types: Record<string, TaskType> } | null>(null)
  useEffect(() => {
    if (!accountId) return
    let current = true
    void aiTaskTypes(accountId).then((t) => current && setTypes({ accountId, types: t }))
    return () => {
      current = false
    }
  }, [accountId])
  return types && types.accountId === accountId ? types.types : undefined
}

const assistantCache = new Map<string, { at: number; version: Promise<string | null> }>()

/** Nextcloud Assistant's version on a server (which has the chat), or null; kept for ten minutes */
export function assistantVersion(accountId: string, fresh = false): Promise<string | null> {
  const cached = assistantCache.get(accountId)
  if (!fresh && cached && Date.now() - cached.at < 10 * 60_000) return cached.version
  const version = talk(accountId)
    .assistantVersion()
    .catch(() => null)
  assistantCache.set(accountId, { at: Date.now(), version })
  return version
}

/** Whether the server's AI offers a task type */
export function useHasAiTask(accountId: string | undefined, type: string): boolean {
  return !!useAiTaskTypes(accountId)?.[type]
}

export class TaskFailed extends Error {}

/** The text of an AI answer without the model's reasoning; an error when there's nothing left */
function answerOf(out: unknown): string {
  const answer = typeof out === 'string' ? cleanAiOutput(out) : ''
  if (!answer) {
    throw new TaskFailed(
      'The AI gave no answer. Reasoning models sometimes spend the whole answer on thinking: raise “Maximum output words” in Settings → AI, or try again.'
    )
  }
  return answer
}

/** A task's state while it's waiting or being worked on, with the answer so far when it's written bit by bit */
export interface TaskUpdate {
  task: AiTask
  stage: TaskStage
  partial?: string
}

export interface RunOptions {
  signal?: AbortSignal
  onUpdate?: (update: TaskUpdate) => void
  /** Kept with the task, to find it again (Ask AI's history) */
  customId?: string
}

const POLL = 1_500
const GIVE_UP = 10 * 60_000
/** Servers without a queue position (before Nextcloud 35) aren't asked again */
const noQueuePosition = new Set<string>()

async function queuePosition(accountId: string, id: number): Promise<number | undefined> {
  if (noQueuePosition.has(accountId)) return undefined
  const res = await talk(accountId).taskQueuePosition(id)
  if (res.ok && typeof res.data === 'number') return res.data
  // 412: it has started meanwhile; anything else: the server doesn't know the endpoint
  if (res.status !== 412) noQueuePosition.add(accountId)
  return undefined
}

/** What a finished task failed with, in words */
export function taskError(task: AiTask): string {
  if (task.status === 'STATUS_CANCELLED') return 'Cancelled'
  return task.userFacingErrorMessage || task.errorMessage || 'The AI couldn’t do it'
}

/** Waits for a task to finish (the task, when it worked) */
export async function waitForTaskDone(accountId: string, id: number, opts: RunOptions = {}): Promise<AiTask> {
  const api = talk(accountId)
  const started = Date.now()
  for (let round = 0; ; round++) {
    if (opts.signal?.aborted) {
      void api.cancelTask(id).catch(() => undefined)
      throw new DOMException('Cancelled', 'AbortError')
    }
    const { task } = await api.task(id)
    if (task.status === 'STATUS_SUCCESSFUL') return task
    if (task.status === 'STATUS_FAILED' || task.status === 'STATUS_CANCELLED')
      throw new TaskFailed(taskError(task))
    if (opts.onUpdate) {
      if (task.status === 'STATUS_RUNNING') {
        const out = task.output?.output
        opts.onUpdate({
          task,
          stage: { stage: 'running', progress: task.progress ?? undefined },
          partial: typeof out === 'string' && out ? cleanAiOutput(out) : undefined
        })
      } else {
        // The place in line every few rounds; it changes slowly
        const position = round % 4 === 0 ? await queuePosition(accountId, id) : undefined
        opts.onUpdate({ task, stage: { stage: 'scheduled', position } })
      }
    }
    if (Date.now() - started > GIVE_UP) {
      throw new TaskFailed('The server’s AI is taking too long; try again later')
    }
    await new Promise((r) => setTimeout(r, POLL))
  }
}

/** Waits for a task to finish and resolves with its text output */
export async function waitForTask(accountId: string, id: number, opts: RunOptions = {}): Promise<string> {
  return answerOf((await waitForTaskDone(accountId, id, opts)).output?.output)
}

/** Schedules a task with the settings chosen for this server (model, answer length) added */
export async function scheduleTask(
  accountId: string,
  type: string,
  input: Record<string, unknown>,
  customId?: string
): Promise<AiTask> {
  const info = (await aiTaskTypes(accountId))[type]
  const options = usePrefs.getState().aiOptions[accountId]
  const { task } = await talk(accountId).scheduleTask(
    type,
    withOptions(info, input, options),
    customId ?? `hubbub:${type}`,
    answersWithText(info)
  )
  return task
}

/** Runs a task of a type with its input, and resolves with its text output */
export async function runTask(
  accountId: string,
  type: string,
  input: Record<string, unknown>,
  opts: RunOptions = {}
): Promise<string> {
  const task = await scheduleTask(accountId, type, input, opts.customId)
  return waitForTask(accountId, task.id, opts)
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
  onPart?: (done: number) => void,
  onUpdate?: (update: TaskUpdate) => void
): Promise<string> {
  const api = talk(accountId)
  const parts: string[] = []
  let from = fromMessageId
  for (let i = 0; i < 10; i++) {
    const res = await api.summarizeChat(token, from)
    if (!res) break
    parts.push(await waitForTask(accountId, res.taskId, { signal, onUpdate }))
    onPart?.(parts.length)
    if (!res.nextOffset) break
    from = res.nextOffset
  }
  if (!parts.length) throw new TaskFailed('There’s nothing to summarize')
  return parts.join('\n\n')
}

/** Summarizes some text (a thread) with the server's summary task */
export function summarizeText(
  accountId: string,
  text: string,
  signal?: AbortSignal,
  onUpdate?: (update: TaskUpdate) => void
): Promise<string> {
  return runTask(accountId, 'core:text2text:summary', { input: text }, { signal, onUpdate })
}

// --- Translation --------------------------------------------------------------

export interface Language {
  id: string
  name: string
}

/**
 * Which way messages are translated: by the server's AI (task processing), which Talk says to use
 * when it's there, or by a translation app through the older translation API.
 */
async function translationWay(accountId: string): Promise<'task' | 'legacy' | null> {
  const chat = useApp.getState().accounts[accountId]?.caps?.config.chat
  if (
    chat?.['has-translation-task-providers'] &&
    (await aiTaskTypes(accountId))['core:text2text:translate']
  ) {
    return 'task'
  }
  if (chat?.['has-translation-providers']) return 'legacy'
  return null
}

/** The languages messages can be translated to, by the server's AI or its translation apps */
export async function translationTargets(accountId: string): Promise<Language[]> {
  const way = await translationWay(accountId)
  if (way === 'legacy') {
    const { languages } = await talk(accountId).translationLanguages()
    const seen = new Map<string, string>()
    for (const l of languages) if (!seen.has(l.to)) seen.set(l.to, l.toLabel)
    return [...seen].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name))
  }
  if (way !== 'task') return []
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
  opts: RunOptions = {}
): Promise<string> {
  if ((await translationWay(accountId)) === 'legacy') {
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
    opts
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
export const REWRITES: { type: string; label: string; busy: string; done: string }[] = [
  { type: 'core:text2text:reformulation', label: 'Rephrase', busy: 'Rephrasing', done: 'Rephrased' },
  {
    type: 'core:text2text:simplification',
    label: 'Make it simpler',
    busy: 'Simplifying',
    done: 'Made simpler'
  },
  {
    type: 'core:text2text:formalization',
    label: 'Make it more formal',
    busy: 'Making it more formal',
    done: 'Made more formal'
  }
]

/** The tones a draft can be rewritten in (the server's "Change tone"), or none */
export async function rewriteTones(accountId: string): Promise<{ name: string; value: string }[]> {
  const t = (await aiTaskTypes(accountId))['core:text2text:changetone']
  return t?.inputShape.tone ? (t.inputShapeEnumValues?.tone ?? []) : []
}

export { errorText as aiErrorText }
