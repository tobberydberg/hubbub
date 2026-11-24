import {
  app,
  desktopCapturer,
  powerSaveBlocker,
  shell,
  systemPreferences,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  type DesktopCapturerSource,
  type Session
} from 'electron'
import type { ScreenSource } from '@shared/ipc'

// Main-process side of calls: operating system permissions, staying awake, and hanging up before
// the app quits (otherwise the others see us in the call until the server times us out).

const HANGUP_TIMEOUT = 3000

let blocker: number | null = null
let active = false
let hangingUp = false

/** Development aid: fake camera and microphone, so calls can be tested without devices or prompts. */
export function useFakeMediaForTests(): void {
  if (app.isPackaged || !process.env.HUBBUB_FAKE_MEDIA) return
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}

export async function mediaAccess(kind: 'microphone' | 'camera'): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  if (systemPreferences.getMediaAccessStatus(kind) === 'granted') return true
  return systemPreferences.askForMediaAccess(kind)
}

/** Frame name the renderer uses for the popped-out call window */
export const CALL_WINDOW = 'hubbub-call'

/**
 * The popped-out call is a child window of the main renderer (opened with window.open), so it
 * shares the running call: the renderer draws into it, and media never has to move between processes.
 */
export function callWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 960,
    height: 640,
    minWidth: 420,
    minHeight: 320,
    title: 'Hubbub call',
    backgroundColor: '#111317',
    autoHideMenuBar: true
  }
}

export function secureCallWindow(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

export function setCallActive(value: boolean, getWindow: () => BrowserWindow | null): void {
  active = value
  // Keep timers (speaking detection, signaling retries) running at full speed while the main window
  // is hidden, e.g. when only the popped-out call is visible
  getWindow()?.webContents.setBackgroundThrottling(!value)
  if (value && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
  if (!value && blocker !== null) {
    powerSaveBlocker.stop(blocker)
    blocker = null
  }
  if (!value && hangingUp) app.quit()
}

/** Call from before-quit: returns true if quitting must wait for the call to end. */
export function hangUpBeforeQuit(getWindow: () => BrowserWindow | null): boolean {
  const win = getWindow()
  if (!active || hangingUp || !win) return false
  hangingUp = true
  win.webContents.send('calls:hangup')
  setTimeout(() => {
    active = false
    app.quit()
  }, HANGUP_TIMEOUT)
  return true
}

// --- Screen sharing ---------------------------------------------------------------
// Hubbub shows its own picker: the renderer lists the sources, the user picks one, and the
// renderer's getDisplayMedia() call is then answered with that source.

let sources = new Map<string, DesktopCapturerSource>()
let chosen: string | null = null

export async function screenSources(): Promise<ScreenSource[]> {
  // Test aid (see useFakeMediaForTests): a fake source that shares the requesting page itself.
  // Listing real sources would make macOS ask for the Screen Recording permission.
  if (!app.isPackaged && process.env.HUBBUB_FAKE_MEDIA) {
    return [{ id: TEST_SOURCE, name: 'Test screen', kind: 'screen', thumbnail: '' }]
  }
  const list = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  })
  sources = new Map(list.map((s) => [s.id, s]))
  return list
    .filter((s) => !s.thumbnail.isEmpty())
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined
    }))
}

const TEST_SOURCE = 'test:frame'

export function chooseScreenSource(id: string | null): void {
  chosen = id
}

/** macOS needs the Screen Recording permission; elsewhere sharing just works. */
export function screenAccess(): 'granted' | 'denied' | 'unknown' {
  if (process.platform !== 'darwin') return 'granted'
  const status = systemPreferences.getMediaAccessStatus('screen')
  return status === 'granted'
    ? 'granted'
    : status === 'denied' || status === 'restricted'
      ? 'denied'
      : 'unknown'
}

export function openScreenSettings(): void {
  if (process.platform === 'darwin') {
    void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  }
}

export function handleDisplayMedia(s: Session): void {
  s.setDisplayMediaRequestHandler((request, callback) => {
    if (chosen === TEST_SOURCE && request.frame) {
      chosen = null
      callback({ video: request.frame })
      return
    }
    const source = chosen ? sources.get(chosen) : undefined
    chosen = null
    // An empty answer rejects the renderer's request
    callback(source ? { video: source } : {})
  })
}
