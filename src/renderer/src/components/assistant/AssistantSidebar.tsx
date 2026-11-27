import { useEffect } from 'react'
import { AudioLines, History, Image, MessageSquare, Plus, Settings2, Sparkles, Wrench } from 'lucide-react'
import { GROUP_NAMES, groupOf, toolTypes, type ToolGroup } from '@renderer/lib/ai-tasks'
import { setApp, useApp } from '@renderer/store/app'
import { useAssistant } from '@renderer/store/assistant'
import { loadAssistant, openPage } from '@renderer/sync/assistant'
import { CallWidget } from '../calls/CallWidget'

// The Assistant's sidebar: your conversations with the AI (Nextcloud Assistant), the tools the
// server's AI offers, grouped by what they work with, and earlier results.

const GROUP_ICONS: Record<ToolGroup, React.ReactNode> = {
  text: <Sparkles size={15} />,
  images: <Image size={15} />,
  audio: <AudioLines size={15} />,
  other: <Wrench size={15} />
}

export function AssistantSidebar({ accountId }: { accountId: string }) {
  const label = useApp((s) => s.accounts[accountId]?.info.label)
  const state = useAssistant((s) => s.accounts[accountId])
  const loaded = !!state?.types

  useEffect(() => {
    if (!loaded) void loadAssistant(accountId)
  }, [accountId, loaded])

  const page = state?.page
  const tools = state?.types ? toolTypes(state.types) : []
  const groups = (['text', 'images', 'audio', 'other'] as ToolGroup[])
    .map((g) => ({ group: g, tools: tools.filter((t) => groupOf(t) === g) }))
    .filter((g) => g.tools.length)
  const chat = state?.assistant !== null && state?.assistant !== undefined
  const busy = (sessionId: number): boolean => !!state?.chats[sessionId]?.generating

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-header-title static">{label}</span>
      </div>
      <div className="sidebar-scroll cal-side ai-side">
        {chat && (
          <button className="cal-new" onClick={() => openPage(accountId, { kind: 'chat', sessionId: null })}>
            <Plus size={16} /> New chat
          </button>
        )}
        {chat && (
          <div className="cal-section">
            <div className="cal-section-title">Chats</div>
            {state?.sessions === undefined || state.sessions === null ? (
              <p className="cal-side-note">Loading…</p>
            ) : state.sessions.length === 0 ? (
              <p className="cal-side-note">{state.sessionsError ?? 'No conversations yet'}</p>
            ) : (
              state.sessions.map((s) => {
                const active = page?.kind === 'chat' && page.sessionId === s.id
                return (
                  <button
                    key={s.id}
                    className={`cal-item ai-item${active ? ' active' : ''}`}
                    onClick={() => openPage(accountId, { kind: 'chat', sessionId: s.id })}
                    title={s.title ?? undefined}
                  >
                    <MessageSquare size={15} />
                    <span className="cal-item-name">{s.title || 'New conversation'}</span>
                    {busy(s.id) && <span className="ai-busy-dot" title="Writing an answer" />}
                  </button>
                )
              })
            )}
          </div>
        )}
        {groups.map(({ group, tools: list }) => (
          <div key={group} className="cal-section">
            <div className="cal-section-title">{GROUP_NAMES[group]}</div>
            {list.map((t) => {
              const active = page?.kind === 'tool' && page.type === t.id
              const running = state?.runs.some(
                (r) => r.type === t.id && (r.status === 'waiting' || r.status === 'starting')
              )
              return (
                <button
                  key={t.id}
                  className={`cal-item ai-item${active ? ' active' : ''}`}
                  onClick={() => openPage(accountId, { kind: 'tool', type: t.id })}
                  title={t.description || undefined}
                >
                  {GROUP_ICONS[group]}
                  <span className="cal-item-name">{t.name}</span>
                  {running && <span className="ai-busy-dot" title="Working" />}
                </button>
              )
            })}
          </div>
        ))}
        {loaded && !chat && !tools.length && <p className="cal-side-note">This server has no AI set up.</p>}
        {tools.length > 0 && (
          <button
            className={`cal-side-link${page?.kind === 'history' ? ' active' : ''}`}
            onClick={() => openPage(accountId, { kind: 'history' })}
          >
            <History size={14} /> Earlier results
          </button>
        )}
        <button className="cal-side-link" onClick={() => setApp({ modal: { type: 'settings', tab: 'ai' } })}>
          <Settings2 size={14} /> Model and settings…
        </button>
      </div>
      <CallWidget />
    </aside>
  )
}
