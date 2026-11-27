import { assistant, pendingActions, type ChatSession } from '@renderer/api/assistant'
import { talk, type AiTask } from '@renderer/api/talk'
import { cleanAiOutput } from '@renderer/lib/ai-output'
import { toolTypes, type TaskStage } from '@renderer/lib/ai-tasks'
import { setApp, showToast, useApp } from '@renderer/store/app'
import {
  assistantOf,
  updateAssistant,
  type AssistantPage,
  type ChatState,
  type ToolRun
} from '@renderer/store/assistant'
import { aiErrorText, aiTaskTypes, assistantVersion, scheduleTask, taskError, waitForTaskDone } from './ai'

// The Assistant view: chats with Nextcloud Assistant (its conversations, the same as on the web),
// and the server's AI tools with their results. Answers are fetched here, not in the components, so
// they keep coming while you look elsewhere.

/** Tool runs are kept on the server under this id, for the history */
export const TOOL_RUN_ID = 'hubbub:ask'

const POLL = 1_500
/** An answer is given up on after this long (the task keeps running on the server) */
const GIVE_UP = 15 * 60_000
/** Messages per page */
const PAGE = 50

// --- The view --------------------------------------------------------------------

/** Shows a server's Assistant (or goes back to the chat) */
export function showAssistant(accountId: string, on = true): void {
  setApp((s) => {
    const a = s.accounts[accountId]
    if (!a) return
    s.activeAccountId = accountId
    a.view = on ? 'assistant' : 'room'
    if (on) s.rhs = null
  })
  if (on) void loadAssistant(accountId)
}

/** What the server's AI offers, and its conversations; picks the first page to show */
export async function loadAssistant(accountId: string, fresh = false): Promise<void> {
  const [types, version] = await Promise.all([
    aiTaskTypes(accountId, fresh),
    assistantVersion(accountId, fresh)
  ])
  updateAssistant(accountId, (a) => {
    a.types = types
    a.assistant = version
    if (!a.page) {
      const first = toolTypes(types)[0]
      a.page =
        version !== null ? { kind: 'chat', sessionId: null } : first ? { kind: 'tool', type: first.id } : null
    }
  })
  if (version !== null) await loadSessions(accountId)
}

export function openPage(accountId: string, page: AssistantPage): void {
  updateAssistant(accountId, (a) => void (a.page = page))
  if (page.kind === 'chat' && page.sessionId !== null) void openSession(accountId, page.sessionId)
  if (page.kind === 'history') void loadHistory(accountId)
}

// --- Chat --------------------------------------------------------------------------

export async function loadSessions(accountId: string): Promise<void> {
  try {
    const sessions = await assistant(accountId).sessions()
    updateAssistant(accountId, (a) => {
      a.sessions = [...sessions].sort((x, y) => (y.timestamp ?? 0) - (x.timestamp ?? 0) || y.id - x.id)
      a.sessionsError = undefined
    })
  } catch (err) {
    updateAssistant(accountId, (a) => {
      a.sessions ??= []
      a.sessionsError = aiErrorText(err)
    })
  }
}

function updateChat(accountId: string, sessionId: number, fn: (c: ChatState) => void): void {
  updateAssistant(accountId, (a) => {
    fn((a.chats[sessionId] ??= { messages: null, hasOlder: false }))
  })
}

const pollers = new Set<string>()

/** Opens a conversation: its messages, and an answer that's still being written or waiting for your OK */
export async function openSession(accountId: string, sessionId: number): Promise<void> {
  const api = assistant(accountId)
  try {
    const messages = await api.messages(sessionId, PAGE, 0)
    updateChat(accountId, sessionId, (c) => {
      // An answer that arrived while loading is already in
      const known = new Set(messages.map((m) => m.id))
      const extra = (c.messages ?? []).filter((m) => !known.has(m.id) && m.id > (messages.at(-1)?.id ?? 0))
      c.messages = [...messages, ...extra]
      c.hasOlder = messages.length === PAGE
      c.error = undefined
    })
    const check = await api.checkSession(sessionId)
    updateChat(
      accountId,
      sessionId,
      (c) => void (c.pending = pendingActions(check.sessionAgencyPendingActions))
    )
    if (check.messageTaskId) void followAnswer(accountId, sessionId, check.messageTaskId)
    if (check.titleTaskId) void followTitle(accountId, sessionId, check.titleTaskId)
  } catch (err) {
    updateChat(accountId, sessionId, (c) => {
      c.messages ??= []
      c.error = aiErrorText(err)
    })
  }
}

