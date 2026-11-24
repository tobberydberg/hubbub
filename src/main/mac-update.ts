import { app, net } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

// Updates for macOS builds without a Developer ID. macOS's own update mechanism (Squirrel.Mac) only
// accepts apps signed with one, so Hubbub replaces its app bundle itself: it downloads the release's
// zip, checks it against the checksum in the release's update manifest, checks that it is a validly
// signed Hubbub app (signed with the same certificate as the running one, when that has one), and
// swaps it in once Hubbub has quit.

const exec = promisify(execFile)
const BUNDLE_ID = 'io.github.tobberydberg.hubbub'

export interface UpdateFile {
  url: string
  sha512: string
  size?: number
}

/** The running Hubbub.app */
export function currentBundle(): string {
  return resolve(process.execPath, '../../..')
}

/**
 * The running app's designated requirement when it is signed with a certificate, e.g.
 * `identifier "io.github.tobberydberg.hubbub" and certificate root = H"…"`; null when signed ad hoc.
 */
async function certificateRequirement(): Promise<string | null> {
  try {
    const { stdout, stderr } = await exec('codesign', ['-d', '-r-', currentBundle()])
    const requirement = /designated => (.+)/.exec(`${stdout}\n${stderr}`)?.[1]?.trim()
    return requirement && /\bcertificate\b/.test(requirement) ? requirement : null
  } catch {
    return null
  }
}

/** Why this copy of Hubbub can't replace itself, or null if it can. */
export function selfUpdateBlocked(): string | null {
  const bundle = currentBundle()
  // macOS runs apps opened straight from Downloads (or a disk image) from a hidden read-only copy
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) {
    return 'Move Hubbub to your Applications folder to get updates automatically'
  }
  try {
    accessSync(dirname(bundle), constants.W_OK)
    accessSync(bundle, constants.W_OK)
  } catch {
    return `Hubbub can’t update itself in ${dirname(bundle)}`
  }
  return null
}

/** Where the release's files are: the GitHub release, or the server in app-update.yml for test builds. */
export function releaseBaseUrl(version: string, githubReleases: string): string {
  try {
    const config = readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const url = /^url:\s*(\S+)/m.exec(config)?.[1]
    if (/^provider:\s*generic/m.test(config) && url) return url.endsWith('/') ? url : `${url}/`
  } catch {
    // No update configuration: use GitHub
  }
  return `${githubReleases}/download/v${version}/`
}

/** Downloads and checks the update; resolves with the path of the new Hubbub.app. */
export async function downloadMacUpdate(
  files: UpdateFile[],
  baseUrl: string,
  onProgress: (fraction: number) => void
): Promise<string> {
  const arm = process.arch === 'arm64'
  const file = files.find((f) => f.url.endsWith('.zip') && f.url.includes('arm64') === arm)
  if (!file) throw new Error('This release has no download for your Mac')

  const dir = mkdtempSync(join(tmpdir(), 'hubbub-update-'))
  try {
    const zip = join(dir, 'update.zip')
    const res = await net.fetch(new URL(file.url, baseUrl).toString())
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`)
    const total = Number(res.headers.get('content-length')) || file.size || 0
    const hash = createHash('sha512')
    const out = createWriteStream(zip)
    let received = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()))
      received += chunk.length
      if (total) onProgress(received / total)
    }
    await new Promise<void>((r, reject) => out.end((err?: Error | null) => (err ? reject(err) : r())))
    if (hash.digest('base64') !== file.sha512) throw new Error('The download is damaged (checksum mismatch)')

    await exec('ditto', ['-x', '-k', zip, dir])
    rmSync(zip)
    const appPath = join(dir, basename(currentBundle()))
    await exec('codesign', ['--verify', '--deep', '--strict', appPath])
    // Signed with our certificate: updates must be too, so only that certificate's owner can make one
    const requirement = await certificateRequirement()
    if (requirement) {
      await exec('codesign', ['--verify', '--deep', '--strict', '-R', `=${requirement}`, appPath]).catch(
        () => {
          throw new Error('The download is not signed by Hubbub')
        }
      )
    }
    const { stdout } = await exec('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleIdentifier',
      join(appPath, 'Contents/Info.plist')
    ])
    if (stdout.trim() !== BUNDLE_ID) throw new Error('The download is not Hubbub')
    return appPath
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * Swaps the new app in once this process has exited, keeping the old one if that fails, and
 * optionally starts the new version. Call right before quitting.
 */
export function installMacUpdate(newApp: string, relaunch: boolean): void {
  const target = currentBundle()
  const old = `${target}.old`
  const script = [
    `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
    `rm -rf ${quote(old)}`,
    `mv ${quote(target)} ${quote(old)} || exit 1`,
    `if mv ${quote(newApp)} ${quote(target)}; then rm -rf ${quote(old)}; else mv ${quote(old)} ${quote(target)}; fi`,
    `rm -rf ${quote(dirname(newApp))}`,
    relaunch ? `open ${quote(target)}` : ''
  ].join('\n')
  spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref()
}

/** Leftovers of an interrupted update next to the app */
export function cleanUpAfterUpdate(): void {
  if (process.platform === 'darwin' && app.isPackaged) {
    rmSync(`${currentBundle()}.old`, { recursive: true, force: true })
  }
}
