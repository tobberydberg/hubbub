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
  calendars: (accountId) => invoke('dav:calendars', accountId),
  folder: (accountId, path) => invoke('dav:folder', accountId, path),
  imap: {
    get: (accountId) => invoke('imap:get', accountId),
    set: (accountId, settings, password) => invoke('imap:set', accountId, settings, password),
    remove: (accountId) => invoke('imap:remove', accountId),
    test: (accountId, settings, password) => invoke('imap:test', accountId, settings, password),
    invitations: (accountId, opts) => invoke('imap:invitations', accountId, opts)
  },
  addressBooks: (accountId) => invoke('dav:addressbooks', accountId),
  contacts: (accountId, href) => invoke('dav:contacts', accountId, href),
  calendarEvents: (accountId, href, start, end, unanswered) =>
    invoke('dav:events', accountId, href, start, end, unanswered),
  calendarFindByUid: (accountId, calendarHref, uid) => invoke('dav:findByUid', accountId, calendarHref, uid),
  calendarObject: (accountId, req) => invoke('dav:object', accountId, req),
  calendarAddresses: (accountId, userId) => invoke('dav:addresses', accountId, userId),
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
  calls: {
    mediaAccess: (kind) => invoke('calls:mediaAccess', kind),
    setActive: (active) => invoke('calls:setActive', active),
    onHangup: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on('calls:hangup', listener)
      return () => ipcRenderer.removeListener('calls:hangup', listener)
    },
    screenSources: () => invoke('calls:screenSources'),
    chooseScreen: (id) => invoke('calls:chooseScreen', id),
    screenAccess: () => invoke('calls:screenAccess'),
    openScreenSettings: () => invoke('calls:openScreenSettings')
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
