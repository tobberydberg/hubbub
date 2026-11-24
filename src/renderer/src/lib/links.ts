// Links in messages, for previews: the first web address outside code, and the id of the image
// Nextcloud keeps for a link it previewed.

const LINK = /\bhttps?:\/\/[^\s<>"`]+[^\s<>"'`.,;:!?)\]]/i

/** The first http(s) address in a message, leaving code blocks and inline code out */
export function firstLink(text: string): string | null {
  const prose = text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ')
  // Markdown links: [label](address)
  const markdown = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(prose)
  const plain = LINK.exec(prose)
  if (markdown && (!plain || markdown.index <= plain.index)) return markdown[1]
  return plain ? plain[0] : null
}

/** The id in a preview image address of this server, e.g. https://cloud/core/references/preview/9f51… */
export function referenceImageId(thumb: string | null | undefined, serverUrl: string): string | null {
  if (!thumb) return null
  try {
    const url = new URL(thumb)
    const server = new URL(serverUrl)
    if (url.origin !== server.origin) return null
    return /\/core\/references\/preview\/([a-f0-9]{16,64})$/i.exec(url.pathname)?.[1] ?? null
  } catch {
    return null
  }
}

/** "nextcloud.com" for https://www.nextcloud.com/about */
export function siteOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return link
  }
}
