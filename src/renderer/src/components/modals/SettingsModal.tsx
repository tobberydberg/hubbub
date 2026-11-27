import { useEffect, useState } from 'react'
import {
  Bell,
  CalendarDays,
  Info,
  LayoutList,
  Monitor,
  Palette,
  Phone,
  RefreshCw,
  Copy,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react'
import type { DesktopSettings, ImapSettings, TrustedCertificate } from '@shared/ipc'
import { THEMES } from '@renderer/lib/themes'
import { setApp, useApp } from '@renderer/store/app'
import { useExternal } from '@renderer/store/external'
import { setBackgroundBlur, switchCamera, switchMicrophone, switchSpeaker } from '@renderer/calls/call'
import { deviceLabel, playTestSound, useMediaDevices } from '@renderer/calls/devices'
import { usePrefs, type ThemeName } from '@renderer/store/prefs'
import { useCalendar } from '@renderer/store/calendar'
import { mailOnlyAddresses, refreshCalendars, reloadMyAddresses } from '@renderer/sync/calendar'
import { AddAddress } from '../calendar/AddAddress'
import { AiSettings } from './AiSettings'
import {
  forgetHandledMail,
  mailInvitationState,
  scanMail,
  setMailInvitationSource,
  setMailInvitations,
  type MailInvitationState
} from '@renderer/sync/mail-invitations'
import { clearMailDebug, mailDebugText, useMailDebug } from '@renderer/sync/mail-debug'
import { copyText } from '@renderer/sync/actions'
import { Modal, Toggle } from '../common/Modal'

type Tab =
  | 'display'
  | 'notifications'
  | 'sidebar'
  | 'calls'
  | 'calendar'
  | 'ai'
  | 'desktop'
  | 'advanced'
  | 'about'

const isMac = window.hubbub.platform === 'darwin'

const REPO_URL = 'https://github.com/tobberydberg/hubbub'

export function SettingsModal({ onClose, initialTab }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'display')
  const prefs = usePrefs()
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.hubbub.app.version().then(setVersion)
  }, [])

  const nav: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'display', label: 'Display', icon: <Palette size={16} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
    { id: 'sidebar', label: 'Sidebar', icon: <LayoutList size={16} /> },
    { id: 'calls', label: 'Calls', icon: <Phone size={16} /> },
    { id: 'calendar', label: 'Calendar', icon: <CalendarDays size={16} /> },
    { id: 'ai', label: 'AI', icon: <Sparkles size={16} /> },
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
              <Row
                title="Show link previews"
                sub="A preview under messages with a link: the page's title, description and picture, as your Nextcloud server fetches it."
              >
                <Toggle on={prefs.linkPreviews} onChange={(v) => prefs.set({ linkPreviews: v })} />
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

          {tab === 'calls' && <CallsTab />}

          {tab === 'calendar' && (
            <>
              <DefaultCalendars />
              <MyAddresses />
              <OtherCalendars />
              <MailInvitations />
              <Row title="Show week numbers" sub="In the small month, and in the week and month views">
                <Toggle
                  on={prefs.calendarWeekNumbers}
                  onChange={(v) => prefs.set({ calendarWeekNumbers: v })}
                />
              </Row>
              <Row title="Show weekends in the week view" sub="Monday to Sunday instead of Monday to Friday">
                <Toggle on={prefs.calendarWeekends} onChange={(v) => prefs.set({ calendarWeekends: v })} />
              </Row>
              <Row
                title="Next meeting in the chat sidebar"
                sub="From 10 minutes before a meeting with a call until it ends, with Join"
              >
                <Toggle on={prefs.meetingStrip} onChange={(v) => prefs.set({ meetingStrip: v })} />
              </Row>
            </>
          )}

          {tab === 'ai' && <AiSettings onClose={onClose} />}

          {tab === 'desktop' && <DesktopTab />}

          {tab === 'advanced' && (
            <>
              <Row
                title="Send messages on Ctrl/⌘+Enter"
                sub="When on, Enter inserts a new line and Ctrl/⌘+Enter sends"
              >
                <Toggle on={prefs.sendOnCtrlEnter} onChange={(v) => prefs.set({ sendOnCtrlEnter: v })} />
              </Row>
              <Row
                title="Turn emoticons into emoji"
                sub=":-) becomes 🙂 and :tada: becomes 🎉 as you type. Backspace right after brings the text back."
              >
                <Toggle on={prefs.convertEmoticons} onChange={(v) => prefs.set({ convertEmoticons: v })} />
              </Row>
              <TrustedCertificates />
            </>
          )}

          {tab === 'about' && (
            <>
              <UpdateSection version={version} />
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

function UpdateSection({ version }: { version: string }) {
  const update = useApp((s) => s.update)
  const open = (url: string): void => void window.hubbub.app.openExternal(url)
  const whatsNew = (v: string): React.ReactNode => (
    <button className="btn-link" onClick={() => open(`${REPO_URL}/releases/tag/v${v}`)}>
      What’s new in {v}
    </button>
  )

  let text: React.ReactNode = null
  let action: React.ReactNode = (
    <button className="btn btn-tertiary small" onClick={() => void window.hubbub.updates.check()}>
      Check for updates
    </button>
  )
  switch (update.state) {
    case 'checking':
      text = 'Checking for updates…'
      action = (
        <button className="btn btn-tertiary small" disabled>
          Checking…
        </button>
      )
      break
    case 'not-available':
      text = 'You have the latest version.'
      break
    case 'available':
      if (update.downloadUrl) {
        text = (
          <>
            Version {update.version} is available. {update.note} {whatsNew(update.version)}
          </>
        )
        action = (
          <button className="btn btn-primary small" onClick={() => open(update.downloadUrl!)}>
            Download
          </button>
        )
      } else {
        text = (
          <>
            Downloading version {update.version}… {whatsNew(update.version)}
          </>
        )
        action = null
      }
      break
    case 'downloading':
      text = (
        <span className="update-progress">
          <span style={{ width: `${update.percent}%` }} />
        </span>
      )
      action = <span className="help">{update.percent}%</span>
      break
    case 'downloaded':
      text = (
        <>
          Version {update.version} is ready to install. {update.note} {whatsNew(update.version)}
        </>
      )
      action = (
        <button className="btn btn-primary small" onClick={() => void window.hubbub.updates.install()}>
          Restart now
        </button>
      )
      break
    case 'error':
      text = `Checking for updates failed: ${update.message}`
      break
    case 'unsupported':
      text = update.reason
      action = null
      break
  }
  return (
    <>
      <Row title="Hubbub" sub={`Version ${version}`}>
        {action}
      </Row>
      {text && <div className="update-text">{text}</div>}
    </>
  )
}

/** Per server: invitations that arrive in Nextcloud Mail go into the calendar */
function MailInvitations() {
  const order = useApp((s) => s.accountOrder)
  const accounts = useApp((s) => s.accounts)
  const enabled = usePrefs((s) => s.mailInvitations)
  const sources = usePrefs((s) => s.mailInvitationSource)
  const checks = usePrefs((s) => s.mailInvitationCheck)
  const [states, setStates] = useState<Record<string, MailInvitationState>>({})
  useEffect(() => {
    let alive = true
    for (const id of order) {
      void mailInvitationState(id).then((st) => alive && setStates((s) => ({ ...s, [id]: st })))
    }
    return () => {
      alive = false
    }
  }, [order])
  return (
    <>
      {order.map((id) => {
        const st = states[id]
        const source = sources[id] ?? 'nextcloud'
        const on = !!enabled[id]
        const check = checks[id]
        const value = !on ? 'off' : source
        return (
          <div key={id}>
            <Row
              title={`Invitations from mail${order.length > 1 ? ` · ${accounts[id]?.info.label}` : ''}`}
              sub="Meeting invitations in your inbox (from Microsoft Teams, Outlook, Google and others) are added to your default calendar, so you can see and answer them. The mails stay unread. Checked every few minutes while Hubbub runs."
            >
              <select
                className="setting-select"
                value={value}
                onChange={(e) => {
                  const v = e.target.value as 'off' | 'nextcloud' | 'imap'
                  if (v !== 'off') setMailInvitationSource(id, v)
                  setMailInvitations(id, v !== 'off' && (v === 'imap' || st?.available !== false))
                }}
              >
                <option value="off">Off</option>
                <option value="nextcloud" disabled={st?.available === false}>
                  Nextcloud Mail{st?.available === false ? ' (not available)' : ''}
                </option>
                <option value="imap">Mail server (IMAP)</option>
              </select>
            </Row>
            {on && source === 'nextcloud' && st?.available === false && (
              <p className="imap-note error">{st.reason}</p>
            )}
            {source === 'imap' && on && <ImapSettingsForm accountId={id} />}
            {on && <CheckNow accountId={id} check={check} />}
          </div>
        )
      })}
    </>
  )
}

/** "Check now", and what the last check found */
function CheckNow({
  accountId,
  check
}: {
  accountId: string
  check?: { at: number; error?: string; added?: number; changed?: number }
}) {
  const [busy, setBusy] = useState(false)
  const [debug, setDebug] = useState(false)
  const run = async (): Promise<void> => {
    setBusy(true)
    await scanMail(accountId)
    setBusy(false)
  }
  const time = check
    ? new Date(check.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : ''
  const found = !check
    ? ''
    : [
        check.added ? `${check.added} new ${check.added === 1 ? 'invitation' : 'invitations'}` : '',
        check.changed ? `${check.changed} updated` : ''
      ]
        .filter(Boolean)
        .join(', ') || 'nothing new'
  return (
    <div className="imap-check">
      <button className="btn btn-tertiary small" disabled={busy} onClick={() => void run()}>
        <RefreshCw size={14} className={busy ? 'spin' : undefined} /> {busy ? 'Checking…' : 'Check now'}
      </button>
      {check && !busy && (
        <span className={`imap-note${check.error ? ' error' : ''}`}>
          {check.error ? `Last check at ${time} failed: ${check.error}` : `Last checked ${time}: ${found}`}
        </span>
      )}
      <button className="btn-link imap-debug-toggle" onClick={() => setDebug(!debug)}>
        {debug ? 'Hide debug' : 'Show debug'}
      </button>
      {debug && <MailDebug accountId={accountId} busy={busy} onRun={() => void run()} />}
    </div>
  )
}

/** The last hour of what the checks did, to find out why an invitation didn't show up */
function MailDebug({ accountId, busy, onRun }: { accountId: string; busy: boolean; onRun: () => void }) {
  const entries = useMailDebug(accountId)
  return (
    <div className="mail-debug">
      <div className="mail-debug-actions">
        <span className="imap-note">What the checks did in the last hour, newest first.</span>
        <button
          className="btn btn-tertiary small"
          disabled={!entries.length}
          onClick={() => void copyText(mailDebugText(entries), 'Debug log copied')}
        >
          <Copy size={14} /> Copy
        </button>
        <button
          className="btn btn-tertiary small"
          disabled={busy}
          title="Forget which mails were handled and check all mail of the last 30 days again. Invitations already in the calendar are recognised and not added twice."
          onClick={() => {
            forgetHandledMail(accountId)
            onRun()
          }}
        >
          <RefreshCw size={14} /> Look at all mail again
        </button>
        <button
          className="btn btn-tertiary small"
          disabled={!entries.length}
          onClick={() => clearMailDebug(accountId)}
        >
          Clear
        </button>
      </div>
      <div className="mail-debug-list">
        {entries.length === 0 ? (
          <div className="imap-note">Nothing yet. Press Check now.</div>
        ) : (
          entries.map((e, i) => (
            <div key={`${e.at}-${i}`} className={`mail-debug-entry${e.level === 'error' ? ' error' : ''}`}>
              <span className="mail-debug-time">{new Date(e.at).toLocaleTimeString()}</span>
              <span>{e.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const DEFAULT_PORT = { tls: 993, starttls: 143, none: 143 } as const

/** The mail server to read invitations from; the password is kept in the system keychain */
function ImapSettingsForm({ accountId }: { accountId: string }) {
  const [config, setConfig] = useState<ImapSettings>({
    host: '',
    port: 993,
    security: 'tls',
    username: '',
    folder: 'INBOX'
  })
  const [hasPassword, setHasPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [folders, setFolders] = useState<string[]>([])
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    void window.hubbub.imap.get(accountId).then((c) => {
      if (!c) return
      const { hasPassword: has, ...settings } = c
      setConfig(settings)
      setHasPassword(has)
    })
  }, [accountId])

  const change = (patch: Partial<ImapSettings>): void => {
    setConfig((c) => ({ ...c, ...patch }))
    setDirty(true)
    setStatus(null)
  }
  const ready = !!config.host.trim() && !!config.username.trim() && (hasPassword || !!password)
  const pass = password ? password : undefined

  const test = async (): Promise<boolean> => {
    setBusy('test')
    const r = await window.hubbub.imap.test(accountId, config, pass)
    setBusy(null)
    if (r.ok) {
      setFolders(r.folders ?? [])
      setStatus({ ok: true, text: `Connected. Hubbub can read ${config.folder || 'INBOX'}.` })
    } else {
      setStatus({ ok: false, text: r.error ?? 'Couldn’t connect' })
    }
    return r.ok
  }

  const save = async (): Promise<void> => {
    if (!(await test())) return
    setBusy('save')
    try {
      await window.hubbub.imap.set(accountId, config, pass)
      setHasPassword(true)
      setPassword('')
      setDirty(false)
      setStatus({ ok: true, text: 'Saved. Checking for invitations now.' })
      void scanMail(accountId)
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
    setBusy(null)
  }

  return (
    <div className="imap-form">
      <div className="imap-grid">
        <label className="imap-host">
          <span>Server</span>
          <input
            className="input"
            placeholder="imap.example.com"
            value={config.host}
            onChange={(e) => change({ host: e.target.value })}
          />
        </label>
        <label>
          <span>Security</span>
          <select
            className="input"
            value={config.security}
            onChange={(e) => {
              const security = e.target.value as ImapSettings['security']
              change({ security, port: DEFAULT_PORT[security] })
            }}
          >
            <option value="tls">SSL/TLS</option>
            <option value="starttls">STARTTLS</option>
            <option value="none">None (unencrypted)</option>
          </select>
        </label>
        <label>
          <span>Port</span>
          <input
            className="input"
            type="number"
            value={config.port}
            onChange={(e) => change({ port: Number(e.target.value) })}
          />
        </label>
        <label className="imap-wide">
          <span>User name</span>
          <input
            className="input"
            autoComplete="off"
            value={config.username}
            onChange={(e) => change({ username: e.target.value })}
          />
        </label>
        <label className="imap-wide">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={hasPassword ? 'Saved; type to change' : ''}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setDirty(true)
              setStatus(null)
            }}
          />
        </label>
        <label className="imap-wide">
          <span>Folder</span>
          {folders.length ? (
            <select
              className="input"
              value={config.folder}
              onChange={(e) => change({ folder: e.target.value })}
            >
              {!folders.includes(config.folder) && <option value={config.folder}>{config.folder}</option>}
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              value={config.folder}
              onChange={(e) => change({ folder: e.target.value })}
            />
          )}
        </label>
      </div>
      {config.security === 'none' && (
        <p className="imap-note error">
          Your password and mail go over the network unencrypted. Use this only for a server on your own
          computer or network.
        </p>
      )}
      <div className="imap-actions">
        <button className="btn btn-tertiary small" disabled={!ready || !!busy} onClick={() => void test()}>
          {busy === 'test' ? 'Connecting…' : 'Test connection'}
        </button>
        <button
          className="btn btn-primary small"
          disabled={!ready || !!busy || (!dirty && hasPassword)}
          onClick={() => void save()}
        >
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        {status && <span className={`imap-status${status.ok ? ' ok' : ' error'}`}>{status.text}</span>}
      </div>
      <p className="imap-note">
        Hubbub opens the folder read-only, so nothing changes on the server and mails stay unread. The
        password is kept in your system’s keychain.
      </p>
    </div>
  )
}

/** Per server: the addresses your calendar knows as yours, and adding one */
/** Per server: calendars from elsewhere (a link, iCloud, CalDAV) shown in its calendar */
function OtherCalendars() {
  const order = useApp((s) => s.accountOrder)
  const accounts = useApp((s) => s.accounts)
  const sources = useExternal((s) => s.sources)
  const status = useExternal((s) => s.status)
  const KIND = { link: 'Calendar link', icloud: 'iCloud', caldav: 'CalDAV' }
  return (
    <>
      {order.map((id) => {
        const mine = sources.filter((s) => s.accountId === id)
        return (
          <div key={id} className="setting-row other-calendars">
            <div className="sr-label">
              <div className="sr-title">
                Calendars from elsewhere{order.length > 1 ? ` · ${accounts[id]?.info.label}` : ''}
              </div>
              <div className="sr-sub">
                Your Google, iCloud or Outlook calendar beside your Nextcloud calendars, read by Hubbub on
                this computer: they never go through Nextcloud. Optionally, their busy time is copied into a
                Nextcloud calendar, without details.
              </div>
              {mine.map((s) => {
                const st = status[s.id]
                return (
                  <div key={s.id} className="other-calendar">
                    <span
                      className="other-calendar-dot"
                      style={{ background: s.kind === 'link' ? s.color : undefined }}
                    />
                    <span className="other-calendar-name">{s.name}</span>
                    <span className="other-calendar-note">
                      {KIND[s.kind]} · {s.where}
                      {s.busy ? ' · busy time to Nextcloud' : ''}
                    </span>
                    {(st?.error || st?.busy?.error) && (
                      <span className="other-calendar-error" title={st.error ?? st.busy?.error}>
                        {st.error ? 'Couldn’t be checked' : 'Busy time failed'}
                      </span>
                    )}
                    <button
                      className="ev-btn light"
                      onClick={() =>
                        setApp({ modal: { type: 'calendar-source', accountId: id, sourceId: s.id } })
                      }
                    >
                      Change…
                    </button>
                  </div>
                )
              })}
              <button
                className="ev-btn light other-calendar-add"
                onClick={() => setApp({ modal: { type: 'calendar-source', accountId: id } })}
              >
                Add a calendar…
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}

function MyAddresses() {
  const order = useApp((s) => s.accountOrder)
  const accounts = useApp((s) => s.accounts)
  return (
    <>
      {order.map((id) => (
        <MyAddressesFor
          key={id}
          accountId={id}
          label={order.length > 1 ? accounts[id]?.info.label : undefined}
        />
      ))}
    </>
  )
}

function MyAddressesFor({ accountId, label }: { accountId: string; label?: string }) {
  const [list, setList] = useState<string[]>([])
  const [adding, setAdding] = useState('')
  const reload = (): void => void reloadMyAddresses(accountId).then(setList)
  useEffect(reload, [accountId])
  const mailOnly = mailOnlyAddresses(accountId)
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adding.trim())
  return (
    <div className="setting-row my-addresses">
      <div className="sr-label">
        <div className="sr-title">Your email addresses{label ? ` · ${label}` : ''}</div>
        <div className="sr-sub">
          Invitations to these are yours, and you can edit the meetings you organize from them. Hubbub also
          counts your aliases in Nextcloud Mail, but Nextcloud only emails answers and meeting changes from
          your account’s addresses: add an alias to your account for that.
        </div>
        <div className="my-address-list">
          {list
            .filter((a) => !mailOnly.includes(a))
            .map((a) => (
              <span key={a} className="my-address">
                {a}
              </span>
            ))}
        </div>
        {mailOnly.length > 0 && (
          <div className="my-address-mail">
            {mailOnly.map((a) => (
              <div key={a} className="my-address-mail-row">
                <span className="my-address">{a}</span>
                <span className="my-address-note">Nextcloud Mail alias</span>
                <AddAddress accountId={accountId} email={a} label="Add to account" onDone={reload} />
              </div>
            ))}
          </div>
        )}
        <div className="my-address-add">
          <input
            className="input"
            placeholder="another.address@example.com"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          />
          {valid && (
            <AddAddress
              accountId={accountId}
              email={adding.trim()}
              label="Add"
              onDone={() => {
                setAdding('')
                reload()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** Per server: the calendar new events go into */
function DefaultCalendars() {
  const order = useApp((s) => s.accountOrder)
  const accounts = useApp((s) => s.accounts)
  const calendars = useCalendar((s) => s.accounts)
  const chosen = usePrefs((s) => s.defaultCalendars)
  useEffect(() => {
    for (const id of order) if (!useCalendar.getState().accounts[id]?.calendars) void refreshCalendars(id)
  }, [order])
  return (
    <>
      {order.map((id) => {
        const writable = (calendars[id]?.calendars ?? []).filter((c) => c.writable)
        const current = writable.find((c) => c.href === chosen[id]) ?? writable.find((c) => !c.sharedBy)
        return (
          <Row
            key={id}
            title="Default calendar for new events"
            sub={order.length > 1 ? accounts[id]?.info.label : undefined}
          >
            <select
              className="setting-select"
              value={current?.href ?? ''}
              disabled={!writable.length}
              onChange={(e) => {
                usePrefs.getState().set({ defaultCalendars: { ...chosen, [id]: e.target.value } })
              }}
            >
              {!writable.length && <option value="">Loading…</option>}
              {writable.map((c) => (
                <option key={c.href} value={c.href}>
                  {c.name}
                  {c.sharedBy ? ` (${c.sharedBy})` : ''}
                </option>
              ))}
            </select>
          </Row>
        )
      })}
    </>
  )
}

function CallsTab() {
  const prefs = usePrefs()
  const devices = useMediaDevices()
  // Changes apply right away, also to a running call
  const select = (
    value: string | null,
    list: MediaDeviceInfo[],
    onChange: (id: string | null) => unknown
  ): React.ReactNode => (
    <select
      className="setting-select"
      value={value ?? ''}
      onChange={(e) => void onChange(e.target.value || null)}
    >
      <option value="">System default</option>
      {list.map((d, i) => (
        <option key={d.deviceId} value={d.deviceId}>
          {deviceLabel(d, i)}
        </option>
      ))}
    </select>
  )
  return (
    <>
      <Row
        title="Ring for incoming calls"
        sub="Rings and shows a notification when a call starts. Not while you are on Do not disturb."
      >
        <Toggle on={prefs.ringForCalls} onChange={(v) => prefs.set({ ringForCalls: v })} />
      </Row>
      <Row
        title="Show call options before a call"
        sub="Pick devices, check your camera and sound, and choose how the call shows, before starting or joining."
      >
        <Toggle on={prefs.callSetup} onChange={(v) => prefs.set({ callSetup: v })} />
      </Row>
      <Row title="Show calls" sub="Where a call shows when it starts">
        <select
          className="setting-select"
          value={prefs.callStartView}
          onChange={(e) => prefs.set({ callStartView: e.target.value as typeof prefs.callStartView })}
        >
          <option value="sidebar">In the sidebar</option>
          <option value="expanded">In the window</option>
          <option value="popout">In its own window</option>
        </select>
      </Row>
      <Row title="Microphone">{select(prefs.microphoneId, devices.microphones, switchMicrophone)}</Row>
      <Row title="Camera">{select(prefs.cameraId, devices.cameras, switchCamera)}</Row>
      <Row
        title="Blur my background"
        sub="Others see you sharp and your surroundings blurred. Done on this computer; also in the call controls."
      >
        <Toggle on={prefs.backgroundBlur} onChange={(v) => void setBackgroundBlur(v)} />
      </Row>
      <Row title="Speaker">
        <span className="cs-row">
          {select(prefs.speakerId, devices.speakers, switchSpeaker)}
          <button className="btn btn-tertiary small" onClick={() => void playTestSound(prefs.speakerId)}>
            Test
          </button>
        </span>
      </Row>
      {devices.unnamed && (
        <p className="help" style={{ fontSize: 12 }}>
          Device names show up after your first call.
        </p>
      )}
    </>
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
