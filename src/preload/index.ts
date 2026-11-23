import { contextBridge, ipcRenderer } from 'electron'
import type { HubbubApi, MenuCommand, UpdateStatus } from '@shared/ipc'

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api: HubbubApi = {
  platform: process.platform,
  accounts: {
    list: () => invoke('accounts:list'),
    startLogin: (serverUrl) => invoke('accounts:startLogin', serverUrl),
    completeLogin: (flowId, label) => invoke('accounts:completeLogin', flowId, label),
    cancelLogin: (flowId) => invoke('accounts:cancelLogin', flowId),
    addWithAppPassword: (url, login, pw, label) =>
      invoke('accounts:addWithAppPassword', url, login, pw, label),
    update: (id, patch) => invoke('accounts:update', id, patch),
    reorder: (ids) => invoke('accounts:reorder', ids),
    remove: (id) => invoke('accounts:remove', id)
  },
  ocs: (req) => invoke('ocs:request', req),
  abortRequest: (requestId) => invoke('ocs:abort', requestId),
  upload: (req) => invoke('dav:upload', req),
  app: {
    version: () => invoke('app:version'),
    openExternal: (url) => invoke('app:openExternal', url),
    focusWindow: () => invoke('app:focusWindow'),
    setBadge: (count, mention) => invoke('app:setBadge', count, mention),
    onMenuCommand: (cb) => {
      const listener = (_: unknown, cmd: MenuCommand): void => cb(cmd)
      ipcRenderer.on('menu:command', listener)
      return () => ipcRenderer.removeListener('menu:command', listener)
    },
    getSettings: () => invoke('app:getSettings'),
    setSettings: (patch) => invoke('app:setSettings', patch)
  },
  certificates: {
    rejected: (url) => invoke('certs:rejected', url),
    trust: (host, fingerprint) => invoke('certs:trust', host, fingerprint),
    list: () => invoke('certs:list'),
    remove: (host) => invoke('certs:remove', host)
  },
  updates: {
    check: () => invoke('updates:check'),
    install: () => invoke('updates:install'),
    onStatus: (cb) => {
      const listener = (_: unknown, s: UpdateStatus): void => cb(s)
      ipcRenderer.on('updates:status', listener)
      return () => ipcRenderer.removeListener('updates:status', listener)
    }
  }
}

contextBridge.exposeInMainWorld('hubbub', api)
