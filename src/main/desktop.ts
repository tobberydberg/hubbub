import { app, Menu, nativeImage, session, Tray, type BrowserWindow } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DesktopSettings } from '@shared/ipc'
import { readJson, writeJson } from './storage'

// Desktop integration: settings that matter without the window (background mode, login item,
// spell checking) and the tray icon on Windows and Linux.

const FILE = 'desktop-settings.json'
const isMac = process.platform === 'darwin'

let settings: DesktopSettings | null = null

export function getSettings(): DesktopSettings {
  settings ??= {
    // Mattermost's default: keep running in the notification area on Windows and Linux
    runInBackground: !isMac,
    openAtLogin: false,
    spellcheck: true,
    ...readJson<Partial<DesktopSettings>>(FILE, {})
  }
  return settings
}

export function setSettings(
  patch: Partial<DesktopSettings>,
  getWindow: () => BrowserWindow | null
): DesktopSettings {
  const next = { ...getSettings() }
  for (const key of ['runInBackground', 'openAtLogin', 'spellcheck'] as const) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key]
  }
  settings = next
  writeJson(FILE, next)
  applySettings(getWindow)
  return next
}

export function applySettings(getWindow: () => BrowserWindow | null): void {
  const s = getSettings()
  setOpenAtLogin(s.openAtLogin)
  session.defaultSession.setSpellCheckerEnabled(s.spellcheck)
  if (s.spellcheck) setSpellCheckerLanguages()
  if (!isMac && s.runInBackground) createTray(getWindow)
  else destroyTray()
}

/** macOS uses the system spell checker; elsewhere pick the dictionaries for the user's languages. */
function setSpellCheckerLanguages(): void {
  if (isMac) return
  const ses = session.defaultSession
  const available = ses.availableSpellCheckerLanguages
  const wanted = new Set<string>()
  for (const lang of app.getPreferredSystemLanguages()) {
    const exact = available.find((a) => a.toLowerCase() === lang.toLowerCase())
    const base = available.find((a) => a.split('-')[0] === lang.split('-')[0])
    const pick = exact ?? base
    if (pick) wanted.add(pick)
  }
  if (!wanted.size && available.includes('en-US')) wanted.add('en-US')
  ses.setSpellCheckerLanguages([...wanted].slice(0, 3))
}

/** Launched by the login item: start in the background instead of popping up a window. */
export function launchedAtLogin(): boolean {
  if (process.argv.includes('--hidden')) return true
  return isMac && app.getLoginItemSettings().wasOpenedAtLogin
}

function setOpenAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return // a dev build would register the Electron binary
  if (process.platform === 'linux') {
    // Electron has no login item API on Linux; use the XDG autostart directory
    const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart')
    const file = join(dir, 'hubbub.desktop')
    if (!enabled) return void rmSync(file, { force: true })
    const exec = process.env.APPIMAGE || process.execPath
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      file,
      `[Desktop Entry]\nType=Application\nName=Hubbub\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`
    )
    return
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: enabled && !isMac ? ['--hidden'] : [] })
}

// --- Tray ------------------------------------------------------------------------

let tray: Tray | null = null
let unread = false

// resources/ is packaged inside app.asar, which nativeImage can read from
const resource = (name: string): string => join(__dirname, '../../resources', name)

function trayImage(): Electron.NativeImage {
  return nativeImage.createFromPath(resource(unread ? 'tray-unread.png' : 'tray.png'))
}

export function showWindow(getWindow: () => BrowserWindow | null): void {
  const win = getWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createTray(getWindow: () => BrowserWindow | null): void {
  if (tray) return
  tray = new Tray(trayImage())
  tray.setToolTip('Hubbub')
  tray.on('click', () => showWindow(getWindow))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Hubbub', click: () => showWindow(getWindow) },
      { type: 'separator' },
      { label: 'Quit Hubbub', click: () => app.quit() }
    ])
  )
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** Shows a dot on the tray icon while there are unread messages. */
export function setTrayUnread(count: number, mention: boolean): void {
  const next = count > 0 || mention
  if (next === unread) return
  unread = next
  tray?.setImage(trayImage())
  tray?.setToolTip(next ? `Hubbub – ${count > 0 ? `${count} unread` : 'unread messages'}` : 'Hubbub')
}

/** Whether closing the window should only hide it. */
export function keepRunningOnClose(): boolean {
  return isMac || (getSettings().runInBackground && tray !== null)
}
