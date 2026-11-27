import type { HttpMethod, OcsResponse, QueryValue } from '@shared/ipc'
import { TalkError } from './talk'

// Nextcloud Assistant's chat ("Chat with AI"), the same conversations as on the web: sessions with
// their messages, kept by the Assistant app. Its answers are written by an AI task the app schedules;
// with the Context Agent the AI can also act for you, after you confirm. The chat endpoints answer
// with plain JSON (not OCS), and with 417 while an answer is still being written. These have been
// the same since Assistant 3.x.

const CHAT = '/ocs/v2.php/apps/assistant/chat'
const API = '/ocs/v2.php/apps/assistant/api/v1'

export interface ChatSession {
  id: number
  title: string | null
  /** Unix time it was started */
  timestamp: number | null
  /** Kept in the agent's memory (Assistant 4+) */
  is_remembered?: boolean
  agency_pending_actions?: string | null
}

export interface ChatMessage {
  id: number
  session_id: number
  /** human or assistant */
  role: string
  content: string
  timestamp: number
  /** JSON list of what the answer used (the agent's tools, documents) */
  sources?: string
  reasoning?: string | null
  attachments?: { type: string; fileId?: number; file_id?: number }[]
  ocp_task_id?: number | null
}

/** Something the agent wants to do, waiting for your OK */
export interface AgentAction {
  name: string
  args?: Record<string, unknown>
  icon?: string
  /** Deletes or overwrites something */
  destructive?: boolean | null
  /** "irreversible" when it can't be undone */
  reversibility?: string | null
  /** Who it affects: self, individuals, group, external */
  impulse_radius?: string | null
  item_count?: number | null
}

export type GenerationCheck =
  | { state: 'done'; message: ChatMessage; pending: AgentAction[] | null }
  | { state: 'waiting'; running: boolean; slow: boolean; partial?: string; reasoning?: string }
  | { state: 'failed'; error: string; cancelled: boolean }

export interface SessionCheck {
  messageTaskId: number | null
  titleTaskId: number | null
  sessionTitle: string | null
  sessionAgencyPendingActions: AgentAction[] | Record<string, AgentAction> | null
  is_remembered?: boolean | null
}

/** Task::STATUS_CANCELLED */
const TASK_CANCELLED = 5

