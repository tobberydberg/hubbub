import { useEffect, useState } from 'react'
import { MessagesSquare, Plus, X } from 'lucide-react'
import { applyTheme } from '@renderer/lib/themes'
import { setApp, useActiveAccount, useApp } from '@renderer/store/app'
import { useCall } from '@renderer/store/call'
import { usePrefs } from '@renderer/store/prefs'
import { closeRhs, navigateRooms, selectAccount } from '@renderer/sync/actions'
import { ChannelView } from './components/channel/ChannelView'
import { ThreadsView } from './components/channel/ThreadsView'
import { TodayView } from './components/today/TodayView'
import { AddPeople } from './components/calls/AddPeople'
import { CallPopout } from './components/calls/CallPopout'
import { CallView } from './components/calls/CallView'
import { IncomingCalls } from './components/calls/IncomingCalls'
import { ScreenPicker } from './components/calls/ScreenPicker'
import { GlobalHeader } from './components/GlobalHeader'
import { ModalHost } from './components/modals/Modals'
import { ProfileCardHost } from './components/common/ProfileCard'
import { Rhs } from './components/rhs/Rhs'
import { ServerRail } from './components/sidebar/ServerRail'
import { isCertificateError } from './components/common/Certificate'
import { reviewCertificate, Sidebar, signInAgain } from './components/sidebar/Sidebar'
import logoUrl from './assets/logo.svg'
import { CalendarSidebar } from './components/calendar/CalendarSidebar'
import { CalendarView } from './components/calendar/CalendarView'
import { SidebarResizer, useSidebarWidth } from './components/sidebar/SidebarResizer'

const isMac = window.hubbub.platform === 'darwin'

function useTheme(): void {
  const theme = usePrefs((s) => s.theme)
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
}

function useShortcuts(): void {
  useEffect(() => {
    const off = window.hubbub.app.onMenuCommand((cmd) => {
      switch (cmd.type) {
        case 'open-settings':
          return setApp({ modal: { type: 'settings' } })
        case 'add-server':
          return setApp({ modal: { type: 'add-server' } })
        case 'find-channel':
          return setApp({ modal: useApp.getState().modal?.type === 'switcher' ? null : { type: 'switcher' } })
        case 'new-conversation':
          return (
            useApp.getState().activeAccountId && setApp({ modal: { type: 'new-conversation', kind: 'dm' } })
          )
        case 'focus-search':
          return window.dispatchEvent(new Event('hubbub:focus-search'))
        case 'navigate':
          return navigateRooms(cmd.direction, cmd.unreadOnly)
        case 'switch-server': {
          const id = useApp.getState().accountOrder[cmd.index]
          if (id) selectAccount(id)
        }
      }
    })

    const onKey = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey
      // Cmd/Ctrl+1..9 switches servers, like Mattermost's team switching
      if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const id = useApp.getState().accountOrder[Number(e.key) - 1]
        if (id) {
          e.preventDefault()
          selectAccount(id)
        }
      }
      // Select All outside a text field selects the draft in the message box, not the whole window
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a' && !isEditable(e.target)) {
        const box = messageBox()
        if (box) {
          e.preventDefault()
          box.focus()
          box.select()
        }
      }
      if (e.key === 'Escape' && !useApp.getState().modal && useApp.getState().rhs) {
        const target = e.target as HTMLElement
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT') closeRhs()
      }
    }
    // The message box typed in last, for Select All
    const onFocus = (e: FocusEvent): void => {
      const t = e.target as HTMLElement | null
      if (t?.matches?.('.composer textarea')) lastBox = t as HTMLTextAreaElement
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('focusin', onFocus)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('focusin', onFocus)
    }
  }, [])
}

let lastBox: HTMLTextAreaElement | null = null

function isEditable(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null
  return (
    !!t &&
    (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)
  )
}

/** The message box to select in: the one typed in last if it's still there, else the conversation's */
function messageBox(): HTMLTextAreaElement | null {
  if (useApp.getState().modal) return null
  if (lastBox?.isConnected && !lastBox.disabled) return lastBox
  return document.querySelector<HTMLTextAreaElement>('.center .composer textarea:not(:disabled)')
}

