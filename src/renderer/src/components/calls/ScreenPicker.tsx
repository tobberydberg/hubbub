import { useEffect, useState } from 'react'
import { AppWindow, Monitor, X } from 'lucide-react'
import type { ScreenSource } from '@shared/ipc'
import { closeScreenPicker, shareScreen } from '@renderer/calls/call'

// Choose what to share: an entire screen or one window. Thumbnails refresh while the picker is open.

const REFRESH = 4000
const isMac = window.hubbub.platform === 'darwin'

export function ScreenPicker() {
  const [sources, setSources] = useState<ScreenSource[] | null>(null)
  const [tab, setTab] = useState<'screen' | 'window'>('screen')
  const [selected, setSelected] = useState<string | null>(null)
  const [access, setAccess] = useState<'granted' | 'denied' | 'unknown'>('granted')

  useEffect(() => {
    let stopped = false
    const load = async (): Promise<void> => {
      const [list, status] = await Promise.all([
        window.hubbub.calls.screenSources(),
        window.hubbub.calls.screenAccess()
      ])
      if (stopped) return
      setSources(list)
      setAccess(status)
    }
    void load()
    const timer = setInterval(() => void load(), REFRESH)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  const shown = (sources ?? []).filter((s) => s.kind === tab)
  const count = (kind: ScreenSource['kind']): number => (sources ?? []).filter((s) => s.kind === kind).length
  const share = (id: string): void => void shareScreen(id)

  return (
    <div
      className="sp-backdrop"
      onClick={closeScreenPicker}
      onKeyDown={(e) => e.key === 'Escape' && closeScreenPicker()}
    >
      <div
        className="sp-dialog"
        role="dialog"
        aria-label="Share your screen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sp-header">
          <h2>Share your screen</h2>
          <button className="sp-close" title="Cancel" onClick={closeScreenPicker} autoFocus>
            <X size={18} />
          </button>
        </div>

        <div className="sp-tabs">
          <button className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')}>
            <Monitor size={16} /> Entire screen ({count('screen')})
          </button>
          <button className={tab === 'window' ? 'active' : ''} onClick={() => setTab('window')}>
            <AppWindow size={16} /> Window ({count('window')})
          </button>
        </div>

        {isMac && (access === 'denied' || (access === 'unknown' && sources?.length === 0)) && (
          <div className="sp-permission">
            <span>
              macOS only lets Hubbub see your screen with the Screen Recording permission. Allow Hubbub under{' '}
              <strong>Privacy &amp; Security → Screen Recording</strong>, then restart Hubbub.
            </span>
            <button
              className="btn btn-tertiary small"
              onClick={() => void window.hubbub.calls.openScreenSettings()}
            >
              Open System Settings
            </button>
          </div>
        )}

        <div className="sp-grid">
          {sources === null && <div className="sp-empty">Looking for screens and windows…</div>}
          {sources !== null && shown.length === 0 && (
            <div className="sp-empty">{tab === 'screen' ? 'No screens found' : 'No windows found'}</div>
          )}
          {shown.map((s) => (
            <button
              key={s.id}
              className={`sp-source${selected === s.id ? ' selected' : ''}`}
              onClick={() => setSelected(s.id)}
              onDoubleClick={() => share(s.id)}
              title={s.name}
            >
              <span className="sp-thumb">
                {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <Monitor size={32} />}
              </span>
              <span className="sp-name">
                {s.icon && <img src={s.icon} alt="" />}
                {s.name}
              </span>
            </button>
          ))}
        </div>

        <div className="sp-footer">
          <span className="sp-tip">
            {tab === 'window'
              ? 'To share a browser tab, share the browser window and keep that tab in front.'
              : 'Everything on the screen is shared, including notifications.'}
          </span>
          <button className="btn btn-tertiary" onClick={closeScreenPicker}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!selected}
            onClick={() => selected && share(selected)}
          >
            Share
          </button>
        </div>
      </div>
    </div>
  )
}
