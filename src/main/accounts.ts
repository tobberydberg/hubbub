import { session, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import type { AccountInfo, LoginFlowStart, LoginResult } from '@shared/ipc'
import { withCertificateTrust } from './certificates'
import { ocsRequest, userAgent, type Credentials } from './http'
import { decryptSecret, encryptSecret, readJson, writeJson } from './storage'

interface StoredAccount extends AccountInfo {
  secret: string
  secretEncrypted: boolean
}

interface AccountsFile {
  version: 1
  accounts: StoredAccount[]
}

const FILE = 'accounts.json'
const COLORS = ['#1c58d9', '#3db887', '#e07315', '#9b4dca', '#d24b4e', '#0a8a9c', '#c43e8a', '#6b7b0c']

let accounts: StoredAccount[] = []
const credentialCache = new Map<string, Credentials>()

export function loadAccounts(): void {
  accounts = readJson<AccountsFile>(FILE, { version: 1, accounts: [] }).accounts
}

function save(): void {
  writeJson(FILE, { version: 1, accounts } satisfies AccountsFile)
}

function publicInfo(a: StoredAccount): AccountInfo {
  const { secret: _s, secretEncrypted: _e, ...info } = a
  return info
}

export function listAccounts(): AccountInfo[] {
  return accounts.map(publicInfo)
}

export function getCredentials(id: string): Credentials {
  const cached = credentialCache.get(id)
  if (cached) return cached
  const a = accounts.find((x) => x.id === id)
  if (!a) throw new Error(`Unknown account ${id}`)
  const creds = {
    id: a.id,
    serverUrl: a.serverUrl,
    loginName: a.loginName,
    appPassword: decryptSecret(a.secret, a.secretEncrypted)
  }
  credentialCache.set(id, creds)
  return creds
}

export function getAccount(id: string): AccountInfo | undefined {
  const a = accounts.find((x) => x.id === id)
  return a && publicInfo(a)
}

/** Normalizes user input like "cloud.example.com/" or "https://example.com/nextcloud/index.php" */
export function normalizeServerUrl(input: string): string {
  let s = input.trim()
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  const url = new URL(s)
  let path = url.pathname.replace(/\/index\.php.*$/, '').replace(/\/(apps|login|call)\/.*$/, '')
  path = path.replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${path}`
}

// --- Login Flow v2 -----------------------------------------------------------
// https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2

interface PendingFlow {
  serverUrl: string
  endpoint: string
  token: string
  cancelled: boolean
}

const flows = new Map<string, PendingFlow>()
const loginSession = (): Electron.Session => withCertificateTrust(session.fromPartition('hubbub-login'))

export async function startLogin(serverInput: string): Promise<LoginFlowStart> {
  const serverUrl = normalizeServerUrl(serverInput)
  const res = await loginSession().fetch(`${serverUrl}/index.php/login/v2`, {
    method: 'POST',
    headers: { 'User-Agent': userAgent(), Accept: 'application/json' }
  })
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'This does not look like a Nextcloud server (login flow not found).'
        : `Server responded with HTTP ${res.status}`
    )
  }
  const json = (await res.json()) as { poll: { token: string; endpoint: string }; login: string }
  const flowId = randomBytes(8).toString('hex')
  flows.set(flowId, { serverUrl, endpoint: json.poll.endpoint, token: json.poll.token, cancelled: false })
  await shell.openExternal(json.login)
  return { flowId, loginUrl: json.login }
}

export function cancelLogin(flowId: string): void {
  const flow = flows.get(flowId)
  if (flow) flow.cancelled = true
}

export async function completeLogin(flowId: string, label: string): Promise<LoginResult> {
  const flow = flows.get(flowId)
  if (!flow) return { ok: false, error: 'Login flow not found' }
  const deadline = Date.now() + 20 * 60_000
  try {
    while (!flow.cancelled && Date.now() < deadline) {
      const res = await loginSession()
        .fetch(flow.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent() },
          body: `token=${encodeURIComponent(flow.token)}`
        })
        .catch(() => null)
      if (res?.status === 200) {
        const r = (await res.json()) as { server: string; loginName: string; appPassword: string }
        return await finishLogin(
          normalizeServerUrl(r.server || flow.serverUrl),
          r.loginName,
          r.appPassword,
          label
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    return { ok: false, error: flow.cancelled ? 'cancelled' : 'Login timed out' }
  } finally {
    flows.delete(flowId)
  }
}

export async function addWithAppPassword(
  serverInput: string,
  loginName: string,
  appPassword: string,
  label: string
): Promise<LoginResult> {
  try {
    return await finishLogin(normalizeServerUrl(serverInput), loginName.trim(), appPassword.trim(), label)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function finishLogin(
  serverUrl: string,
  loginName: string,
  appPassword: string,
  label: string
): Promise<LoginResult> {
  const id = randomBytes(6).toString('hex')
  const creds: Credentials = { id, serverUrl, loginName, appPassword }

  const user = await ocsRequest(creds, { accountId: id, method: 'GET', path: '/ocs/v2.php/cloud/user' })
  if (!user.ok) {
    return {
      ok: false,
      error: user.status === 401 ? 'Invalid login name or app password' : user.error || 'Login failed'
    }
  }
  const caps = await ocsRequest(creds, {
    accountId: id,
    method: 'GET',
    path: '/ocs/v2.php/cloud/capabilities'
  })
  const capData = caps.data as {
    capabilities?: { spreed?: unknown; theming?: { color?: string; name?: string } }
  } | null
  if (!capData?.capabilities?.spreed) {
    return { ok: false, error: 'Nextcloud Talk is not enabled on this server.' }
  }

  const u = user.data as { id: string; displayname: string }
  const existing = accounts.find((a) => a.serverUrl === serverUrl && a.userId === u.id)
  if (existing) {
    // Re-login: replace the credentials of the existing account
    const secret = encryptSecret(appPassword)
    Object.assign(existing, { loginName, secret: secret.value, secretEncrypted: secret.encrypted })
    credentialCache.delete(existing.id)
    save()
    return { ok: true, account: publicInfo(existing) }
  }

  const secret = encryptSecret(appPassword)
  const host = new URL(serverUrl).hostname
  const account: StoredAccount = {
    id,
    serverUrl,
    loginName,
    userId: u.id,
    displayName: u.displayname || u.id,
    label: label.trim() || capData.capabilities.theming?.name || host,
    color: capData.capabilities.theming?.color || COLORS[accounts.length % COLORS.length],
    secret: secret.value,
    secretEncrypted: secret.encrypted
  }
  accounts.push(account)
  save()
  return { ok: true, account: publicInfo(account) }
}

export function updateAccount(
  id: string,
  patch: Partial<Pick<AccountInfo, 'label' | 'color'>>
): AccountInfo[] {
  const a = accounts.find((x) => x.id === id)
  if (a) {
    if (typeof patch.label === 'string' && patch.label.trim()) a.label = patch.label.trim()
    if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) a.color = patch.color
    save()
  }
  return listAccounts()
}

export function reorderAccounts(ids: string[]): AccountInfo[] {
  accounts.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
  save()
  return listAccounts()
}

export async function removeAccount(id: string): Promise<AccountInfo[]> {
  try {
    // Revoke the app password on the server; ignore failures (server may be unreachable)
    const creds = getCredentials(id)
    await ocsRequest(creds, {
      accountId: id,
      method: 'DELETE',
      path: '/ocs/v2.php/core/apppassword',
      timeoutMs: 8000
    })
  } catch {
    // ignore
  }
  accounts = accounts.filter((a) => a.id !== id)
  credentialCache.delete(id)
  save()
  return listAccounts()
}
