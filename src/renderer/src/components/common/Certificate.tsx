import { ShieldAlert } from 'lucide-react'
import type { CertificateInfo } from '@shared/ipc'

/** Chromium errors that trusting the certificate can resolve. */
export function isCertificateError(message: string | undefined | null): boolean {
  return !!message && /ERR_CERT_|ERR_SSL_PINNED|certificate/i.test(message)
}

/** "sha256/<base64>" → "AB:CD:…", the form browsers and openssl show. */
export function fingerprintHex(fingerprint: string): string {
  const b64 = fingerprint.replace(/^sha256\//, '')
  try {
    return Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()).join(':')
  } catch {
    return fingerprint
  }
}

const REASONS: Record<string, string> = {
  'net::ERR_CERT_AUTHORITY_INVALID':
    'It was issued by a certificate authority your computer does not trust, such as a self-signed or company-internal one.',
  'net::ERR_CERT_COMMON_NAME_INVALID': 'It was issued for a different server name.',
  'net::ERR_CERT_DATE_INVALID': 'It has expired or is not valid yet.'
}

function commonName(dn: string): string {
  return /CN=([^,]+)/.exec(dn)?.[1] ?? dn
}

export function CertificateDetails({ cert }: { cert: CertificateInfo }) {
  const date = (ts: number): string => new Date(ts * 1000).toLocaleDateString([], { dateStyle: 'medium' })
  return (
    <div className="cert-details">
      <div className="cert-warning">
        <ShieldAlert size={20} />
        <div>
          <b>{cert.host} presented a certificate your computer doesn’t trust.</b>
          <p>{REASONS[cert.error] ?? `The connection was refused (${cert.error}).`}</p>
          <p>
            Only trust it if you know your server uses such a certificate, ideally after comparing the
            fingerprint with your administrator. Hubbub will trust exactly this certificate for {cert.host}{' '}
            and ask again if it changes.
          </p>
        </div>
      </div>
      <dl>
        <dt>Issued to</dt>
        <dd>{commonName(cert.subject)}</dd>
        <dt>Issued by</dt>
        <dd>{commonName(cert.issuer)}</dd>
        <dt>Valid</dt>
        <dd>
          {date(cert.validFrom)} – {date(cert.validUntil)}
        </dd>
        <dt>SHA-256 fingerprint</dt>
        <dd className="mono">{fingerprintHex(cert.fingerprint)}</dd>
      </dl>
    </div>
  )
}
