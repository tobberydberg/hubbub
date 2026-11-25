import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation
} from 'lucide-react'
import { media } from '@shared/ipc'
import type { RichObjectParameter } from '@shared/talk-types'
import { formatBytes } from '@renderer/lib/messages'
import { setApp } from '@renderer/store/app'

export function FileTypeIcon({ mime }: { mime?: string }) {
  const m = mime ?? ''
  if (m.startsWith('image/')) return <FileImage size={20} />
  if (m.startsWith('video/')) return <FileVideo size={20} />
  if (m.startsWith('audio/')) return <FileAudio size={20} />
  if (m.includes('pdf') || m.startsWith('text/') || m.includes('document') || m.includes('word')) {
    return <FileText size={20} />
  }
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return <FileSpreadsheet size={20} />
  if (m.includes('presentation') || m.includes('powerpoint')) return <Presentation size={20} />
  if (m.includes('zip') || m.includes('tar') || m.includes('compressed')) return <FileArchive size={20} />
  return <File size={20} />
}

export function Attachments({ accountId, files }: { accountId: string; files: RichObjectParameter[] }) {
  if (!files.length) return null
  return (
    <div className="attachments">
      {files.map((f) => {
        const isImage = f['preview-available'] === 'yes' && (f.mimetype?.startsWith('image/') ?? false)
        if (isImage) {
          return (
            <img
              key={f.id}
              className="attachment-image"
              src={media.preview(accountId, f.id, 800)}
              alt={f.name}
              title={f.name}
              loading="lazy"
              onClick={() =>
                setApp({
                  modal: {
                    type: 'image',
                    src: media.preview(accountId, f.id, 2048),
                    name: f.name,
                    link: f.link
                  }
                })
              }
            />
          )
        }
        const ext = f.name.includes('.') ? f.name.split('.').pop()?.toUpperCase() : ''
        return (
          <button
            key={f.id}
            className="attachment-file"
            onClick={() => f.link && void window.hubbub.app.openExternal(f.link)}
            title={`Open ${f.name} in Nextcloud`}
          >
            <span className="file-icon">
              <FileTypeIcon mime={f.mimetype} />
            </span>
            <span style={{ minWidth: 0 }}>
              <div className="file-name">{f.name}</div>
              <div className="file-meta">{[ext, formatBytes(f.size)].filter(Boolean).join(' · ')}</div>
            </span>
          </button>
        )
      })}
    </div>
  )
}