function Center() {
  const account = useActiveAccount()
  const room = useApp((s) => {
    const a = s.activeAccountId ? s.accounts[s.activeAccountId] : undefined
    return a?.activeToken ? a.rooms[a.activeToken] : undefined
  })
  if (!account) return <main className="center" />
  if (account.view === 'threads') return <ThreadsView account={account} />
  if (account.view === 'today') return <TodayView account={account} />
  // Keyed so that each conversation gets fresh scroll position, composer state and drag state
  if (room) return <ChannelView key={`${account.info.id}/${room.token}`} account={account} room={room} />
  if (!account.roomsLoaded) {
    return (
      <main className="center">
        <div className="empty-state">
          {account.status === 'offline' || account.status === 'unauthorized' ? (
            <>
              <h2>Can’t connect to {account.info.label}</h2>
              <p>{account.status === 'unauthorized' ? 'You have been signed out.' : account.error}</p>
              {account.status === 'unauthorized' ? (
                <button className="btn btn-primary" onClick={() => signInAgain(account)}>
                  Sign in again
                </button>
              ) : (
                isCertificateError(account.error) && (
                  <button className="btn btn-primary" onClick={() => void reviewCertificate(account)}>
                    Review certificate
                  </button>
                )
              )}
            </>
          ) : (
            <div className="spinner" />
          )}
        </div>
      </main>
    )
  }
  return (
    <main className="center">
      <div className="empty-state">
        <MessagesSquare size={56} strokeWidth={1.5} />
        <h2>Pick a conversation</h2>
        <p>
          Choose a channel or direct message from the sidebar, or press {isMac ? '⌘K' : 'Ctrl+K'} to jump to
          one.
        </p>
      </div>
    </main>
  )
}

function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <img src={logoUrl} width={72} height={72} alt="" />
        <h1>Welcome to Hubbub</h1>
        <p>A desktop client for Nextcloud Talk. Connect one or more Nextcloud servers to get started.</p>
        <button className="btn btn-primary" onClick={() => setApp({ modal: { type: 'add-server' } })}>
          <Plus size={18} /> Add a server
        </button>
      </div>
    </div>
  )
}

function Toast() {
  const toast = useApp((s) => s.toast)
  if (!toast) return null
  return <div className={`toast ${toast.kind}`}>{toast.text}</div>
}

function UpdateBanner() {
  const update = useApp((s) => s.update)
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (update.state === 'available' && update.downloadUrl && dismissed !== update.version) {
    const url = update.downloadUrl
    return (
      <div className="update-banner">
        Hubbub {update.version} is available.
        <button onClick={() => void window.hubbub.app.openExternal(url)}>Download</button>
        <button className="update-dismiss" title="Not now" onClick={() => setDismissed(update.version)}>
          <X size={14} />
        </button>
      </div>
    )
  }
  if (update.state !== 'downloaded' || dismissed === update.version) return null
  return (
    <div className="update-banner">
      Hubbub {update.version} is ready to install.
      <button onClick={() => void window.hubbub.updates.install()}>Restart now</button>
      <button
        className="update-dismiss"
        title="Later (installs when you quit)"
        onClick={() => setDismissed(update.version)}
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function App() {
  useTheme()
  useShortcuts()
  const initialized = useApp((s) => s.initialized)
  const hasAccounts = useApp((s) => s.accountOrder.length > 0)
  const callExpanded = useCall((s) => !!s.active?.expanded)
  const callPoppedOut = useCall((s) => !!s.active?.poppedOut)
  const screenPicker = useCall((s) => !!s.active?.screenPicker)
  const addPeople = useCall((s) => !!s.active?.addPeople)
  const sidebarWidth = useSidebarWidth()
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  // The active server's calendar, when that is what it shows
  const calendar = useApp((s) => {
    const a = s.activeAccountId ? s.accounts[s.activeAccountId] : undefined
    return a?.view === 'calendar' ? a : undefined
  })

  return (
    <div className={`app${isMac ? ' is-mac' : ''}`}>
      <UpdateBanner />
      <GlobalHeader />
      <div className="app-body" style={{ ['--sidebar-width' as string]: `${dragWidth ?? sidebarWidth}px` }}>
        {initialized && !hasAccounts ? (
          <Welcome />
        ) : (
          <>
            <ServerRail />
            {calendar ? <CalendarSidebar /> : <Sidebar />}
            <SidebarResizer onDrag={setDragWidth} />
            {callExpanded ? (
              <CallView />
            ) : (
              <>
                {calendar ? <CalendarView account={calendar} /> : <Center />}
                <Rhs />
              </>
            )}
          </>
        )}
      </div>
      <ModalHost />
      <Toast />
      <IncomingCalls />
      <ProfileCardHost />
      {callPoppedOut && <CallPopout />}
      {screenPicker && !callPoppedOut && <ScreenPicker />}
      {addPeople && !callPoppedOut && <AddPeople />}
    </div>
  )
}
