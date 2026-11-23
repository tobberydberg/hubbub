import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { UpdateStatus } from '@shared/ipc'

const { autoUpdater } = electronUpdater
const RELEASES_URL = 'https://github.com/tobberydberg/hubbub/releases'

let getWindow: () => BrowserWindow | null = () => null
let lastStatus: UpdateStatus = { state: 'idle' }

function send(status: UpdateStatus): void {
  lastStatus = status
  getWindow()?.webContents.send('updates:status', status)
}

function unsupportedReason(): string | null {
  if (!app.isPackaged) return 'Updates are disabled in development builds'
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    return 'Update via your package manager or download the latest release from GitHub'
  }
  return null
}

/**
 * macOS only installs updates for apps signed with a Developer ID. Unsigned builds still check for
 * updates, but link to the release page instead of downloading.
 */
function canInstallUpdates(): boolean {
  if (process.platform !== 'darwin') return true
  const bundle = resolve(process.execPath, '../../..')
  const res = spawnSync('codesign', ['-dv', '--verbose=2', bundle], { encoding: 'utf8', timeout: 5000 })
  return /Authority=Developer ID Application/.test(res.stderr ?? '')
}

export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  const reason = unsupportedReason()
  if (reason) {
    lastStatus = { state: 'unsupported', reason }
    return
  }

  const install = canInstallUpdates()
  autoUpdater.autoDownload = install
  autoUpdater.autoInstallOnAppQuit = install
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    send({
      state: 'available',
      version: info.version,
      downloadUrl: install ? undefined : `${RELEASES_URL}/tag/v${info.version}`
    })
  )
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }))
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => send({ state: 'error', message: err?.message ?? String(err) }))

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err) => send({ state: 'error', message: String(err) }))
  }
  setTimeout(check, 15_000)
  setInterval(check, 6 * 60 * 60_000)
}

export function checkForUpdates(): void {
  if (lastStatus.state === 'unsupported') {
    send(lastStatus)
    return
  }
  autoUpdater.checkForUpdates().catch((err) => send({ state: 'error', message: String(err) }))
}

export function installUpdate(): void {
  if (lastStatus.state === 'downloaded') autoUpdater.quitAndInstall()
}
