import { useEffect, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { CertificateInfo } from '@shared/ipc'
import { setApp } from '@renderer/store/app'
import { accountAdded } from '@renderer/sync/actions'
import { CertificateDetails, isCertificateError } from '../common/Certificate'
import { Modal } from '../common/Modal'

type Step = 'form' | 'waiting' | 'manual'

const cleanError = (err: unknown): string =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(err)

/** Adds a server, or signs in again to one whose app password was revoked (`serverUrl` given). */
export function AddServerModal({ onClose, serverUrl }: { onClose: () => void; serverUrl?: string }) {
  const reauth = !!serverUrl
  const [step, setStep] = useState<Step>('form')
  const [url, setUrl] = useState(serverUrl ?? '')
  const [cert, setCert] = useState<CertificateInfo | null>(null)
  const [label, setLabel] = useState('')
  const [loginName, setLoginName] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const flow = useRef<{ id: string; loginUrl: string } | null>(null)

  // Cancel a pending browser login if the dialog is closed
  useEffect(
    () => () => {
      if (flow.current) void window.hubbub.accounts.cancelLogin(flow.current.id)
    },
    []
  )

  // A self-signed or internal-CA certificate shows up as a network error; offer to trust it
  const showError = async (message: string): Promise<void> => {
    const rejected = isCertificateError(message) ? await window.hubbub.certificates.rejected(url) : null
    setCert(rejected)
    setError(rejected ? null : message)
  }

  const trustAndRetry = async (): Promise<void> => {
    if (!cert) return
    await window.hubbub.certificates.trust(cert.host, cert.fingerprint)
    setCert(null)
    await (step === 'manual' ? connectManual() : connect())
  }

  const connect = async (): Promise<void> => {
    setError(null)
    if (!url.trim()) return setError('Please enter the address of your Nextcloud server.')
    setBusy(true)
    try {
      const start = await window.hubbub.accounts.startLogin(url)
      flow.current = { id: start.flowId, loginUrl: start.loginUrl }
      setStep('waiting')
      const result = await window.hubbub.accounts.completeLogin(start.flowId, label)
      flow.current = null
      if (result.ok) {
        accountAdded(result.account)
        setApp({ modal: null })
      } else if (result.error !== 'cancelled') {
        setError(result.error)
        setStep('form')
      }
    } catch (err) {
      await showError(cleanError(err))
      setStep('form')
    } finally {
      setBusy(false)
    }
  }

  const connectManual = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const result = await window.hubbub.accounts.addWithAppPassword(url, loginName, appPassword, label)
      if (result.ok) {
        accountAdded(result.account)
        setApp({ modal: null })
      } else {
        await showError(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const cancelWaiting = (): void => {
    if (flow.current) void window.hubbub.accounts.cancelLogin(flow.current.id)
    flow.current = null
    setStep('form')
  }

  if (step === 'waiting') {
    return (
      <Modal title="Sign in to Nextcloud" onClose={onClose} size="small">
        <div className="waiting">
          <div className="spinner" />
          <div>
            <b>Complete the login in your browser.</b>
            <p style={{ marginTop: 8 }}>
              Hubbub opened your Nextcloud login page. After you grant access, you will be signed in here
              automatically.
            </p>
          </div>
          <button
            className="btn-link"
            onClick={() => flow.current && void window.hubbub.app.openExternal(flow.current.loginUrl)}
          >
            <ExternalLink size={14} /> Open the login page again
          </button>
        </div>
        <div className="modal-footer" style={{ padding: '8px 0 0' }}>
          <button className="btn btn-tertiary" onClick={cancelWaiting}>
            Cancel
          </button>
        </div>
      </Modal>
    )
  }

  const manual = step === 'manual'
  return (
    <Modal
      title={reauth ? 'Sign in again' : 'Add Server'}
      onClose={onClose}
      size="small"
      footer={
        <>
          <button className="btn btn-tertiary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !url.trim() || (manual && (!loginName.trim() || !appPassword.trim()))}
            onClick={() => void (manual ? connectManual() : connect())}
          >
            {busy ? 'Connecting…' : manual ? 'Sign in' : 'Connect'}
          </button>
        </>
      }
    >
      <p>
        {reauth
          ? 'Your app password for this server was revoked or has expired. Sign in again to reconnect; your settings and categories are kept.'
          : 'Connect Hubbub to a Nextcloud server with Talk. You can add as many servers as you like.'}
      </p>
      {error && <div className="error-box">{error}</div>}
      {cert && (
        <div className="field">
          <CertificateDetails cert={cert} />
          <button className="btn btn-danger" style={{ marginTop: 12 }} onClick={() => void trustAndRetry()}>
            Trust this certificate and continue
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void (manual ? connectManual() : connect())
        }}
      >
        <div className="field">
          <label htmlFor="server-url">Server URL</label>
          <input
            id="server-url"
            className="input"
            placeholder="https://cloud.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            readOnly={reauth}
            autoFocus={!reauth}
          />
          <div className="help">The address you use to open Nextcloud in your browser.</div>
        </div>
        {!reauth && (
          <div className="field">
            <label htmlFor="server-label">Server display name (optional)</label>
            <input
              id="server-label"
              className="input"
              placeholder="e.g. Work"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        )}
        {manual && (
          <>
            <div className="field">
              <label htmlFor="login">Login name</label>
              <input
                id="login"
                className="input"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="apppw">App password</label>
              <input
                id="apppw"
                className="input"
                type="password"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
              />
              <div className="help">
                Create one in Nextcloud under Personal settings → Security → Devices &amp; sessions.
              </div>
            </div>
          </>
        )}
        <button type="submit" hidden />
      </form>
      <button className="btn-link" onClick={() => setStep(manual ? 'form' : 'manual')}>
        {manual ? 'Sign in with the browser instead' : 'Sign in with an app password instead'}
      </button>
    </Modal>
  )
}
