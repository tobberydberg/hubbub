import { useEffect, useState } from 'react'
import { Bell, Info, LayoutList, Monitor, Palette, SlidersHorizontal } from 'lucide-react'
import type { DesktopSettings, TrustedCertificate } from '@shared/ipc'
import { THEMES } from '@renderer/lib/themes'
import { useApp } from '@renderer/store/app'
import { usePrefs, type ThemeName } from '@renderer/store/prefs'
import { Modal, Toggle } from '../common/Modal'

type Tab = 'display' | 'notifications' | 'sidebar' | 'desktop' | 'advanced' | 'about'

const isMac = window.hubbub.platform === 'darwin'

const REPO_URL = 'https://github.com/tobberydberg/hubbub'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('display')
  const prefs = usePrefs()
  const update = useApp((s) => s.update)
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.hubbub.app.version().then(setVersion)
  }, [])

  const nav: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'display', label: 'Display', icon: <Palette size={16} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
    { id: 'sidebar', label: 'Sidebar', icon: <LayoutList size={16} /> },
    { id: 'desktop', label: 'Desktop', icon: <Monitor size={16} /> },
    { id: 'advanced', label: 'Advanced', icon: <SlidersHorizontal size={16} /> },
    { id: 'about', label: 'About', icon: <Info size={16} /> }
  ]

  const themeOptions: { id: ThemeName; label: string }[] = [
    ...Object.entries(THEMES).map(([id, t]) => ({ id: id as ThemeName, label: t.label })),
    { id: 'system', label: 'Match system' }
  ]

  return (
    <Modal title="Settings" onClose={onClose} size="large">
      <div className="settings-layout">
        <nav className="settings-nav">
          {nav.map((n) => (
            <button key={n.id} className={tab === n.id ? 'active' : ''} onClick={() => setTab(n.id)}>
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
        <div className="settings-panel">
          {tab === 'display' && (
            <>
              <div className="sr-title">Theme</div>
              <div className="theme-grid">
                {themeOptions.map((o) => {
                  const t = o.id === 'system' ? THEMES.denim : THEMES[o.id as keyof typeof THEMES]
                  const t2 = o.id === 'system' ? THEMES.onyx : t
                  return (
                    <button
                      key={o.id}
                      className={`theme-card${prefs.theme === o.id ? ' selected' : ''}`}
                      onClick={() => prefs.set({ theme: o.id })}
                    >
                      <div className="theme-preview">
                        <div className="tp-rail" style={{ background: t.sidebarTeamBarBg }} />
                        <div className="tp-side" style={{ background: t.sidebarBg }}>
                          <i style={{ background: t.sidebarText }} />
                          <i style={{ background: t.sidebarTextActiveBorder, opacity: 1 }} />
                          <i style={{ background: t.sidebarText }} />
                        </div>
                        <div className="tp-center" style={{ background: t2.centerChannelBg }}>
                          <i style={{ background: t2.centerChannelColor }} />
                          <i style={{ background: t2.centerChannelColor, width: '60%' }} />
                          <i
                            style={{ background: t2.buttonBg, opacity: 1, width: '30%', marginTop: 'auto' }}
                          />
                        </div>
                      </div>
                      <div className="tc-name">{o.label}</div>
                    </button>
                  )
                })}
              </div>
              <Row
                title="Collapsed reply threads"
                sub="Show replies only in the thread panel, with a reply count under the original message"
              >
                <Toggle on={prefs.collapsedThreads} onChange={(v) => prefs.set({ collapsedThreads: v })} />
              </Row>
            </>
          )}

          {tab === 'notifications' && (
            <>
              <Row title="Desktop notifications" sub="Show a notification for direct messages and mentions">
                <Toggle
                  on={prefs.notificationsEnabled}
                  onChange={(v) => prefs.set({ notificationsEnabled: v })}
                />
              </Row>
              <Row title="Notification sound" sub="Play the system sound with notifications">
                <Toggle on={prefs.notifySound} onChange={(v) => prefs.set({ notifySound: v })} />
              </Row>
              <Row title="Test" sub="Send a test notification to check your system settings">
                <button
                  className="btn btn-tertiary small"
                  onClick={() => new Notification('Hubbub', { body: 'Notifications are working 🎉' })}
                >
                  Send test
                </button>
              </Row>
              <p className="help" style={{ fontSize: 12, marginTop: 12 }}>
                Per-conversation levels (all messages, mentions only, muted) are set from the conversation's
                Info panel and are synced with Nextcloud.
              </p>
            </>
          )}

          {tab === 'sidebar' && (
            <>
              <Row
                title="Show archived conversations"
                sub="List archived conversations in an Archived category"
              >
                <Toggle on={prefs.showArchived} onChange={(v) => prefs.set({ showArchived: v })} />
              </Row>
              <p className="help" style={{ fontSize: 12, marginTop: 12 }}>
                Custom categories are stored on the server when it supports conversation tags (Talk 24+), and
                locally on this computer otherwise. Drag conversations between categories to organize them.
              </p>
            </>
          )}

          {tab === 'desktop' && <DesktopTab />}

          {tab === 'advanced' && (
            <>
              <Row
                title="Send messages on Ctrl/⌘+Enter"
                sub="When on, Enter inserts a new line and Ctrl/⌘+Enter sends"
              >
                <Toggle on={prefs.sendOnCtrlEnter} onChange={(v) => prefs.set({ sendOnCtrlEnter: v })} />
              </Row>
              <TrustedCertificates />
            </>
          )}

          {tab === 'about' && (
            <>
              <Row title="Hubbub" sub={`Version ${version}`}>
                <button className="btn btn-tertiary small" onClick={() => void window.hubbub.updates.check()}>
                  Check for updates
                </button>
              </Row>
              <div className="help" style={{ fontSize: 12, marginTop: 8 }}>
                {update.state === 'checking' && 'Checking for updates…'}
                {update.state === 'not-available' && 'You are running the latest version.'}
                {update.state === 'available' &&
                  !update.downloadUrl &&
                  `Version ${update.version} is available and downloading.`}
                {update.state === 'available' && update.downloadUrl && (
                  <>
                    Version {update.version} is available.{' '}
                    <button
                      className="btn-link"
                      onClick={() => void window.hubbub.app.openExternal(update.downloadUrl!)}
                    >
                      Download it from GitHub
                    </button>
                  </>
                )}
                {update.state === 'downloading' && `Downloading update… ${update.percent}%`}
                {update.state === 'downloaded' && `Version ${update.version} is ready — restart to install.`}
                {update.state === 'error' && `Update check failed: ${update.message}`}
                {update.state === 'unsupported' && update.reason}
              </div>
              <Row title="Source code" sub="Hubbub is open source under the Apache License 2.0">
                <button
                  className="btn btn-tertiary small"
                  onClick={() => void window.hubbub.app.openExternal(REPO_URL)}
                >
                  GitHub
                </button>
              </Row>
              <p className="help" style={{ fontSize: 12, marginTop: 12 }}>
                Hubbub is an independent project and is not affiliated with Nextcloud GmbH or Mattermost, Inc.
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Row({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="sr-label">
        <div className="sr-title">{title}</div>
        {sub && <div className="sr-sub">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function DesktopTab() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null)
  useEffect(() => {
    void window.hubbub.app.getSettings().then(setSettings)
  }, [])
  if (!settings) return null
  const change = (patch: Partial<DesktopSettings>): void =>
    void window.hubbub.app.setSettings(patch).then(setSettings)
  return (
    <>
      <Row
        title="Start Hubbub when you log in"
        sub="Opens in the background so you get notifications right away"
      >
        <Toggle on={settings.openAtLogin} onChange={(v) => change({ openAtLogin: v })} />
      </Row>
      {!isMac && (
        <Row
          title="Keep running in the background"
          sub="Closing the window keeps Hubbub in the notification area, so you still get notifications. Quit from the tray icon."
        >
          <Toggle on={settings.runInBackground} onChange={(v) => change({ runInBackground: v })} />
        </Row>
      )}
      <Row
        title="Check spelling"
        sub={
          isMac
            ? 'Uses the macOS spell checker and its languages'
            : 'Uses the languages of your system. On Linux, dictionaries are downloaded from Google when first needed.'
        }
      >
        <Toggle on={settings.spellcheck} onChange={(v) => change({ spellcheck: v })} />
      </Row>
    </>
  )
}

function TrustedCertificates() {
  const [list, setList] = useState<TrustedCertificate[]>([])
  useEffect(() => {
    void window.hubbub.certificates.list().then(setList)
  }, [])
  return (
    <>
      <div className="sr-title" style={{ marginTop: 20 }}>
        Trusted certificates
      </div>
      {!list.length && (
        <p className="help" style={{ fontSize: 12 }}>
          None. When a server uses a self-signed or company-internal certificate, Hubbub asks before trusting
          it.
        </p>
      )}
      {list.map((c) => (
        <Row key={c.host} title={c.host} sub={`Trusted ${new Date(c.trustedAt * 1000).toLocaleDateString()}`}>
          <button
            className="btn btn-tertiary small"
            onClick={() => void window.hubbub.certificates.remove(c.host).then(setList)}
          >
            Remove
          </button>
        </Row>
      ))}
    </>
  )
}
