import { decode, element, text } from './calendars'

// A folder of the user's Nextcloud files from a WebDAV PROPFIND, for picking files to share.

export interface DavFile {
  /** Path in the user's files, e.g. "/Documents/Plan.pdf" */
  path: string
  name: string
  folder: boolean
  fileId?: string
  mime?: string
  size?: number
  /** ms */
  modified?: number
  hasPreview: boolean
  /** Whether it may be shared on (the share permission, R) */
  shareable: boolean
}

/** The entries of a folder (not the folder itself), folders first, then by name */
export function parseFolder(xml: string, userId: string): DavFile[] {
  const root = `/remote.php/dav/files/${encodeURIComponent(userId)}`
  const files: DavFile[] = []
  for (const response of element('response', xml)) {
    const href = decode(text('href', response))
    const i = href.indexOf(root)
    if (i === -1) continue
    const path = decodeURIComponent(href.slice(i + root.length)).replace(/\/+$/, '') || '/'
    const folder = element('collection', text('resourcetype', response)).length > 0
    const size = Number(text('getcontentlength', response) || text('size', response))
    const modified = Date.parse(text('getlastmodified', response))
    const permissions = text('permissions', response)
    files.push({
      path,
      name: path.split('/').pop() || '/',
      folder,
      fileId: text('fileid', response) || undefined,
      mime: folder ? undefined : decode(text('getcontenttype', response)) || undefined,
      size: Number.isFinite(size) ? size : undefined,
      modified: Number.isNaN(modified) ? undefined : modified,
      hasPreview: text('has-preview', response) === 'true',
      // Without the property (older servers) assume it can be shared
      shareable: !permissions || permissions.includes('R')
    })
  }
  // The first response is the folder itself
  const self = files.shift()
  return files
    .filter((f) => f.path !== self?.path)
    .sort(
      (a, b) =>
        Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true })
    )
}

/** The folders on the way to a path: [{ name: 'Home', path: '/' }, { name: 'Documents', path: '/Documents' }] */
export function crumbs(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean)
  return [
    { name: 'Home', path: '/' },
    ...parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join('/')}` }))
  ]
}