export async function loadOlder(accountId: string, sessionId: number): Promise<void> {
  const chat = assistantOf(accountId)?.chats[sessionId]
  if (!chat?.messages || !chat.hasOlder) return
  const older = await assistant(accountId).messages(sessionId, PAGE, chat.messages.length)
  updateChat(accountId, sessionId, (c) => {
    const known = new Set((c.messages ?? []).map((m) => m.id))
    c.messages = [...older.filter((m) => !known.has(m.id)), ...(c.messages ?? [])]
    c.hasOlder = older.length === PAGE
  })
}

/** Sends a message (in a new conversation when there's none yet) and waits for the answer */
export async function sendMessage(accountId: string, sessionId: number | null, text: string): Promise<void> {
  const api = assistant(accountId)
  let id = sessionId
  try {
    if (id === null) {
      const session = await api.newSession()
      id = session.id
      const made: ChatSession = { ...session, title: null }
      updateAssistant(accountId, (a) => {
        a.sessions = [made, ...(a.sessions ?? []).filter((s) => s.id !== made.id)]
        a.chats[made.id] = { messages: [], hasOlder: false }
        a.drafts[String(made.id)] = ''
        delete a.drafts.new
        if (a.page?.kind === 'chat' && a.page.sessionId === null)
          a.page = { kind: 'chat', sessionId: made.id }
      })
    }
    const sid = id
    const first = !(assistantOf(accountId)?.chats[sid]?.messages ?? []).some(
      (m) => m.role === 'human' && m.content
    )
    // Writing while the agent asks for an OK means "don't"
    updateChat(accountId, sid, (c) => {
      c.pending = null
      c.failed = undefined
      c.sending = true
    })
    const message = await api.addMessage(sid, text, first)
    updateChat(accountId, sid, (c) => void (c.messages = [...(c.messages ?? []), message]))
    if (first) {
      updateAssistant(accountId, (a) => {
        const s = a.sessions?.find((x) => x.id === sid)
        if (s && !s.title) s.title = text.slice(0, 100)
      })
    }
    const taskId = await api.generate(sid)
    void followAnswer(accountId, sid, taskId)
    // A short title of its own, as on the web, written after the answer has been started
    if (first) {
      void api
        .generateTitle(sid)
        .then((t) => followTitle(accountId, sid, t))
        .catch(() => undefined)
    }
  } catch (err) {
    if (id !== null) {
      updateChat(accountId, id, (c) => {
        c.failed = aiErrorText(err)
        c.sending = false
      })
    } else showToast(`Couldn’t start the conversation: ${aiErrorText(err)}`, 'error')
  }
}

/** Answers the agent: do what it asked (true) or not */
export async function answerAgent(accountId: string, sessionId: number, yes: boolean): Promise<void> {
  const api = assistant(accountId)
  const pending = assistantOf(accountId)?.chats[sessionId]?.pending ?? null
  updateChat(accountId, sessionId, (c) => {
    c.pending = null
    c.failed = undefined
  })
  try {
    // The Assistant expects an (empty) message from you with the answer
    await api.addMessage(sessionId, '')
    const taskId = await api.generate(sessionId, yes)
    void followAnswer(accountId, sessionId, taskId)
  } catch (err) {
    // Still undecided: ask again
    updateChat(accountId, sessionId, (c) => {
      c.failed = aiErrorText(err)
      c.pending = pending
    })
  }
}

/** Writes an answer again */
export async function regenerate(accountId: string, sessionId: number, messageId: number): Promise<void> {
  updateChat(accountId, sessionId, (c) => {
    const i = (c.messages ?? []).findIndex((m) => m.id === messageId)
    if (i !== -1) c.messages = c.messages!.slice(0, i)
    c.failed = undefined
    c.pending = null
  })
  try {
    const taskId = await assistant(accountId).regenerate(sessionId, messageId)
    void followAnswer(accountId, sessionId, taskId)
  } catch (err) {
    updateChat(accountId, sessionId, (c) => void (c.failed = aiErrorText(err)))
  }
}

/** Asks for the answer again, after it failed or was stopped */
export async function retryAnswer(accountId: string, sessionId: number): Promise<void> {
  updateChat(accountId, sessionId, (c) => void (c.failed = undefined))
  try {
    const taskId = await assistant(accountId).generate(sessionId)
    void followAnswer(accountId, sessionId, taskId)
  } catch (err) {
    updateChat(accountId, sessionId, (c) => void (c.failed = aiErrorText(err)))
  }
}

/** Stops the answer being written */
export async function stopAnswer(accountId: string, sessionId: number): Promise<void> {
  const taskId = assistantOf(accountId)?.chats[sessionId]?.generating?.taskId
  if (!taskId) return
  const api = talk(accountId)
  await api.stopTask(taskId).catch(() => api.cancelTask(taskId).catch(() => undefined))
}

