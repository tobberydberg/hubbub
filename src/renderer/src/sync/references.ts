import { useEffect, useState } from 'react'
import { talk, type LinkReference } from '@renderer/api/talk'

// Link previews from Nextcloud, once per link: the server fetches the page, so the page's site
// never sees the user, and every client of the conversation shows the same preview.

const MAX = 300
const cache = new Map<string, Promise<LinkReference | null>>()

function resolve(accountId: string, link: string): Promise<LinkReference | null> {
  const key = `${accountId}|${link}`
  let p = cache.get(key)
  if (!p) {
    p = talk(accountId)
      .resolveReference(link)
      .then((r) => r.references[link] ?? Object.values(r.references)[0] ?? null)
      .catch(() => {
        // A failed lookup may work later
        cache.delete(key)
        return null
      })
    cache.set(key, p)
    if (cache.size > MAX) cache.delete(cache.keys().next().value!)
  }
  return p
}

/** The preview of a link, or null (none, or not loaded yet) */
export function useLinkReference(accountId: string, link: string | null): LinkReference | null {
  const [ref, setRef] = useState<LinkReference | null>(null)
  useEffect(() => {
    setRef(null)
    if (!link) return
    let alive = true
    void resolve(accountId, link).then((r) => alive && setRef(r))
    return () => {
      alive = false
    }
  }, [accountId, link])
  return ref
}
