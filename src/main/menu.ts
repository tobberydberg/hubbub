import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/ipc'
import { checkForUpdates } from './updater'

export const ISSUES_URL = 'https://github.com/tobberydberg/hubbub/issues'

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const send = (cmd: MenuCommand) => (): void => {
    const win = getWindow()
    if (!win) return
    win.show()
    win.webContents.send('menu:command', cmd)
  }
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { label: 'Check for Updates…', click: () => checkForUpdates(true) },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: send({ type: 'open-settings' }) },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Add Server…', accelerator: 'CmdOrCtrl+Shift+N', click: send({ type: 'add-server' }) },
        { label: 'New Conversation…', accelerator: 'CmdOrCtrl+N', click: send({ type: 'new-conversation' }) },
        ...(isMac
          ? []
          : [
              { type: 'separator' as const },
              { label: 'Settings…', accelerator: 'Ctrl+,', click: send({ type: 'open-settings' }) }
            ]),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Find Channel…', accelerator: 'CmdOrCtrl+K', click: send({ type: 'find-channel' }) },
        {
          label: 'Search Messages…',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: send({ type: 'focus-search' })
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'History',
      submenu: [
        {
          label: 'Previous Channel',
          accelerator: 'Alt+Up',
          click: send({ type: 'navigate', direction: 'prev', unreadOnly: false })
        },
        {
          label: 'Next Channel',
          accelerator: 'Alt+Down',
          click: send({ type: 'navigate', direction: 'next', unreadOnly: false })
        },
        {
          label: 'Previous Unread Channel',
          accelerator: 'Alt+Shift+Up',
          click: send({ type: 'navigate', direction: 'prev', unreadOnly: true })
        },
        {
          label: 'Next Unread Channel',
          accelerator: 'Alt+Shift+Down',
          click: send({ type: 'navigate', direction: 'next', unreadOnly: true })
        }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        ...(isMac ? [] : [{ label: 'Check for Updates…', click: () => checkForUpdates(true) }]),
        { label: 'Report an Issue…', click: () => shell.openExternal(ISSUES_URL) }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
