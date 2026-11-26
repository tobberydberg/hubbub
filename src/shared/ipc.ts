// Contract between the renderer and the main process.
// Credentials never leave the main process: the renderer asks main to perform
// requests on behalf of an account, identified by its id.

export interface AccountInfo {
  id: string
  serverUrl: string
  loginName: string
  userId: string
  displayName: string
  /** Short label shown in the server rail, e.g. "Work" */
  label: string
  /** Accent color for the server icon */
  color: string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type QueryValue = string | number | boolean | undefined | null | Array<string | number>

export interface OcsRequest {
  accountId: string
  method: HttpMethod
  /** Path relative to the server root, e.g. /ocs/v2.php/apps/spreed/api/v4/room */
  path: string
  query?: Record<string, QueryValue>
  body?: Record<string, unknown>
  timeoutMs?: number
  /** Pass to allow cancelling a long-running request via abortRequest */
  requestId?: string
  /** ETag of the last response: the server answers 304 when nothing changed */
  ifNoneMatch?: string
}

export interface OcsResponse<T = unknown> {
  ok: boolean
  status: number
  data: T | null
  headers: Record<string, string>
  error?: string
}

export interface LoginFlowStart {
  flowId: string
  loginUrl: string
}

export type LoginResult = { ok: true; account: AccountInfo } | { ok: false; error: string }

export interface UploadRequest {
  accountId: string
  /** Path inside the user's files, e.g. /Talk/image.png */
  remotePath: string
  data: ArrayBuffer
  contentType?: string
}

export interface UploadResult {
  ok: boolean
  status: number
  path: string
  error?: string
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  /** downloadUrl is set when the update must be downloaded by hand; note says why */
  | { state: 'available'; version: string; downloadUrl?: string; note?: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string; note?: string }
  | { state: 'error'; message: string }
  | { state: 'unsupported'; reason: string }

export type MenuCommand =
  | { type: 'open-settings' }
  | { type: 'add-server' }
  | { type: 'find-channel' }
  | { type: 'switch-server'; index: number }
  | { type: 'navigate'; direction: 'prev' | 'next'; unreadOnly: boolean }
  | { type: 'focus-search' }
  | { type: 'new-conversation' }

/** A screen or window that can be shared in a call */
export interface ScreenSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** data: URL */
  thumbnail: string
  icon?: string
}

/** Settings that live in the main process because they matter before or without the window. */
export interface DesktopSettings {
  /** Keep running in the tray/menu bar when the window is closed (Windows and Linux) */
  runInBackground: boolean
  /** Start Hubbub when you log in to your computer */
  openAtLogin: boolean
  spellcheck: boolean
}

/** A server certificate the system does not trust (self-signed or from an internal CA). */
export interface CertificateInfo {
  host: string
  /** Chromium's verification error, e.g. net::ERR_CERT_AUTHORITY_INVALID */
  error: string
  subject: string
  issuer: string
  validFrom: number
  validUntil: number
  /** "sha256/<base64>" as reported by Chromium */
  fingerprint: string
}

export interface TrustedCertificate {
  host: string
  fingerprint: string
  subject: string
  trustedAt: number
}

/** A mail server to read meeting invitations from */
export interface ImapSettings {
  host: string
  port: number
  /** tls: encrypted from the start (993), starttls: upgraded (143), none: unencrypted */
  security: 'tls' | 'starttls' | 'none'
  username: string
  /** The folder to look in, usually INBOX */
  folder: string
}

export interface ImapConfig extends ImapSettings {
  hasPassword: boolean
}

export interface ImapTestResult {
  ok: boolean
  error?: string
  /** The server's folders, when signing in worked */
  folders?: string[]
}

/** A message with calendar parts; id is "uidvalidity:uid", stable for the folder */
export interface ImapInvitation {
  id: string
  subject?: string
  /** ms */
  date?: number
  /** Who it was sent to (To and Cc) */
  to?: string[]
  parts: { method: string; ics: string }[]
}

export interface HubbubApi {
  platform: NodeJS.Platform
  accounts: {
    list(): Promise<AccountInfo[]>
    startLogin(serverUrl: string): Promise<LoginFlowStart>
    completeLogin(flowId: string, label: string): Promise<LoginResult>
    cancelLogin(flowId: string): Promise<void>
    addWithAppPassword(
      serverUrl: string,
      loginName: string,
      appPassword: string,
      label: string
    ): Promise<LoginResult>
    update(id: string, patch: Partial<Pick<AccountInfo, 'label' | 'color'>>): Promise<AccountInfo[]>
    reorder(ids: string[]): Promise<AccountInfo[]>
    remove(id: string): Promise<AccountInfo[]>
    /**
     * Adds an email address to the account. Nextcloud may want the password confirmed: then
     * needsPassword is set, and the call can be repeated with the login password (used once, not kept).
     */
    addEmail(
      id: string,
      email: string,
      password?: string
    ): Promise<{ ok: boolean; needsPassword: boolean; error?: string }>
  }
  ocs<T = unknown>(req: OcsRequest): Promise<OcsResponse<T>>
  abortRequest(requestId: string): Promise<void>
  /** Uploads without overwriting: on a name clash a suffix like " (1)" is added. Returns the final path. */
  upload(req: UploadRequest): Promise<UploadResult>
  /** The user's calendars, as the raw CalDAV response */
  calendars(accountId: string): Promise<string>
  /** Saves a whole calendar as an .ics file where the user chooses; the path, or null when cancelled */
  exportCalendar(accountId: string, href: string, name: string): Promise<string | null>
  /** Lets the user pick an .ics file and reads it; null when cancelled */
  openIcsFile(): Promise<{ name: string; text: string } | null>
  /** A folder of the user's files (e.g. "/Documents"), as the raw WebDAV response */
  folder(accountId: string, path: string): Promise<string>
  /** Reading invitations from a mail server (per Hubbub server account); the password stays in main */
  imap: {
    get(accountId: string): Promise<ImapConfig | null>
    /** password undefined keeps the stored one */
    set(accountId: string, settings: ImapSettings, password?: string): Promise<void>
    remove(accountId: string): Promise<void>
    test(accountId: string, settings: ImapSettings, password?: string): Promise<ImapTestResult>
    invitations(accountId: string, opts: { sinceDays: number; skip: string[] }): Promise<ImapInvitation[]>
  }
  /** The user's address books, as the raw CardDAV response */
  addressBooks(accountId: string): Promise<string>
  /** The contacts of one address book (its path from addressBooks), as the raw CardDAV response */
  contacts(accountId: string, href: string): Promise<string>
  /** Events of one calendar between two UTC times (yyyymmddThhmmssZ), repeats expanded; raw CalDAV */
  calendarEvents(
    accountId: string,
    href: string,
    start: string,
    end: string,
    unanswered?: boolean
  ): Promise<string>
  /** The event with this UID in one of the user's calendars (path and ETag), or null */
  calendarFindByUid(
    accountId: string,
    calendarHref: string,
    uid: string
  ): Promise<{ href: string; etag: string | null } | null>
  /**
   * Reads, writes, deletes or moves (to the calendar `destination`) one event in the user's
   * calendars, ETag-checked; see main/http.ts
   */
  calendarObject(
    accountId: string,
    req: {
      method: 'GET' | 'PUT' | 'DELETE' | 'MOVE'
      href: string
      body?: string
      etag?: string | null
      destination?: string
    }
  ): Promise<{ status: number; body: string; etag: string | null }>
  /** Another user's calendar addresses (mailto:…), for invitations */
  calendarAddresses(accountId: string, userId: string): Promise<string[]>
  app: {
    version(): Promise<string>
    openExternal(url: string): Promise<void>
    focusWindow(): Promise<void>
    setBadge(count: number, mention: boolean): Promise<void>
    onMenuCommand(cb: (cmd: MenuCommand) => void): () => void
    getSettings(): Promise<DesktopSettings>
    setSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>
  }
  certificates: {
    /** The certificate last rejected for the host of `url`, if any */
    rejected(url: string): Promise<CertificateInfo | null>
    /** Trust exactly this certificate (by fingerprint) for its host */
    trust(host: string, fingerprint: string): Promise<void>
    list(): Promise<TrustedCertificate[]>
    remove(host: string): Promise<TrustedCertificate[]>
  }
  calls: {
    /** Asks the operating system for microphone or camera access (macOS); true if granted */
    mediaAccess(kind: 'microphone' | 'camera'): Promise<boolean>
    /** Keeps the computer awake during a call, and makes quitting wait for the hang-up */
    setActive(active: boolean): Promise<void>
    /** The app is quitting: leave the call */
    onHangup(cb: () => void): () => void
    screenSources(): Promise<ScreenSource[]>
    /** The source the next getDisplayMedia() call gets */
    chooseScreen(id: string | null): Promise<void>
    screenAccess(): Promise<'granted' | 'denied' | 'unknown'>
    openScreenSettings(): Promise<void>
  }
  updates: {
    check(): Promise<void>
    install(): Promise<void>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }
}

/** Builds URLs for the hubbub-media:// protocol, which serves authenticated images. */
export const media = {
  userAvatar: (accountId: string, userId: string, size = 64): string =>
    `hubbub-media://${accountId}/avatar/user/${encodeURIComponent(userId)}/${size}`,
  roomAvatar: (accountId: string, token: string, version = '', dark = false): string =>
    `hubbub-media://${accountId}/avatar/room/${token}?v=${encodeURIComponent(version)}${dark ? '&dark=1' : ''}`,
  preview: (accountId: string, fileId: string, size = 600): string =>
    `hubbub-media://${accountId}/preview/${encodeURIComponent(fileId)}?size=${size}`,
  /** A link preview's image, which Nextcloud serves for the page it previewed */
  referencePreview: (accountId: string, id: string): string =>
    `hubbub-media://${accountId}/reference/${encodeURIComponent(id)}`
}
