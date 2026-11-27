import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Folder, Upload, X } from 'lucide-react'
import { media } from '@shared/ipc'
import { assistant } from '@renderer/api/assistant'
import { isListShape, type Shape } from '@renderer/lib/ai-tasks'
import { crumbs, parseFolder, type DavFile } from '@renderer/lib/files'
import { showToast, useApp } from '@renderer/store/app'
import { useAssistant } from '@renderer/store/assistant'
import { aiErrorText } from '@renderer/sync/ai'
import { Modal } from '../common/Modal'

// A file for an AI task (an image to describe, a recording to transcribe): one from your Nextcloud
// files, or one from this computer, uploaded into the Assistant's folder first. Tasks take files by
// their id in your files.

export interface PickedFile {
  fileId: number
  name: string
}

/** Which files fit: "image/" for images, "audio/" for audio, … */
function mimeFor(shape: Shape): string | null {
  if (/Image/.test(shape.type)) return 'image/'
  if (/Audio/.test(shape.type)) return 'audio/'
  if (/Video/.test(shape.type)) return 'video/'
  return null
}

export function FileField({
  accountId,
  shape,
  value,
  onChange
}: {
  accountId: string
  shape: Shape
  value: PickedFile | PickedFile[] | undefined
  onChange: (value: PickedFile | PickedFile[] | undefined) => void
}) {
  const many = isListShape(shape)
  const files = value === undefined ? [] : Array.isArray(value) ? value : [value]
  const canUpload = useAssistant((s) => typeof s.accounts[accountId]?.assistant === 'string')
  const userId = useApp((s) => s.accounts[accountId]?.info.userId ?? '')
  const [picking, setPicking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const mime = mimeFor(shape)

  const add = (picked: PickedFile[]): void => {
    if (!picked.length) return
    if (many) onChange([...files, ...picked.filter((p) => !files.some((f) => f.fileId === p.fileId))])
    else onChange(picked[0])
  }

  const upload = async (list: FileList | null): Promise<void> => {
    if (!list?.length) return
    setUploading(true)
    try {
      const folder =
        ((await assistant(accountId).folderPath()) ?? '/Assistant').replace(/^\/[^/]+\/files/, '') || '/'
      const picked: PickedFile[] = []
      for (const file of Array.from(list).slice(0, many ? 10 : 1)) {
        const up = await window.hubbub.upload({
          accountId,
          remotePath: `${folder.replace(/\/+$/, '')}/${file.name}`,
          data: await file.arrayBuffer(),
          contentType: file.type
        })
        if (!up.ok) throw new Error(up.error || `Upload failed (HTTP ${up.status})`)
        const listing = parseFolder(await window.hubbub.folder(accountId, folder), userId)
        const found = listing.find((f) => f.path === up.path)
        if (!found?.fileId) throw new Error('The uploaded file couldn’t be found')
        picked.push({ fileId: Number(found.fileId), name: found.name })
      }
      add(picked)
    } catch (err) {
      showToast(`Couldn’t upload: ${aiErrorText(err)}`, 'error')
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="ai-files">
      {files.map((f) => (
        <span key={f.fileId} className="ai-file-chip">
          {mime === 'image/' && <img src={media.preview(accountId, String(f.fileId), 64)} alt="" />}
          <span>{f.name}</span>
          <button
            className="icon-btn small"
            title="Remove"
            onClick={() => onChange(many ? files.filter((x) => x.fileId !== f.fileId) : undefined)}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {(many || !files.length) && (
        <span className="ai-file-buttons">
          <button className="btn btn-tertiary small" onClick={() => setPicking(true)}>
            <Folder size={14} /> From Nextcloud Files…
          </button>
          {canUpload && (
            <button
              className="btn btn-tertiary small"
              disabled={uploading}
              onClick={() => input.current?.click()}
            >
              <Upload size={14} /> {uploading ? 'Uploading…' : 'From this computer…'}
            </button>
          )}
          <input
            ref={input}
            type="file"
            hidden
            multiple={many}
            accept={mime ? `${mime}*` : undefined}
            onChange={(e) => void upload(e.target.files)}
          />
        </span>
      )}
      {picking && (
        <PickFromNextcloud
          accountId={accountId}
          mime={mime}
          many={many}
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            setPicking(false)
            add(picked)
          }}
        />
      )}
    </div>
  )
}

function PickFromNextcloud({
  accountId,
  mime,
  many,
  onClose,
  onPick
}: {
  accountId: string
  mime: string | null
  many: boolean
  onClose: () => void
  onPick: (files: PickedFile[]) => void
}) {
  const userId = useApp((s) => s.accounts[accountId]?.info.userId ?? '')
  const [path, setPath] = useState('/')
  const [files, setFiles] = useState<DavFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<DavFile[]>([])

  useEffect(() => {
    let current = true
    setFiles(null)
    setError(null)
    window.hubbub
      .folder(accountId, path)
      .then((xml) => current && setFiles(parseFolder(xml, userId)))
      .catch((err: unknown) => current && setError(aiErrorText(err)))
    return () => {
      current = false
    }
  }, [accountId, userId, path])

  const fits = (f: DavFile): boolean => f.folder || !mime || !!f.mime?.startsWith(mime)
  const shown = (files ?? [])
    .filter(fits)
    .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name))
  const done = (list: DavFile[]): void =>
    onPick(list.filter((f) => f.fileId).map((f) => ({ fileId: Number(f.fileId), name: f.name })))

  return (
    <Modal
      title="Choose from Nextcloud Files"
      onClose={onClose}
      footer={
        many ? (
          <>
            <button className="btn btn-tertiary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!chosen.length} onClick={() => done(chosen)}>
              Choose {chosen.length || ''}
            </button>
          </>
        ) : undefined
      }
    >
      <nav className="fp-crumbs ai-pick-crumbs" aria-label="Folder">
        {crumbs(path).map((c, i, all) => (
          <span key={c.path} className="fp-crumb">
            {i > 0 && <ChevronRight size={14} />}
            <button disabled={i === all.length - 1} onClick={() => setPath(c.path)}>
              {c.name}
            </button>
          </span>
        ))}
      </nav>
      <div className="ai-pick-list">
        {error ? (
          <p className="ai-error">{error}</p>
        ) : !files ? (
          <div className="spinner" />
        ) : !shown.length ? (
          <p className="help">Nothing that fits here.</p>
        ) : (
          shown.map((f) => {
            const on = chosen.some((c) => c.path === f.path)
            return (
              <button
                key={f.path}
                className={`ai-pick-item${on ? ' on' : ''}`}
                onClick={() => {
                  if (f.folder) setPath(f.path)
                  else if (!many) done([f])
                  else setChosen(on ? chosen.filter((c) => c.path !== f.path) : [...chosen, f])
                }}
              >
                {f.folder ? (
                  <Folder size={18} />
                ) : f.hasPreview && f.fileId ? (
                  <img src={media.preview(accountId, f.fileId, 64)} alt="" />
                ) : (
                  <span className="ai-pick-blank" />
                )}
                <span>{f.name}</span>
              </button>
            )
          })
        )}
      </div>
    </Modal>
  )
}
