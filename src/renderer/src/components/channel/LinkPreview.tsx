import { media } from '@shared/ipc'
import { referenceImageId, siteOf } from '@renderer/lib/links'
import { useApp } from '@renderer/store/app'
import { useLinkReference } from '@renderer/sync/references'

// Under a message: the first link's page, with its site, title, description and image, as Nextcloud
// previews it (like Mattermost's link previews).

export function LinkPreview({ accountId, link }: { accountId: string; link: string }) {
  const ref = useLinkReference(accountId, link)
  const serverUrl = useApp((s) => s.accounts[accountId]?.info.serverUrl ?? '')
  const og = ref?.openGraphObject
  if (!og?.name || ref?.accessible === false) return null
  const href = og.link || link
  const imageId = referenceImageId(og.thumb, serverUrl)
  const open = (e: React.MouseEvent): void => {
    e.preventDefault()
    void window.hubbub.app.openExternal(href)
  }
  return (
    <div className="link-preview">
      <div className="link-preview-text">
        <span className="link-preview-site">{siteOf(href)}</span>
        <a className="link-preview-title" href={href} title={href} onClick={open}>
          {og.name}
        </a>
        {og.description && <p className="link-preview-description">{og.description}</p>}
      </div>
      {imageId && (
        <a className="link-preview-image" href={href} onClick={open} tabIndex={-1} aria-hidden>
          <img src={media.referencePreview(accountId, imageId)} alt="" loading="lazy" />
        </a>
      )}
    </div>
  )
}
