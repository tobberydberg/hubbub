import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Folder, Search } from 'lucide-react'
import { media } from '@shared/ipc'
import { talk } from '@renderer/api/talk'
import { crumbs, parseFolder, type DavFile } from '@renderer/lib/files'
import { formatBytes, newReferenceId } from '@renderer/lib/messages'
import { setApp, showToast, useApp } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import { FileTypeIcon } from '../channel/Attachments'
import { Modal } from '../common/Modal'

// Sharing files that are already in Nextcloud into a conversation, as Talk on the web does with
// "Share from Files": nothing is downloaded or uploaded again, the conversation gets a share of
// the file.

const close = (): void => setApp({ modal: null })

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function FilesPickerModal({
  accountId,
  token,
  threadId
}: {
  accountId: string
  token: string
  threadId?: number
}) {
  const userId = useApp((s) => s.accounts[accountId]?.info.userId ?? '')
  const roomName = useApp((s) => s.accounts[accountId]?.rooms[token]?.displayName)
  const lastFolder = usePrefs((s) => s.filesPickerFolder?.[accountId])
  const [path, setPath] = useState(lastFolder ?? '/')
  const [files, setFiles] = useState<DavFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Map<string, DavFile>>(new Map())
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    let current = true
    setFiles(null)
    setError(null)
    setFilter('')
    window.hubbub
      .folder(accountId, path)
      .then((xml) => current && setFiles(parseFolder(xml, userId)))
      .catch((err: unknown) => {
        if (!current) return
        // A remembered folder that's gone: start at home
        if (path !== '/') setPath('/')
        else setError(errorText(err))
      })
    return () => {
      current = false
    }
  }, [accountId, userId, path])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (files ?? []).filter((f) => !q || f.name.toLowerCase().includes(q))
  }, [files, filter])

  const open = (folder: string): void => {
    setPath(folder)
    const prefs = usePrefs.getState()
    prefs.set({ filesPickerFolder: { ...prefs.filesPickerFolder, [accountId]: folder } })
  }

  const toggle = (f: DavFile): void => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(f.path)) next.delete(f.path)
      else next.set(f.path, f)
      return next
    })
  }

  const share = async (): Promise<void> => {
    if (!selected.size || sharing) return
    setSharing(true)
    const api = talk(accountId)
    let failed = 0
    for (const f of selected.values()) {
      try {
        await api.shareFile(token, f.path, newReferenceId(), threadId ? { threadId } : {})
      } catch (err) {
        failed++
        showToast(`${f.name} couldn’t be shared: ${errorText(err)}`, 'error')
      }
    }
    setSharing(false)
    if (!failed) {
      showToast(
        selected.size === 1 ? `Shared ${[...selected.values()][0].name}` : `Shared ${selected.size} files`
      )
      close()
    }
  }

  return (
    <Modal
      title="Share from Nextcloud Files"
      size="large"
      onClose={close}
      footer={
        <>
          <span className="fp-count">
            {selected.size ? `${selected.size} selected` : 'Choose one or more files'}
          </span>
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!selected.size || sharing}
            onClick={() => void share()}
          >
            {sharing ? 'Sharing…' : roomName ? `Share in ${roomName}` : 'Share'}
          </button>
        </>
      }
    >
      <div className="fp-toolbar">
        <nav className="fp-crumbs" aria-label="Folder">
          {crumbs(path).map((c, i, all) => (
            <span key={c.path} className="fp-crumb">
              {i > 0 && <ChevronRight size={14} />}
              <button disabled={i === all.length - 1} onClick={() => open(c.path)}>
                {c.name}
              </button>
            </span>
          ))}
        </nav>
        <label className="fp-filter">
          <Search size={14} />
          <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
      </div>

      <div className="fp-list" role="listbox" aria-multiselectable="true">
        {error ? (
          <div className="empty-state">{error}</div>
        ) : !files ? (
          <div className="empty-state">
            <div className="spinner" />
          </div>
        ) : shown.length === 0 ? (
          <div className="empty-state">{filter ? 'Nothing matches.' : 'This folder is empty.'}</div>
        ) : (
          shown.map((f) =>
            f.folder ? (
              <button key={f.path} className="fp-row" onClick={() => open(f.path)}>
                <span className="fp-thumb folder">
                  <Folder size={20} />
                </span>
                <span className="fp-name">{f.name}</span>
                <span className="fp-meta">{modified(f)}</span>
                <ChevronRight size={16} className="fp-go" />
              </button>
            ) : (
              <button
                key={f.path}
                role="option"
                aria-selected={selected.has(f.path)}
                className={`fp-row${selected.has(f.path) ? ' selected' : ''}`}
                disabled={!f.shareable}
                title={f.shareable ? f.name : 'You may not share this file'}
                onClick={() => toggle(f)}
                onDoubleClick={() => {
                  if (!selected.has(f.path)) toggle(f)
                }}
              >
                <input type="checkbox" tabIndex={-1} readOnly checked={selected.has(f.path)} />
                <span className="fp-thumb">
                  {f.hasPreview && f.fileId ? (
                    <img
                      src={media.preview(accountId, f.fileId, 64)}
                      alt=""
                      loading="lazy"
                      draggable={false}
                    />
                  ) : (
                    <FileTypeIcon mime={f.mime} />
                  )}
                </span>
                <span className="fp-name">{f.name}</span>
                <span className="fp-meta">
                  {[formatBytes(f.size), modified(f)].filter(Boolean).join(' · ')}
                </span>
              </button>
            )
          )
        )}
      </div>
    </Modal>
  )
}

const modified = (f: DavFile): string =>
  f.modified
    ? new Date(f.modified).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : ''
