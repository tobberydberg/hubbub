import { memo, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { MENTION_SCHEME } from '@renderer/lib/messages'

const openExternal =
  (href: string) =>
  (e: React.MouseEvent): void => {
    e.preventDefault()
    void window.hubbub.app.openExternal(href)
  }

const components: Components = {
  a({ href, children }) {
    if (href?.startsWith(MENTION_SCHEME)) {
      const self = href.endsWith('/self')
      return <span className={`mention${self ? ' self' : ''}`}>{children}</span>
    }
    if (!href) return <>{children}</>
    return (
      <a href={href} onClick={openExternal(href)} title={href}>
        {children}
      </a>
    )
  },
  // Do not load remote images embedded in markdown (privacy); show them as links instead
  img({ src, alt }) {
    const href = typeof src === 'string' ? src : ''
    return (
      <a href={href} onClick={openExternal(href)}>
        {alt || href}
      </a>
    )
  }
}

const remarkPlugins = [remarkGfm, remarkBreaks]

const urlTransform = (url: string): string =>
  url.startsWith(MENTION_SCHEME) ? url : defaultUrlTransform(url)

export const MessageText = memo(function MessageText({
  markdown,
  plain,
  className
}: {
  markdown: string
  plain?: boolean
  className?: string
}): ReactNode {
  if (!markdown) return null
  if (plain) {
    return (
      <div className={`post-text ${className ?? ''}`} style={{ whiteSpace: 'pre-wrap' }}>
        <Markdown
          components={components}
          urlTransform={urlTransform}
          allowedElements={['p', 'a']}
          unwrapDisallowed
        >
          {markdown}
        </Markdown>
      </div>
    )
  }
  return (
    <div className={`post-text ${className ?? ''}`}>
      <Markdown remarkPlugins={remarkPlugins} components={components} urlTransform={urlTransform}>
        {markdown}
      </Markdown>
    </div>
  )
})
