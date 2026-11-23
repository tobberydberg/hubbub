import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DesktopSettings, OcsRequest, UploadRequest, UploadResult } from '@shared/ipc'
import {
  addWithAppPassword,
  cancelLogin,
  completeLogin,
  getAccount,
  getCredentials,
  listAccounts,
  loadAccounts,
  removeAccount,
  reorderAccounts,
  startLogin,
  updateAccount
} from './accounts'
import {
  listTrustedCertificates,
  rejectedCertificate,
  removeTrustedCertificate,
  trustCertificate,
  withCertificateTrust
} from './certificates'
import { installContextMenu } from './context-menu'
import {
  applySettings,
  getSettings,
  keepRunningOnClose,
  launchedAtLogin,
  setSettings,
  setTrayUnread,
  showWindow
} from './desktop'
import { abortRequest, davMkcol, davUpload, ocsRequest } from './http'
import { handleMediaProtocol, registerMediaScheme } from './media'
import { buildMenu } from './menu'
import { readJson, writeJson } from './storage'
import { checkForUpdates, initUpdater, installUpdate } from './updater'

const APP_ID = 'io.github.tobberydberg.hubbub'

// Development aids: a separate profile directory, and automated screenshots (see CONTRIBUTING.md)
if (process.env.HUBBUB_USER_DATA) app.setPath('userData', process.env.HUBBUB_USER_DATA)

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

let mainWindow: BrowserWindow | null = null
let quitting = false

registerMediaScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow(() => mainWindow))
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

function createWindow(): void {
  const state = readJson<WindowState>('window-state.json', { width: 1280, height: 820 })
  const isMac = process.platform === 'darwin'

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'Hubbub',
    backgroundColor: '#1e325c',
    autoHideMenuBar: !isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    icon: isMac ? undefined : join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })

  if (state.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => {
    if (!app.isPackaged && process.env.HUBBUB_SCREENSHOT) {
      // Automated screenshots must not steal focus from whatever the developer is doing
      mainWindow?.showInactive()
      void captureScreenshot(process.env.HUBBUB_SCREENSHOT)
    } else if (!(launchedAtLogin() && keepRunningOnClose())) {
      mainWindow?.show()
    }
  })

  const saveState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const b = mainWindow.getNormalBounds()
    writeJson('window-state.json', { ...b, maximized: mainWindow.isMaximized() } satisfies WindowState)
  }
  mainWindow.on('resized', saveState)
  mainWindow.on('moved', saveState)
  mainWindow.on('maximize', saveState)
  mainWindow.on('unmaximize', saveState)

  mainWindow.on('close', (e) => {
    saveState()
    // macOS convention, and the tray on Windows/Linux: closing the window keeps the app running
    if (!quitting && keepRunningOnClose()) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.on('focus', () => mainWindow?.flashFrame(false))

  installContextMenu(mainWindow, isSafeExternalUrl)

  // Never open new Electron windows; send links to the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    e.preventDefault()
    if (isSafeExternalUrl(url)) shell.openExternal(url)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function captureScreenshot(file: string): Promise<void> {
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  await wait(Number(process.env.HUBBUB_SCREENSHOT_DELAY ?? 4000))
  if (process.env.HUBBUB_SCREENSHOT_JS) {
    await mainWindow?.webContents.executeJavaScript(process.env.HUBBUB_SCREENSHOT_JS)
    await wait(2500)
  }
  const image = await mainWindow?.webContents.capturePage()
  if (image) writeFileSync(file, image.toPNG())
  app.quit()
}

/** Only accept IPC from our own renderer. */
function trusted(event: IpcMainInvokeEvent): boolean {
  return !!mainWindow && event.sender === mainWindow.webContents
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('Untrusted sender')
    return fn(...(args as A))
  })
}

function registerIpc(): void {
  handle('accounts:list', () => listAccounts())
  handle('accounts:startLogin', (serverUrl: string) => startLogin(serverUrl))
  handle('accounts:completeLogin', (flowId: string, label: string) => completeLogin(flowId, label))
  handle('accounts:cancelLogin', (flowId: string) => cancelLogin(flowId))
  handle('accounts:addWithAppPassword', (url: string, login: string, pw: string, label: string) =>
    addWithAppPassword(url, login, pw, label)
  )
  handle('accounts:update', (id: string, patch: { label?: string; color?: string }) =>
    updateAccount(id, patch)
  )
  handle('accounts:reorder', (ids: string[]) => reorderAccounts(ids))
  handle('accounts:remove', (id: string) => removeAccount(id))

  handle('ocs:request', (req: OcsRequest) => ocsRequest(getCredentials(req.accountId), req))
  handle('ocs:abort', (requestId: string) => abortRequest(requestId))

  handle('dav:upload', async (req: UploadRequest): Promise<UploadResult> => {
    const account = getAccount(req.accountId)
    if (!account) return { ok: false, status: 0, path: req.remotePath, error: 'Unknown account' }
    const creds = getCredentials(req.accountId)
    const dir = req.remotePath.split('/').slice(0, -1).join('/')
    const name = req.remotePath.split('/').pop() ?? 'file'
    const dot = name.lastIndexOf('.')
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']

    let createdDir = false
    for (let attempt = 0; attempt < 50; attempt++) {
      const path = `${dir}/${attempt === 0 ? name : `${stem} (${attempt})${ext}`}`
      const res = await davUpload(creds, account.userId, path, req.data, req.contentType)
      if (res.status === 412) continue // name taken, try the next suffix
      if (res.status === 409 && !createdDir) {
        // Parent folder is missing: create it and retry the same name
        createdDir = true
        await davMkcol(creds, account.userId, dir)
        attempt--
        continue
      }
      return { ...res, path }
    }
    return { ok: false, status: 412, path: req.remotePath, error: 'Could not find a free file name' }
  })

  handle('app:version', () => app.getVersion())
  handle('app:openExternal', (url: string) => {
    if (isSafeExternalUrl(url)) return shell.openExternal(url)
  })
  handle('app:focusWindow', () => showWindow(() => mainWindow))
  handle('app:getSettings', () => getSettings())
  handle('app:setSettings', (patch: Partial<DesktopSettings>) => setSettings(patch, () => mainWindow))
  handle('certs:rejected', (url: string) => rejectedCertificate(url))
  handle('certs:trust', (host: string, fingerprint: string) => trustCertificate(host, fingerprint))
  handle('certs:list', () => listTrustedCertificates())
  handle('certs:remove', (host: string) => removeTrustedCertificate(host))
  handle('app:setBadge', (count: number, mention: boolean) => {
    setTrayUnread(count, mention)
    if (process.platform === 'darwin') {
      app.dock?.setBadge(count > 0 ? String(count) : mention ? '•' : '')
    } else if (process.platform === 'linux') {
      app.setBadgeCount(count)
    } else if (count > 0 && mainWindow && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true)
    }
  })

  handle('updates:check', () => checkForUpdates())
  handle('updates:install', () => installUpdate())
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
  withCertificateTrust(session.defaultSession)
  loadAccounts()
  handleMediaProtocol()
  registerIpc()
  buildMenu(() => mainWindow)
  createWindow()
  applySettings(() => mainWindow)
  initUpdater(() => mainWindow)

  app.on('activate', () => {
    if (mainWindow) mainWindow.show()
    else createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
