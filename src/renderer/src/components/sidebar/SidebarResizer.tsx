import { useState } from 'react'
import { usePrefs } from '@renderer/store/prefs'

// The left sidebar's width, dragged at its right edge like the side panel's: kept in the
// preferences, double-click for the default. It sets --sidebar-width, which the chat sidebar, the
// calendar's and the side panel's room calculation all use.

export const SIDEBAR_DEFAULT = 240
/** The call widget's buttons need this much */
const MIN = 232
const MAX = 480

const clamp = (w: number): number => Math.round(Math.max(MIN, Math.min(MAX, w, window.innerWidth - 65 - 480)))

export function useSidebarWidth(): number {
  return usePrefs((s) => s.sidebarWidth) ?? SIDEBAR_DEFAULT
}

export function SidebarResizer({ onDrag }: { onDrag: (width: number | null) => void }) {
  const width = useSidebarWidth()
  const [dragging, setDragging] = useState(false)
  return (
    <div className="sidebar-resizer">
      <div
        className={`sidebar-resize${dragging ? ' dragging' : ''}`}
        title="Drag to resize · double-click for the default size"
        onDoubleClick={() => usePrefs.getState().set({ sidebarWidth: null })}
        onPointerDown={(e) => {
          e.preventDefault()
          const handle = e.currentTarget
          handle.setPointerCapture(e.pointerId)
          const startX = e.clientX
          let next = width
          setDragging(true)
          const move = (ev: PointerEvent): void => {
            next = clamp(width + ev.clientX - startX)
            onDrag(next)
          }
          const up = (): void => {
            handle.removeEventListener('pointermove', move)
            handle.removeEventListener('pointerup', up)
            setDragging(false)
            onDrag(null)
            usePrefs.getState().set({ sidebarWidth: next })
          }
          handle.addEventListener('pointermove', move)
          handle.addEventListener('pointerup', up)
        }}
      />
    </div>
  )
}