export function assistant(accountId: string) {
  const req = <T>(
    method: HttpMethod,
    path: string,
    opts: { query?: Record<string, QueryValue>; body?: Record<string, unknown> } = {}
  ): Promise<OcsResponse<T>> => window.hubbub.ocs<T>({ accountId, method, path, ...opts })
  const call = async <T>(
    method: HttpMethod,
    path: string,
    opts: { query?: Record<string, QueryValue>; body?: Record<string, unknown> } = {}
  ): Promise<T> => {
    const res = await req<T>(method, path, opts)
    if (!res.ok) throw new TalkError(res.error || `HTTP ${res.status}`, res.status)
    return res.data as T
  }
  const now = (): number => Math.floor(Date.now() / 1000)

  return {
    sessions: () => call<ChatSession[]>('GET', `${CHAT}/sessions`),
    newSession: async (title?: string) =>
      (
        await call<{ session: ChatSession }>('PUT', `${CHAT}/new_session`, {
          body: { timestamp: now(), title }
        })
      ).session,
    /** Renames a conversation, or keeps it in (or out of) the agent's memory */
    updateSession: (sessionId: number, patch: { title?: string; is_remembered?: boolean }) =>
      call<unknown>('PUT', `${CHAT}/sessions/${sessionId}`, { body: patch }),
    deleteSession: (sessionId: number) => call<unknown>('DELETE', `${CHAT}/sessions/${sessionId}`),
    /** Messages oldest first, `limit` of them from `cursor` (counted from the newest) */
    messages: (sessionId: number, limit = 50, cursor = 0) =>
      call<ChatMessage[]>('GET', `${CHAT}/messages`, { query: { sessionId, limit, cursor } }),
    addMessage: (sessionId: number, content: string, firstHumanMessage = false) =>
      call<ChatMessage>('PUT', `${CHAT}/new_message`, {
        body: { sessionId, role: 'human', content, timestamp: now(), firstHumanMessage }
      }),
    /** Starts the answer; agencyConfirm answers the agent's question (1 do it, 0 don't) */
    generate: async (sessionId: number, agencyConfirm?: boolean) =>
      (
        await call<{ taskId: number }>('GET', `${CHAT}/generate`, {
          query: {
            sessionId,
            ...(agencyConfirm === undefined ? {} : { agencyConfirm: agencyConfirm ? 1 : 0 })
          }
        })
      ).taskId,
    /** Removes an answer (and what came after it) and writes it again */
    regenerate: async (sessionId: number, messageId: number) =>
      (await call<{ taskId: number }>('GET', `${CHAT}/regenerate`, { query: { sessionId, messageId } }))
        .taskId,
    checkGeneration: async (sessionId: number, taskId: number): Promise<GenerationCheck> => {
      const res = await req<Record<string, unknown>>('GET', `${CHAT}/check_generation`, {
        query: { sessionId, taskId }
      })
      const data = (res.data ?? {}) as Record<string, unknown>
      if (res.ok) {
        const { sessionAgencyPendingActions, ...message } = data
        return {
          state: 'done',
          message: message as unknown as ChatMessage,
          pending: pendingActions(sessionAgencyPendingActions)
        }
      }
      if (res.status === 417) {
        const output = data.task_output as { output?: unknown; reasoning?: unknown } | null | undefined
        return {
          state: 'waiting',
          running: data.task_status === 2,
          slow: !!data.slow_pickup,
          partial: typeof output?.output === 'string' ? output.output : undefined,
          reasoning: typeof output?.reasoning === 'string' ? output.reasoning : undefined
        }
      }
      if (res.status === 400 && data.task_status !== undefined) {
        return {
          state: 'failed',
          cancelled: data.task_status === TASK_CANCELLED,
          error:
            typeof data.userFacingErrorMessage === 'string' && data.userFacingErrorMessage
              ? data.userFacingErrorMessage
              : 'The AI couldn’t answer'
        }
      }
      throw new TalkError(res.error || `HTTP ${res.status}`, res.status)
    },
    checkSession: (sessionId: number) =>
      call<SessionCheck>('GET', `${CHAT}/check_session`, { query: { sessionId } }),
    generateTitle: async (sessionId: number) =>
      (await call<{ taskId: number }>('GET', `${CHAT}/generate_title`, { query: { sessionId } })).taskId,
    /** The title once it's written: null while it's being written */
    checkTitle: async (sessionId: number, taskId: number): Promise<string | null> => {
      const res = await req<{ result?: string }>('GET', `${CHAT}/check_title_generation`, {
        query: { sessionId, taskId }
      })
      if (res.ok) return res.data?.result ?? ''
      if (res.status === 417) return null
      throw new TalkError(res.error || `HTTP ${res.status}`, res.status)
    },
    /** A notification on the server when a task has finished */
    notifyWhenDone: (taskId: number) => call<unknown>('POST', `${API}/task/${taskId}/notify`),
    /** Saves a task's output file into your files; its path there */
    saveOutputFile: async (taskId: number, fileId: number) =>
      (await call<{ path?: string }>('POST', `${API}/task/${taskId}/file/${fileId}/save`))?.path ?? null,
    /** The Assistant's folder in your files, where uploads for tasks go */
    folderPath: async () => {
      const data = await call<string | { path?: string }>('GET', `${API}/assistant-folder-path`)
      return typeof data === 'string' ? data : (data?.path ?? null)
    }
  }
}

/** The agent's pending actions, as a list (the Assistant sends them as a list or an object) */
export function pendingActions(raw: unknown): AgentAction[] | null {
  if (!raw) return null
  const list = Array.isArray(raw) ? raw : typeof raw === 'object' ? Object.values(raw) : []
  const actions = list.filter((a): a is AgentAction => !!a && typeof a === 'object' && 'name' in a)
  return actions.length ? actions : null
}
