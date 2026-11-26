import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

export interface Anchor {
  x: number
  y: number
  /** Height of the anchor element, so the menu can flip above it */
  height?: number
  /** Align the popover's right edge with x instead of its left edge */
  alignRight?: boolean
}

export function anchorFrom(el: Element, align: 'left' | 'right' = 'left'): Anchor {
  const r = el.getBoundingClientRect()
  return {
    x: align === 'left' ? r.left : r.right,
    y: r.bottom + 4,
    height: r.height + 8,
    alignRight: align === 'right'
  }
}

interface PopoverProps {
  anchor: Anchor
  onClose: () => void
  children: ReactNode
  className?: string
}

/** The document popovers open in: the main window's, or the popped-out call window's */
export const PortalDocument = createContext<Document | null>(null)

/** Fixed-position layer that stays within the viewport and closes on outside click or Escape. */
export function Popover({ anchor, onClose, children, className = 'popover' }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const doc = useContext(PortalDocument) ?? document
  const win = doc.defaultView ?? window
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = (): void => {
      const { width, height } = el.getBoundingClientRect()
      let left = anchor.alignRight ? anchor.x - width : anchor.x
      let top = anchor.y
      if (top + height > win.innerHeight - 8) top = Math.max(8, anchor.y - (anchor.height ?? 0) - height)
      left = Math.max(8, Math.min(left, win.innerWidth - width - 8))
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }))
    }
    place()
    // Content that loads after opening (a profile card) changes the size
    const Observer =
      (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ?? ResizeObserver
    const observer = new Observer(place)
    observer.observe(el)
    return () => observer.disconnect()
  }, [anchor, win])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const t = setTimeout(() => doc.addEventListener('mousedown', onDown), 0)
    doc.addEventListener('keydown', onKey, true)
    win.addEventListener('blur', onClose)
    return () => {
      clearTimeout(t)
      doc.removeEventListener('mousedown', onDown)
      doc.removeEventListener('keydown', onKey, true)
      win.removeEventListener('blur', onClose)
    }
  }, [onClose, doc, win])

  return createPortal(
    <div
      ref={ref}
      className={className}
      style={{
        left: pos?.left ?? anchor.x,
        top: pos?.top ?? anchor.y,
        visibility: pos ? 'visible' : 'hidden'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    doc.body
  )
}

export function Menu(props: PopoverProps) {
  return <Popover {...props} className={`menu ${props.className ?? ''}`} />
}

interface ItemProps {
  icon?: ReactNode
  label: ReactNode
  onClick: () => void
  danger?: boolean
  checked?: boolean
  hint?: string
}

export function MenuItem({ icon, label, onClick, danger, checked, hint }: ItemProps) {
  return (
    <button className={`menu-item${danger ? ' danger' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {checked && <Check size={16} className="menu-check" />}
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="menu-sep" />
}

export function MenuTitle({ children }: { children: ReactNode }) {
  return <div className="menu-title">{children}</div>
}

/** Small helper hook for components that open one menu at a time. */
export function useMenuState<T = true>() {
  const [state, setState] = useState<{ anchor: Anchor; data: T } | null>(null)
  return {
    state,
    open: (anchor: Anchor, data: T) => setState({ anchor, data }),
    close: () => setState(null)
  }
}
