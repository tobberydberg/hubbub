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
  /** downloadUrl is set when the update must be downloaded by hand (unsigned macOS builds) */
  | { state: 'available'; version: string; downloadUrl?: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
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
  }
  ocs<T = unknown>(req: OcsRequest): Promise<OcsResponse<T>>
  abortRequest(requestId: string): Promise<void>
  /** Uploads without overwriting: on a name clash a suffix like " (1)" is added. Returns the final path. */
  upload(req: UploadRequest): Promise<UploadResult>
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
    `hubbub-media://${accountId}/preview/${encodeURIComponent(fileId)}?size=${size}`
}
