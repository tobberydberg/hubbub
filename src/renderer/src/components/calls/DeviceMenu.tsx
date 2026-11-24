import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronUp, Sparkles, Volume2 } from 'lucide-react'
import { setBackgroundBlur, switchCamera, switchMicrophone, switchSpeaker } from '@renderer/calls/call'
import { deviceLabel, playTestSound, useMediaDevices } from '@renderer/calls/devices'
import { usePrefs } from '@renderer/store/prefs'

// The arrow next to the microphone and camera buttons of a call: switch microphone, speaker or
// camera during the call. It opens inside the call's own markup, so it works in the popped-out
// window as well.

const MENU_WIDTH = 280

interface Props {
  kind: 'audio' | 'video'
  /** Button style: the call view's (cv) or the sidebar widget's (cw) */
  variant: 'cv' | 'cw'
  disabled?: boolean
}

export function DeviceMenu({ kind, variant, disabled }: Props) {
  const [open, setOpen] = useState(false)
  /** Where the menu goes: above the button group, inside the window (fixed, so the sidebar can't clip it) */
  const [place, setPlace] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 })
  const ref = useRef<HTMLSpanElement>(null)
  const devices = useMediaDevices(open)
  const prefs = usePrefs()

  useEffect(() => {
    const doc = ref.current?.ownerDocument
    if (!open || !doc) return
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    doc.addEventListener('pointerdown', onDown)
    doc.addEventListener('keydown', onKey)
    return () => {
      doc.removeEventListener('pointerdown', onDown)
      doc.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (fn: () => unknown) => (): void => {
    setOpen(false)
    void fn()
  }

  const section = (
    title: string,
    list: MediaDeviceInfo[],
    current: string | null,
    onPick: (id: string | null) => unknown
  ): ReactNode => (
    <>
      <div className="dm-title">{title}</div>
      {[
        { id: null, label: 'System default' },
        ...list.map((d, i) => ({ id: d.deviceId, label: deviceLabel(d, i) }))
      ].map((d) => (
        <button key={d.id ?? 'default'} className="dm-item" onClick={pick(() => onPick(d.id))}>
          <span className="dm-check">{current === d.id && <Check size={14} />}</span>
          <span className="dm-label">{d.label}</span>
        </button>
      ))}
    </>
  )

  return (
    <span className="dm-anchor" ref={ref}>
      <button
        className={`${variant}-btn dm-toggle${open ? ' open' : ''}`}
        disabled={disabled}
        title={kind === 'audio' ? 'Microphone and speaker' : 'Camera'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const group = ref.current?.parentElement?.getBoundingClientRect()
          const win = ref.current?.ownerDocument.defaultView
          if (group && win) {
            setPlace({
              left: Math.max(8, Math.min(group.left, win.innerWidth - MENU_WIDTH - 8)),
              bottom: win.innerHeight - group.top + 8
            })
          }
          setOpen(!open)
        }}
      >
        <ChevronUp size={14} />
      </button>
      {open && (
        <div className="device-menu" role="menu" style={{ ...place, width: MENU_WIDTH }}>
          {kind === 'audio' ? (
            <>
              {section('Microphone', devices.microphones, prefs.microphoneId, switchMicrophone)}
              <div className="dm-sep" />
              {section('Speaker', devices.speakers, prefs.speakerId, switchSpeaker)}
              <div className="dm-sep" />
              <button className="dm-item" onClick={() => void playTestSound(prefs.speakerId)}>
                <span className="dm-check">
                  <Volume2 size={14} />
                </span>
                <span className="dm-label">Play a test sound</span>
              </button>
            </>
          ) : (
            <>
              {section('Camera', devices.cameras, prefs.cameraId, switchCamera)}
              <div className="dm-sep" />
              <button className="dm-item" onClick={pick(() => setBackgroundBlur(!prefs.backgroundBlur))}>
                <span className="dm-check">
                  {prefs.backgroundBlur ? <Check size={14} /> : <Sparkles size={14} />}
                </span>
                <span className="dm-label">Blur my background</span>
              </button>
            </>
          )}
        </div>
      )}
    </span>
  )
}
