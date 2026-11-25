import { useEffect, useState, type ReactNode } from 'react'
import { BarChart3, CornerDownRight, KanbanSquare, MapPin, Mic, Paperclip, Video } from 'lucide-react'
import { media } from '@shared/ipc'
import type { ChatMessage, RichObjectParameter } from '@shared/talk-types'
import { talk, type SharedItemType } from '@renderer/api/talk'
import { formatBytes, params } from '@renderer/lib/messages'
import { setApp } from '@renderer/store/app'
import { jumpToMessage } from '@renderer/sync/actions'
import { FileTypeIcon } from '../channel/Attachments'

// Everything shared in a conversation, like Talk's "Shared items": pictures and videos, files,
// voice messages, polls, locations, Deck cards and recordings, newest first, each kind with more on
// request.

const OVERVIEW = 7

const SECTIONS: { type: SharedItemType; title: string }[] = [
  { type: 'media', title: 'Media' },
  { type: 'file', title: 'Files' },
  { type: 'voice', title: 'Voice messages' },
  { type: 'audio', title: 'Audio' },
  { type: 'recording', title: 'Recordings' },
  { type: 'poll', title: 'Polls' },
  { type: 'location', title: 'Locations' },
  { type: 'deckcard', title: 'Deck cards' },
  { type: 'other', title: 'Other' }
]

type Items = Partial<Record<SharedItemType, ChatMessage[]>>

export function SharedItemsPanel({ accountId, token }: { accountId: string; token: string }) {
  const [items, setItems] = useState<Items | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Kinds where everything is loaded */
  const [complete, setComplete] = useState<Partial<Record<SharedItemType, boolean>>>({})
  const [loading, setLoading] = useState<SharedItemType | null>(null)

  useEffect(() => {
    let current = true
    setItems(null)
    setComplete({})
    talk(accountId)
      .sharedOverview(token, OVERVIEW)
      .then((data) => {
        if (!current) return
        setItems(data)
        const done: Partial<Record<SharedItemType, boolean>> = {}
        for (const s of SECTIONS) done[s.type] = (data[s.type]?.length ?? 0) < OVERVIEW
        setComplete(done)
      })
      .catch((e: unknown) => current && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      current = false
    }
  }, [accountId, token])

  const more = async (type: SharedItemType): Promise<void> => {
    const shown = items?.[type] ?? []
    setLoading(type)
    try {
      const older = await talk(accountId).sharedItems(token, type, shown[shown.length - 1]?.id, 50)
      setItems((prev) => ({ ...prev, [type]: [...(prev?.[type] ?? []), ...older] }))
      if (older.length < 50) setComplete((c) => ({ ...c, [type]: true }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(null)
  }

  if (error) return <div className="empty-state">{error}</div>
  if (!items) {
    return (
      <div className="empty-state">
        <div className="spinner" />
      </div>
    )
  }
  const sections = SECTIONS.filter((s) => items[s.type]?.length)
  if (!sections.length) {
    return (
      <div className="empty-state">
        <Paperclip size={28} />
        <p>Nothing has been shared here yet.</p>
      </div>
    )
  }

  const go = (m: ChatMessage): void => void jumpToMessage(accountId, token, m.id)

  return (
    <div className="rhs-body shared-items">
      {sections.map(({ type, title }) => {
        const list = items[type] ?? []
        return (
          <section key={type} className="shared-section">
            <div className="rhs-section-title">{title}</div>
            {type === 'media' ? (
              <div className="shared-media">
                {list.map((m) => (
                  <MediaTile key={m.id} accountId={accountId} m={m} onGo={() => go(m)} />
                ))}
              </div>
            ) : (
              list.map((m) => <ItemRow key={m.id} type={type} m={m} onGo={() => go(m)} />)
            )}
            {!complete[type] && (
              <button className="shared-more" disabled={loading === type} onClick={() => void more(type)}>
                {loading === type ? 'Loading…' : 'Show more'}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}

const fileOf = (m: ChatMessage): RichObjectParameter | undefined => params(m).file
const objectOf = (m: ChatMessage): RichObjectParameter | undefined => params(m).object

const when = (m: ChatMessage): string =>
  new Date(m.timestamp * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })

function MediaTile({ accountId, m, onGo }: { accountId: string; m: ChatMessage; onGo: () => void }) {
  const f = fileOf(m)
  if (!f) return null
  const image = f.mimetype?.startsWith('image/')
  const preview = f['preview-available'] === 'yes'
  return (
    <button
      className="shared-tile"
      title={`${f.name} · ${m.actorDisplayName}, ${when(m)}`}
      onClick={() =>
        image && preview
          ? setApp({
              modal: { type: 'image', src: media.preview(accountId, f.id, 2048), name: f.name, link: f.link }
            })
          : f.link
            ? void window.hubbub.app.openExternal(f.link)
            : onGo()
      }
    >
      {preview ? (
        <img src={media.preview(accountId, f.id, 256)} alt={f.name} loading="lazy" draggable={false} />
      ) : (
        <span className="shared-tile-icon">
          <FileTypeIcon mime={f.mimetype} />
        </span>
      )}
      {f.mimetype?.startsWith('video/') && (
        <span className="shared-tile-video">
          <Video size={14} />
        </span>
      )}
    </button>
  )
}

const ICONS: Partial<Record<SharedItemType, ReactNode>> = {
  voice: <Mic size={20} />,
  poll: <BarChart3 size={20} />,
  location: <MapPin size={20} />,
  deckcard: <KanbanSquare size={20} />
}

function ItemRow({ type, m, onGo }: { type: SharedItemType; m: ChatMessage; onGo: () => void }) {
  const f = fileOf(m)
  const o = objectOf(m)
  const name = f?.name ?? o?.name ?? m.message
  const meta = [f ? formatBytes(f.size) : '', m.actorDisplayName, when(m)].filter(Boolean).join(' · ')
  // Files open in Nextcloud; the rest is best seen where it was shared
  const open = f?.link ? () => void window.hubbub.app.openExternal(f.link!) : onGo
  return (
    <div className="shared-row">
      <button
        className="shared-row-main"
        title={f?.link ? `Open ${name} in Nextcloud` : 'Show in the conversation'}
        onClick={open}
      >
        <span className="file-icon">{ICONS[type] ?? <FileTypeIcon mime={f?.mimetype} />}</span>
        <span className="shared-row-text">
          <span className="shared-row-name">{name}</span>
          <span className="shared-row-meta">{meta}</span>
        </span>
      </button>
      <button className="icon-btn small" title="Show in the conversation" onClick={onGo}>
        <CornerDownRight size={16} />
      </button>
    </div>
  )
}
