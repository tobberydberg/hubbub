import { app, type BrowserWindow } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { UpdateStatus } from '@shared/ipc'
import {
  cleanUpAfterUpdate,
  downloadMacUpdate,
  installMacUpdate,
  releaseBaseUrl,
  selfUpdateBlocked
} from './mac-update'

// Updates from GitHub Releases. Each release has update manifests (latest*.yml) listing its files
// with checksums; electron-updater reads them from the GitHub release.

const { autoUpdater } = electronUpdater
const RELEASES_URL = 'https://github.com/tobberydberg/hubbub/releases'
const FIRST_CHECK = 15_000
const CHECK_EVERY = 6 * 60 * 60_000

/**
 * How this installation updates:
 * - auto: electron-updater downloads and installs (Windows, Linux AppImage, deb and rpm, signed macOS)
 * - replace: unsigned macOS, where Hubbub replaces its own app bundle (see mac-update.ts)
 * - manual: Hubbub only says that a new version is out, and links to it
 */
type Mode =
  { kind: 'auto' | 'replace' } | { kind: 'manual'; note: string } | { kind: 'unsupported'; reason: string }

let getWindow: () => BrowserWindow | null = () => null
let lastStatus: UpdateStatus = { state: 'idle' }
let mode: Mode = { kind: 'unsupported', reason: 'Not started' }
/** Unsigned macOS: the downloaded app, swapped in when Hubbub quits */
let pendingMacApp: string | null = null
let macDownload: Promise<void> | null = null

function send(status: UpdateStatus): void {
  if (status.state !== 'downloading') console.log('[updates]', JSON.stringify(status))
  lastStatus = status
  getWindow()?.webContents.send('updates:status', status)
}

/** 'deb' or 'rpm' when installed from those packages (electron-builder writes this file) */
function linuxPackage(): string | null {
  try {
    return readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim()
  } catch {
    return null
  }
}

/** macOS's own updater only accepts apps signed with a Developer ID */
function isDeveloperIdSigned(): boolean {
  const bundle = resolve(process.execPath, '../../..')
  const res = spawnSync('codesign', ['-dv', '--verbose=2', bundle], { encoding: 'utf8', timeout: 5000 })
  return /Authority=Developer ID Application/.test(res.stderr ?? '')
}

function detectMode(): Mode {
  if (!app.isPackaged) return { kind: 'unsupported', reason: 'Updates are disabled in development builds' }
  if (process.platform === 'linux') {
    const pkg = linuxPackage()
    if (process.env.APPIMAGE || pkg === 'deb' || pkg === 'rpm') return { kind: 'auto' }
    return { kind: 'manual', note: 'Update through your package manager, or download the new version.' }
  }
  if (process.platform === 'darwin' && !isDeveloperIdSigned()) {
    const blocked = selfUpdateBlocked()
    return blocked ? { kind: 'manual', note: `${blocked}.` } : { kind: 'replace' }
  }
  return { kind: 'auto' }
}

const notesUrl = (version: string): string => `${RELEASES_URL}/tag/v${version}`

export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  cleanUpAfterUpdate()
  mode = detectMode()
  if (mode.kind === 'unsupported') {
    lastStatus = { state: 'unsupported', reason: mode.reason }
    return
  }

  // deb and rpm ask for the administrator password, so they install on "Restart now", not silently on quit
  const passwordToInstall = process.platform === 'linux' && !process.env.APPIMAGE
  autoUpdater.autoDownload = mode.kind === 'auto'
  autoUpdater.autoInstallOnAppQuit = mode.kind === 'auto' && !passwordToInstall
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    if (mode.kind === 'replace') void downloadForMac(info)
    else if (mode.kind === 'manual') {
      send({
        state: 'available',
        version: info.version,
        downloadUrl: notesUrl(info.version),
        note: mode.note
      })
    } else send({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }))
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) =>
    send({
      state: 'downloaded',
      version: info.version,
      note: passwordToInstall ? 'You will be asked for your password to install it.' : undefined
    })
  )
  autoUpdater.on('error', (err) => send({ state: 'error', message: err?.message ?? String(err) }))

  // Unsigned macOS: a downloaded update is installed when Hubbub quits, like on the other platforms
  app.on('will-quit', () => {
    if (!pendingMacApp) return
    installMacUpdate(pendingMacApp, false)
    pendingMacApp = null
  })

  setTimeout(() => checkForUpdates(), FIRST_CHECK)
  setInterval(() => checkForUpdates(), CHECK_EVERY)
}

function downloadForMac(info: UpdateInfo): Promise<void> {
  if (pendingMacApp && lastStatus.state === 'downloaded' && lastStatus.version === info.version) {
    return Promise.resolve()
  }
  macDownload ??= (async () => {
    let lastPercent = -1
    try {
      send({ state: 'downloading', percent: 0 })
      pendingMacApp = await downloadMacUpdate(info.files, releaseBaseUrl(info.version, RELEASES_URL), (f) => {
        const percent = Math.floor(f * 100)
        if (percent !== lastPercent) send({ state: 'downloading', percent: (lastPercent = percent) })
      })
      send({ state: 'downloaded', version: info.version })
    } catch (err) {
      send({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      macDownload = null
    }
  })()
  return macDownload
}

export function checkForUpdates(): void {
  if (mode.kind === 'unsupported') {
    send(lastStatus)
    return
  }
  // A downloaded update stays ready; checking again would only download it again
  if (lastStatus.state === 'downloaded' || lastStatus.state === 'downloading') {
    send(lastStatus)
    return
  }
  autoUpdater.checkForUpdates().catch((err) => send({ state: 'error', message: String(err) }))
}

/** "Restart now": installs the downloaded update and starts the new version. */
export function installUpdate(): void {
  if (lastStatus.state !== 'downloaded') return
  if (mode.kind === 'replace' && pendingMacApp) {
    installMacUpdate(pendingMacApp, true)
    pendingMacApp = null
    app.quit()
    return
  }
  autoUpdater.quitAndInstall()
}
