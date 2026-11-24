import { Fragment, type MouseEvent } from 'react'

// Plain text with its web addresses as links, opened in the browser like links in messages.

/** http(s) addresses; trailing punctuation belongs to the sentence, not the address */
const LINKS = /\bhttps?:\/\/[^\s<>"]+[^\s<>"'.,;:!?)\]]/gi

const open =
  (href: string) =>
  (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    void window.hubbub.app.openExternal(href)
  }

export function Linkified({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(LINKS)) {
    const at = m.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    parts.push(
      <a key={at} href={m[0]} title={m[0]} onClick={open(m[0])}>
        {m[0]}
      </a>
    )
    last = at + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <Fragment>{parts}</Fragment>
}
