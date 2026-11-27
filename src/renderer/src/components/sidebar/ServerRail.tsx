import { useState } from 'react'
import { Calendar, MessagesSquare, Plus, Sparkles } from 'lucide-react'
import { toolTypes } from '@renderer/lib/ai-tasks'
import { initials } from '@renderer/lib/messages'
import { setApp, useApp } from '@renderer/store/app'
import { reorderAccounts, selectAccount } from '@renderer/sync/actions'
import { openInvitations, showCalendar } from '@renderer/sync/calendar'
import { useCalendar } from '@renderer/store/calendar'
import { accountTotals } from '@renderer/sync/engine'
import { useAiTaskTypes } from '@renderer/sync/ai'
import { showAssistant } from '@renderer/sync/assistant'

const shortcut = window.hubbub.platform === 'darwin' ? '⌘' : 'Ctrl+'

/** How many invitations wait for an answer, on the calendar switch */
function InvitationBadge({ accountId }: { accountId: string }) {
  useCalendar((s) => s.accounts[accountId]?.invitations)
  const n = openInvitations(accountId).length
  return n ? (
    <span className="server-mode-badge" title={`${n} unanswered ${n === 1 ? 'invitation' : 'invitations'}`}>
      {n}
    </span>
  ) : null
}

/** The switch to the AI assistant, when the server has AI */
function AssistantMode({ accountId, on }: { accountId: string; on: boolean }) {
  const types = useAiTaskTypes(accountId)
  if (!on && (!types || !toolTypes(types).length)) return null
  return (
    <button
      role="tab"
      aria-selected={on}
      className={`server-mode${on ? ' on' : ''}`}
      title="Assistant (AI)"
      onClick={() => showAssistant(accountId)}
    >
      <Sparkles size={18} strokeWidth={1.75} />
    </button>
  )
}

export function ServerRail() {
  const order = useApp((s) => s.accountOrder)
  const accounts = useApp((s) => s.accounts)
  const activeId = useApp((s) => s.activeAccountId)
  const [dragId, setDragId] = useState<string | null>(null)

  const onDrop = (targetId: string): void => {
    if (!dragId || dragId === targetId) return
    const ids = order.filter((id) => id !== dragId)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    void reorderAccounts(ids)
  }

  return (
    <nav className="server-rail" aria-label="Servers">
      {order.map((id, i) => {
        const a = accounts[id]
        if (!a) return null
        const { mentions, unread } = accountTotals(a)
        const active = id === activeId
        const title = `${a.info.label} — ${a.info.serverUrl.replace(/^https?:\/\//, '')}${i < 9 ? ` (${shortcut}${i + 1})` : ''}`
        const calendar = a.view === 'calendar'
        const ai = a.view === 'assistant'
        return (
          <div key={id} className="server-slot">
            <button
              className={`server-btn${active ? ' active' : ''}${unread ? ' unread' : ''}${dragId === id ? ' dragging' : ''}`}
              style={{ background: a.info.color }}
              title={title}
              onClick={() => selectAccount(id)}
              draggable
              onDragStart={() => setDragId(id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => dragId && e.preventDefault()}
              onDrop={() => onDrop(id)}
              onContextMenu={() => setApp({ modal: { type: 'server-settings', accountId: id } })}
            >
              {initials(a.info.label)}
              {unread && !mentions && <span className="server-unread-dot" />}
              {mentions > 0 && <span className="server-badge">{mentions > 99 ? '99+' : mentions}</span>}
              {a.status !== 'online' && (
                <span
                  className={`server-status ${a.status === 'connecting' ? 'connecting' : a.status === 'unauthorized' ? 'unauthorized' : ''}`}
                  title={a.status === 'unauthorized' ? 'Signed out – sign in again' : a.error}
                />
              )}
            </button>
            {active && (
              <div
                className="server-modes"
                role="tablist"
                aria-label={`${a.info.label}: chat, calendar or assistant`}
              >
                <button
                  role="tab"
                  aria-selected={!calendar && !ai}
                  className={`server-mode${calendar || ai ? '' : ' on'}`}
                  title="Chat"
                  onClick={() => showCalendar(id, false)}
                >
                  <MessagesSquare size={17} />
                </button>
                <button
                  role="tab"
                  aria-selected={calendar}
                  className={`server-mode${calendar ? ' on' : ''}`}
                  title="Calendar"
                  onClick={() => showCalendar(id, true)}
                >
                  <Calendar size={19} strokeWidth={1.75} />
                  <span className="server-mode-date">{new Date().getDate()}</span>
                  <InvitationBadge accountId={id} />
                </button>
                <AssistantMode accountId={id} on={ai} />
              </div>
            )}
          </div>
        )
      })}
      <button
        className="server-add"
        title="Add a server"
        onClick={() => setApp({ modal: { type: 'add-server' } })}
      >
        <Plus size={20} />
      </button>
    </nav>
  )
}
