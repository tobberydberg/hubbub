import { useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import { useAssistant } from '@renderer/store/assistant'
import { openSession } from '@renderer/sync/assistant'
import { ChatPane } from './ChatPane'
import { HistoryPane } from './HistoryPane'
import { ToolPane } from './ToolPane'

// The Assistant's main area: a chat, a tool, or the earlier results.

export function AssistantView({ accountId }: { accountId: string }) {
  const page = useAssistant((s) => s.accounts[accountId]?.page)
  const loaded = useAssistant((s) => !!s.accounts[accountId]?.types)
  const sessionId = page?.kind === 'chat' ? page.sessionId : null
  const opened = useAssistant((s) => (sessionId === null ? true : !!s.accounts[accountId]?.chats[sessionId]))

  // A conversation shown again after Hubbub started (or one picked elsewhere) gets its messages
  useEffect(() => {
    if (sessionId !== null && !opened) void openSession(accountId, sessionId)
  }, [accountId, sessionId, opened])

  if (!page) {
    return (
      <main className="center">
        <div className="empty-state">
          {loaded ? (
            <>
              <Sparkles size={56} strokeWidth={1.5} />
              <h2>No AI on this server</h2>
              <p>
                An administrator can set one up, such as Nextcloud Assistant with a local model, or the OpenAI
                and LocalAI integration with any OpenAI-compatible service.
              </p>
            </>
          ) : (
            <div className="spinner" />
          )}
        </div>
      </main>
    )
  }
  if (page.kind === 'chat')
    return <ChatPane key={String(page.sessionId)} accountId={accountId} sessionId={page.sessionId} />
  if (page.kind === 'tool')
    return <ToolPane key={page.type} accountId={accountId} type={page.type} runId={page.runId} />
  return <HistoryPane accountId={accountId} />
}
