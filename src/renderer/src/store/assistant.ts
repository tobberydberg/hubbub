import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { AgentAction, ChatMessage, ChatSession } from '@renderer/api/assistant'
import type { AiTask } from '@renderer/api/talk'
import type { TaskStage, TaskType } from '@renderer/lib/ai-tasks'

// The Assistant view per server: chats with the AI (Nextcloud Assistant's conversations), the tools
// (every kind of task the server's AI offers) and what they gave, kept while Hubbub runs so leaving
// the view and coming back finds everything as it was, and answers keep coming meanwhile.

export type AssistantPage =
  /** A conversation; null is a new one, made when its first message is sent */
  | { kind: 'chat'; sessionId: number | null }
  /** A tool's form, with one of its runs shown */
  | { kind: 'tool'; type: string; runId?: string }
  | { kind: 'history' }

/** An answer being written */
export interface Generation {
  taskId: number
  stage: TaskStage | null
  partial?: string
  reasoning?: string
}

export interface ChatState {
  /** Oldest first; null while loading */
  messages: ChatMessage[] | null
  hasOlder: boolean
  error?: string
  generating?: Generation
  /** A message on its way, before its answer has started */
  sending?: boolean
  /** What the agent wants to do, waiting for your OK */
  pending?: AgentAction[] | null
  /** Why the last answer didn't come */
  failed?: string
}

export interface ToolRun {
  id: string
  type: string
  input: Record<string, unknown>
  taskId?: number
  status: 'starting' | 'waiting' | 'done' | 'failed'
  stage?: TaskStage | null
  partial?: string
  /** The finished task, with its output */
  task?: AiTask
  error?: string
  /** ms */
  at: number
}

export interface AccountAssistant {
  page: AssistantPage | null
  types?: Record<string, TaskType>
  /** Nextcloud Assistant's version; null when it isn't there (no chat) */
  assistant?: string | null
  /** Newest first; null while loading */
  sessions?: ChatSession[] | null
  sessionsError?: string
  chats: Record<number, ChatState>
  /** Tool runs since Hubbub started, newest first */
  runs: ToolRun[]
  /** Earlier tool runs, as the server keeps them; null while loading */
  history?: AiTask[] | null
  historyError?: string
  /** What's typed in each tool's form, kept when switching */
  forms: Record<string, Record<string, unknown>>
  /** The message being written in each chat ("new" for a new one) */
  drafts: Record<string, string>
}

interface AssistantStore {
  accounts: Record<string, AccountAssistant>
}

export const useAssistant = create<AssistantStore>()(immer(() => ({ accounts: {} }) as AssistantStore))

const empty = (): AccountAssistant => ({ page: null, chats: {}, runs: [], forms: {}, drafts: {} })

export function updateAssistant(accountId: string, fn: (a: AccountAssistant) => void): void {
  useAssistant.setState((s) => {
    fn((s.accounts[accountId] ??= empty()))
  })
}

export function assistantOf(accountId: string): AccountAssistant | undefined {
  return useAssistant.getState().accounts[accountId]
}