/** Follows an answer until it's there, showing it as it's written */
async function followAnswer(accountId: string, sessionId: number, taskId: number): Promise<void> {
  const key = `${accountId}:${sessionId}:${taskId}`
  if (pollers.has(key)) return
  pollers.add(key)
  const api = assistant(accountId)
  const started = Date.now()
  updateChat(accountId, sessionId, (c) => {
    c.generating = { taskId, stage: null }
    c.sending = false
  })
  try {
    for (let round = 0; ; round++) {
      // The conversation was deleted meanwhile
      if (!assistantOf(accountId)?.chats[sessionId]) return
      const check = await api.checkGeneration(sessionId, taskId)
      if (check.state === 'done') {
        updateChat(accountId, sessionId, (c) => {
          if (!(c.messages ?? []).some((m) => m.id === check.message.id)) {
            c.messages = [...(c.messages ?? []), check.message]
          }
          c.pending = check.pending
          c.generating = undefined
        })
        return
      }
      if (check.state === 'failed') {
        updateChat(accountId, sessionId, (c) => {
          c.generating = undefined
          c.failed = check.cancelled ? 'Stopped' : check.error
        })
        return
      }
      let stage: TaskStage = check.running ? { stage: 'running' } : { stage: 'scheduled', slow: check.slow }
      if (!check.running && round % 4 === 0) {
        const res = await talk(accountId).taskQueuePosition(taskId)
        if (res.ok && typeof res.data === 'number')
          stage = { stage: 'scheduled', slow: check.slow, position: res.data }
      }
      updateChat(accountId, sessionId, (c) => {
        const before = c.generating
        c.generating = {
          taskId,
          // Keep the last known place in line between the rounds that ask for it
          stage:
            stage.stage === 'scheduled' && !stage.position && before?.stage?.stage === 'scheduled'
              ? { ...stage, position: before.stage.position }
              : stage,
          partial: check.partial ? cleanAiOutput(check.partial) : before?.partial,
          reasoning: check.reasoning || before?.reasoning
        }
      })
      if (Date.now() - started > GIVE_UP) {
        updateChat(accountId, sessionId, (c) => {
          c.generating = undefined
          c.failed = 'The server’s AI is taking too long. The answer may still show up later.'
        })
        return
      }
      await new Promise((r) => setTimeout(r, POLL))
    }
  } catch (err) {
    updateChat(accountId, sessionId, (c) => {
      c.generating = undefined
      c.failed = aiErrorText(err)
    })
  } finally {
    pollers.delete(key)
  }
}

async function followTitle(accountId: string, sessionId: number, taskId: number): Promise<void> {
  const api = assistant(accountId)
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2_000))
    const title = await api.checkTitle(sessionId, taskId).catch(() => '')
    if (title === null) continue
    if (title) {
      updateAssistant(accountId, (a) => {
        const s = a.sessions?.find((x) => x.id === sessionId)
        if (s) s.title = cleanAiOutput(title).replace(/^["“]|["”]$/g, '')
      })
    }
    return
  }
}

export async function renameSession(accountId: string, sessionId: number, title: string): Promise<void> {
  const before = assistantOf(accountId)?.sessions?.find((s) => s.id === sessionId)?.title ?? null
  updateAssistant(accountId, (a) => {
    const s = a.sessions?.find((x) => x.id === sessionId)
    if (s) s.title = title
  })
  try {
    await assistant(accountId).updateSession(sessionId, { title })
  } catch (err) {
    updateAssistant(accountId, (a) => {
      const s = a.sessions?.find((x) => x.id === sessionId)
      if (s) s.title = before
    })
    showToast(`Couldn’t rename the conversation: ${aiErrorText(err)}`, 'error')
  }
}

/** Keeps a conversation in the agent's memory, or not */
export async function rememberSession(accountId: string, sessionId: number, on: boolean): Promise<void> {
  updateAssistant(accountId, (a) => {
    const s = a.sessions?.find((x) => x.id === sessionId)
    if (s) s.is_remembered = on
  })
  try {
    await assistant(accountId).updateSession(sessionId, { is_remembered: on })
  } catch (err) {
    updateAssistant(accountId, (a) => {
      const s = a.sessions?.find((x) => x.id === sessionId)
      if (s) s.is_remembered = !on
    })
    showToast(`Couldn’t change that: ${aiErrorText(err)}`, 'error')
  }
}

export async function deleteSession(accountId: string, sessionId: number): Promise<void> {
  try {
    await assistant(accountId).deleteSession(sessionId)
    updateAssistant(accountId, (a) => {
      a.sessions = (a.sessions ?? []).filter((s) => s.id !== sessionId)
      delete a.chats[sessionId]
      delete a.drafts[String(sessionId)]
      if (a.page?.kind === 'chat' && a.page.sessionId === sessionId)
        a.page = { kind: 'chat', sessionId: null }
    })
  } catch (err) {
    showToast(`Couldn’t delete the conversation: ${aiErrorText(err)}`, 'error')
  }
}

