import { RefreshCw, Trash2 } from 'lucide-react'
import type { AiTask } from '@renderer/api/talk'
import type { TaskType } from '@renderer/lib/ai-tasks'
import { useAssistant } from '@renderer/store/assistant'
import { deleteHistoryTask, loadHistory, openHistoryTask } from '@renderer/sync/assistant'

// Earlier tool results, as your Nextcloud server keeps them (it clears old ones after a while).

const STATUS: Record<string, string> = {
  STATUS_SCHEDULED: 'Waiting',
  STATUS_RUNNING: 'Working',
  STATUS_SUCCESSFUL: '',
  STATUS_FAILED: 'Failed',
  STATUS_CANCELLED: 'Cancelled'
}

/** The task's own text input (not an option such as the model), short, to recognise a run by */
function preview(task: AiTask, type: TaskType | undefined): string {
  const input = task.input ?? {}
  const keys = type
    ? Object.entries(type.inputShape)
        .filter(([, s]) => s.type === 'Text')
        .map(([k]) => k)
    : ['input']
  const text = keys
    .map((k) => input[k])
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0)
  return text ? text.replace(/\s+/g, ' ').slice(0, 160) : ''
}

export function HistoryPane({ accountId }: { accountId: string }) {
  const history = useAssistant((s) => s.accounts[accountId]?.history)
  const error = useAssistant((s) => s.accounts[accountId]?.historyError)
  const types = useAssistant((s) => s.accounts[accountId]?.types)

  return (
    <main className="center ai-pane">
      <div className="channel-header">
        <div className="ch-main">
          <div className="ch-title-row">
            <span className="ch-title">Earlier results</span>
          </div>
          <div className="ch-meta">
            What you ran with the AI tools from Hubbub, kept by your Nextcloud server
          </div>
        </div>
        <button className="icon-btn" title="Refresh" onClick={() => void loadHistory(accountId)}>
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="ai-tool-scroll">
        <div className="ai-tool">
          {error && <p className="ai-error">{error}</p>}
          {history === undefined || history === null ? (
            <div className="empty-state">
              <div className="spinner" />
            </div>
          ) : !history.length ? (
            <div className="empty-state">
              <p>Nothing yet. Results of the tools show up here.</p>
            </div>
          ) : (
            <ul className="ai-history">
              {history.map((t) => (
                <li key={t.id}>
                  <button className="ai-history-item" onClick={() => openHistoryTask(accountId, t)}>
                    <span className="ai-history-top">
                      <strong>{types?.[t.type]?.name ?? t.type}</strong>
                      {STATUS[t.status] && <span className="ai-history-status">{STATUS[t.status]}</span>}
                      <span className="ai-history-when">
                        {t.lastUpdated
                          ? new Date(t.lastUpdated * 1000).toLocaleString([], {
                              dateStyle: 'medium',
                              timeStyle: 'short'
                            })
                          : ''}
                      </span>
                    </span>
                    {preview(t, types?.[t.type]) && (
                      <span className="ai-history-input">{preview(t, types?.[t.type])}</span>
                    )}
                  </button>
                  <button
                    className="icon-btn small"
                    title="Remove it from the server"
                    onClick={() => void deleteHistoryTask(accountId, t.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
