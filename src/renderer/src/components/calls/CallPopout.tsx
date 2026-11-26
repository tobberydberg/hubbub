import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { setCallPoppedOut } from '@renderer/calls/call'
import { useApp } from '@renderer/store/app'
import { useCall } from '@renderer/store/call'
import { CallView } from './CallView'
import { PortalDocument } from '../common/Menu'
import { setCallWindow } from '@renderer/calls/popout-window'

// The popped-out call: a child window of this one that React renders into through a portal. Being
// the same page, it shows the call's media streams directly, and nothing is reconnected when the
// call moves between the windows.

const FRAME_NAME = 'hubbub-call'

let popout: Window | null = null

export function focusCallPopout(): void {
  popout?.focus()
}

/** Copies the page's styles and theme into the new window. */
function adoptStyles(target: Document): void {
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    if (node instanceof HTMLLinkElement) {
      const link = target.createElement('link')
      link.rel = 'stylesheet'
      link.href = node.href
      target.head.appendChild(link)
    } else {
      target.head.appendChild(target.importNode(node, true))
    }
  }
  const root = document.documentElement
  target.documentElement.setAttribute('style', root.getAttribute('style') ?? '')
  target.documentElement.dataset.dark = root.dataset.dark
}

export function CallPopout() {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const title = useCall((s) => {
    const a = s.active
    return a ? useApp.getState().accounts[a.accountId]?.rooms[a.token]?.displayName : undefined
  })

  useEffect(() => {
    const win = window.open('about:blank', FRAME_NAME)
    if (!win) {
      setCallPoppedOut(false)
      return
    }
    popout = win
    setCallWindow(win)
    adoptStyles(win.document)
    win.document.body.className = 'popout-body'
    const el = win.document.createElement('div')
    el.className = 'popout-root'
    win.document.body.appendChild(el)
    // Closing the window puts the call back into the main window; it doesn't hang up
    const onClose = (): void => setCallPoppedOut(false)
    win.addEventListener('pagehide', onClose)
    setContainer(el)
    return () => {
      win.removeEventListener('pagehide', onClose)
      if (popout === win) popout = null
      setCallWindow(null)
      win.close()
    }
  }, [])

  useEffect(() => {
    if (popout) popout.document.title = title ? `${title} – Hubbub call` : 'Hubbub call'
  }, [title, container])

  return container
    ? createPortal(
        // Menus and pickers of the call window open in it, not in the main window
        <PortalDocument.Provider value={container.ownerDocument}>
          <CallView popout />
        </PortalDocument.Provider>,
        container
      )
    : null
}
