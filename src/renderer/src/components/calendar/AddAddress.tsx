import { useState } from 'react'
import { useApp } from '@renderer/store/app'
import { addMyAddress } from '@renderer/sync/calendar'

// Adding an email address to your Nextcloud account. Nextcloud wants your password confirmed for it
// (an app password doesn't count): it's asked here and used for this one request, not kept. With
// single sign-on or two-factor login that can't work, so Nextcloud's own settings are offered too.

export function AddAddress({
  accountId,
  email,
  label = 'Add to my addresses',
  onDone
}: {
  accountId: string
  email: string
  label?: string
  onDone?: () => void
}) {
  const serverUrl = useApp((s) => s.accounts[accountId]?.info.serverUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [askPassword, setAskPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = async (pw?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await addMyAddress(accountId, email, pw).catch((err: unknown) => ({
      ok: false,
      needsPassword: false,
      error: err instanceof Error ? err.message : String(err)
    }))
    setBusy(false)
    if (res.ok) {
      setAskPassword(false)
      setPassword('')
      onDone?.()
    } else if (res.needsPassword && !pw) {
      setAskPassword(true)
    } else {
      setError(res.error ?? 'That didn’t work')
    }
  }

  const settings = (
    <button
      className="link-btn"
      onClick={() =>
        void window.hubbub.app.openExternal(`${serverUrl.replace(/\/+$/, '')}/index.php/settings/user`)
      }
    >
      add it in your Nextcloud personal settings
    </button>
  )

  if (!askPassword) {
    return (
      <span className="add-address">
        <button className="ev-btn light" disabled={busy || !email} onClick={() => void add()}>
          {busy ? 'Adding…' : label}
        </button>
        {error && (
          <span className="add-address-error">
            {error}. You can also {settings}.
          </span>
        )}
      </span>
    )
  }
  return (
    <span className="add-address asking">
      <span className="add-address-note">Nextcloud wants your password to change your email addresses:</span>
      <span className="add-address-row">
        <input
          className="input"
          type="password"
          autoFocus
          placeholder="Your Nextcloud password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && password && void add(password)}
        />
        <button className="ev-btn" disabled={busy || !password} onClick={() => void add(password)}>
          Confirm
        </button>
      </span>
      {error && <span className="add-address-error">{error}.</span>}
      <span className="add-address-note">
        Used once and not kept. Signing in with single sign-on or two-factor? Then {settings} (Personal info →
        Email); Hubbub picks it up when you come back.
      </span>
    </span>
  )
}