// --- Tools ---------------------------------------------------------------------------

function updateRun(accountId: string, id: string, fn: (r: ToolRun) => void): void {
  updateAssistant(accountId, (a) => {
    const run = a.runs.find((r) => r.id === id)
    if (run) fn(run)
  })
}

/** Runs a tool with what was filled in, and shows its result when it's done */
export async function runTool(
  accountId: string,
  type: string,
  input: Record<string, unknown>,
  notify: boolean
): Promise<void> {
  const id = crypto.randomUUID()
  updateAssistant(accountId, (a) => {
    a.runs.unshift({ id, type, input, status: 'starting', at: Date.now() })
    a.page = { kind: 'tool', type, runId: id }
  })
  try {
    const task = await scheduleTask(accountId, type, input, TOOL_RUN_ID)
    updateRun(accountId, id, (r) => {
      r.taskId = task.id
      r.status = 'waiting'
    })
    if (notify)
      void assistant(accountId)
        .notifyWhenDone(task.id)
        .catch(() => undefined)
    await followRun(accountId, id, task.id)
  } catch (err) {
    updateRun(accountId, id, (r) => {
      r.status = 'failed'
      r.error = aiErrorText(err)
    })
  }
}

async function followRun(accountId: string, id: string, taskId: number): Promise<void> {
  try {
    const task = await waitForTaskDone(accountId, taskId, {
      onUpdate: (u) =>
        updateRun(accountId, id, (r) => {
          r.stage = u.stage
          if (u.partial) r.partial = u.partial
        })
    })
    updateRun(accountId, id, (r) => {
      r.status = 'done'
      r.task = task
      r.stage = null
    })
    // Done while you were looking at something else
    const page = assistantOf(accountId)?.page
    const app = useApp.getState()
    const looking =
      app.activeAccountId === accountId &&
      app.accounts[accountId]?.view === 'assistant' &&
      page?.kind === 'tool' &&
      page.runId === id
    if (!looking) {
      const name = assistantOf(accountId)?.types?.[task.type]?.name ?? 'Your AI task'
      showToast(`“${name}” is done: you’ll find it in the Assistant`)
    }
  } catch (err) {
    updateRun(accountId, id, (r) => {
      r.status = 'failed'
      r.error = aiErrorText(err)
      r.stage = null
    })
  }
}

/** Stops a tool run */
export async function stopRun(accountId: string, id: string): Promise<void> {
  const run = assistantOf(accountId)?.runs.find((r) => r.id === id)
  if (!run?.taskId) return
  const api = talk(accountId)
  await api.stopTask(run.taskId).catch(() => api.cancelTask(run.taskId!).catch(() => undefined))
}

/** The tool runs the server keeps, newest first */
export async function loadHistory(accountId: string): Promise<void> {
  try {
    const { tasks } = await talk(accountId).hubbubTasks(TOOL_RUN_ID)
    updateAssistant(accountId, (a) => {
      a.history = [...tasks].sort((x, y) => (y.lastUpdated ?? 0) - (x.lastUpdated ?? 0) || y.id - x.id)
      a.historyError = undefined
    })
  } catch (err) {
    updateAssistant(accountId, (a) => {
      a.history ??= []
      a.historyError = aiErrorText(err)
    })
  }
}

/** Shows an earlier run, from the history, with its tool */
export function openHistoryTask(accountId: string, task: AiTask): void {
  const existing = assistantOf(accountId)?.runs.find((r) => r.taskId === task.id)
  if (existing) {
    openPage(accountId, { kind: 'tool', type: existing.type, runId: existing.id })
    return
  }
  const id = crypto.randomUUID()
  const finished = task.status === 'STATUS_SUCCESSFUL'
  const failed = task.status === 'STATUS_FAILED' || task.status === 'STATUS_CANCELLED'
  updateAssistant(accountId, (a) => {
    a.runs.push({
      id,
      type: task.type,
      input: task.input ?? {},
      taskId: task.id,
      status: finished ? 'done' : failed ? 'failed' : 'waiting',
      task: finished ? task : undefined,
      error: failed ? taskError(task) : undefined,
      at: (task.scheduledAt ?? task.lastUpdated ?? 0) * 1000
    })
    a.page = { kind: 'tool', type: task.type, runId: id }
  })
  if (!finished && !failed) void followRun(accountId, id, task.id)
}

export async function deleteHistoryTask(accountId: string, taskId: number): Promise<void> {
  try {
    await talk(accountId).cancelTask(taskId)
    updateAssistant(accountId, (a) => {
      a.history = (a.history ?? []).filter((t) => t.id !== taskId)
      a.runs = a.runs.filter((r) => r.taskId !== taskId)
    })
  } catch (err) {
    showToast(`Couldn’t remove it: ${aiErrorText(err)}`, 'error')
  }
}
