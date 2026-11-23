import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Reads a JSON file from the user data directory, returning `fallback` if missing or corrupt. */
export function readJson<T>(name: string, fallback: T): T {
  const file = join(app.getPath('userData'), name)
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (err) {
    console.error(`Failed to read ${name}:`, err)
    return fallback
  }
}

/** Atomically writes a JSON file to the user data directory. */
export function writeJson(name: string, value: unknown): void {
  const file = join(app.getPath('userData'), name)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
}

/** Encrypts a secret with the OS keychain (macOS Keychain, Windows DPAPI, libsecret/kwallet on Linux). */
export function encryptSecret(plain: string): { value: string; encrypted: boolean } {
  if (safeStorage.isEncryptionAvailable()) {
    return { value: safeStorage.encryptString(plain).toString('base64'), encrypted: true }
  }
  console.warn('OS secret storage unavailable; storing app password unencrypted')
  return { value: Buffer.from(plain, 'utf8').toString('base64'), encrypted: false }
}

export function decryptSecret(value: string, encrypted: boolean): string {
  const buf = Buffer.from(value, 'base64')
  return encrypted ? safeStorage.decryptString(buf) : buf.toString('utf8')
}
