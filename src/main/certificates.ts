import type { Session } from 'electron'
import type { CertificateInfo, TrustedCertificate } from '@shared/ipc'
import { readJson, writeJson } from './storage'

// Private Nextcloud servers often use a self-signed certificate or one from an internal CA that the
// operating system doesn't know. Chromium rejects those; the user can choose to trust exactly that
// certificate (pinned by fingerprint) for that host. When it changes, they are asked again.

const FILE = 'trusted-certificates.json'

let trusted: TrustedCertificate[] | null = null
/** The last certificate Chromium rejected, per host, so the UI can show what it would be trusting */
const rejected = new Map<string, CertificateInfo>()
const installed = new Set<Session>()

function load(): TrustedCertificate[] {
  trusted ??= readJson<{ certificates: TrustedCertificate[] }>(FILE, { certificates: [] }).certificates
  return trusted
}

function save(): void {
  writeJson(FILE, { certificates: load() })
}

/** Makes a session accept certificates the user has trusted. Safe to call repeatedly. */
export function withCertificateTrust(s: Session): Session {
  if (installed.has(s)) return s
  installed.add(s)
  install(s)
  return s
}

function install(s: Session): void {
  s.setCertificateVerifyProc((req, callback) => {
    // -3: use Chromium's own verdict
    if (req.errorCode === 0) return callback(-3)
    const cert = req.certificate
    const pinned = load().find((t) => t.host === req.hostname)
    if (pinned && pinned.fingerprint === cert.fingerprint) return callback(0)
    rejected.set(req.hostname, {
      host: req.hostname,
      error: req.verificationResult,
      subject: cert.subjectName,
      issuer: cert.issuerName,
      validFrom: cert.validStart,
      validUntil: cert.validExpiry,
      fingerprint: cert.fingerprint
    })
    callback(-3)
  })
}

/** Installing the procedure again resets Chromium's cached verdicts, so a new choice applies at once. */
function reinstall(): void {
  for (const s of installed) {
    install(s)
    void s.closeAllConnections()
  }
}

export function rejectedCertificate(url: string): CertificateInfo | null {
  try {
    return rejected.get(new URL(url).hostname) ?? null
  } catch {
    return null
  }
}

/** Only a certificate that was actually presented and rejected can be trusted. */
export function trustCertificate(host: string, fingerprint: string): void {
  const seen = rejected.get(host)
  if (!seen || seen.fingerprint !== fingerprint)
    throw new Error('This certificate was not offered by the server')
  trusted = [
    ...load().filter((t) => t.host !== host),
    { host, fingerprint, subject: seen.subject, trustedAt: Math.floor(Date.now() / 1000) }
  ]
  rejected.delete(host)
  save()
  reinstall()
}

export function listTrustedCertificates(): TrustedCertificate[] {
  return load()
}

export function removeTrustedCertificate(host: string): TrustedCertificate[] {
  trusted = load().filter((t) => t.host !== host)
  save()
  reinstall()
  return trusted
}
