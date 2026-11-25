import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { setApp, useApp } from '@renderer/store/app'
import { clearOwnAbsence, loadOwnAbsence, saveOwnAbsence } from '@renderer/sync/absence'
import { usePeopleSearch } from '@renderer/sync/people'
import { Avatar } from '../common/Avatar'
import { Modal } from '../common/Modal'

// Your out-of-office, as in Nextcloud's personal settings (Availability): the days you're away, a
// short message shown like a status, a longer one for people who write to you, and who to contact
// instead. Nextcloud shows it to others in Talk and sets your status while you're away.

const close = (): void => setApp({ modal: null })

const day = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function OutOfOfficeModal({ accountId }: { accountId: string }) {
  const own = useApp((s) => s.accounts[accountId]?.ownAbsence)
  const selfId = useApp((s) => s.accounts[accountId]?.info.userId)
  const [loaded, setLoaded] = useState(own !== undefined)
  const [firstDay, setFirstDay] = useState(own?.firstDay ?? day(new Date()))
  const [lastDay, setLastDay] = useState(own?.lastDay ?? day(new Date(Date.now() + 7 * 86_400_000)))
  const [status, setStatus] = useState(own?.status ?? '')
  const [message, setMessage] = useState(own?.message ?? '')
  const [replacement, setReplacement] = useState<{ id: string; name: string } | null>(
    own?.replacementUserId
      ? { id: own.replacementUserId, name: own.replacementUserDisplayName ?? own.replacementUserId }
      : null
  )
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const { people } = usePeopleSearch(accountId, query)

  // Fill in what is set on the server once it's known
  useEffect(() => {
    if (loaded) return
    void loadOwnAbsence(accountId).then(() => {
      const a = useApp.getState().accounts[accountId]?.ownAbsence
      if (a) {
        setFirstDay(a.firstDay)
        setLastDay(a.lastDay)
        setStatus(a.status)
        setMessage(a.message)
        if (a.replacementUserId) {
          setReplacement({
            id: a.replacementUserId,
            name: a.replacementUserDisplayName ?? a.replacementUserId
          })
        }
      }
      setLoaded(true)
    })
  }, [accountId, loaded])

  const valid = !!firstDay && !!lastDay && firstDay <= lastDay && !!status.trim() && !!message.trim()
  const matches = query.trim() ? people.filter((p) => p.id !== selfId).slice(0, 5) : []

  const save = async (): Promise<void> => {
    if (!valid || saving) return
    setSaving(true)
    const ok = await saveOwnAbsence(accountId, {
      firstDay,
      lastDay,
      status: status.trim(),
      message: message.trim(),
      replacementUserId: replacement?.id ?? null,
      replacementUserDisplayName: replacement?.name ?? null
    })
    setSaving(false)
    if (ok) close()
  }

  return (
    <Modal
      title="Out of office"
      onClose={close}
      footer={
        <>
          {own && (
            <button
              className="btn btn-tertiary status-clear-btn"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                const ok = await clearOwnAbsence(accountId)
                setSaving(false)
                if (ok) close()
              }}
            >
              Turn off
            </button>
          )}
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid || saving || !loaded}
            onClick={() => void save()}
          >
            Save
          </button>
        </>
      }
    >
      <p className="help ooo-intro">
        While you’re away, Nextcloud shows your message to people who write to you in Talk and sets your
        status.
      </p>
      <div className="ooo-days">
        <label>
          <span className="field-label">First day</span>
          <input
            className="input"
            type="date"
            value={firstDay}
            onChange={(e) => {
              setFirstDay(e.target.value)
              if (lastDay < e.target.value) setLastDay(e.target.value)
            }}
          />
        </label>
        <label>
          <span className="field-label">Last day</span>
          <input
            className="input"
            type="date"
            value={lastDay}
            min={firstDay}
            onChange={(e) => setLastDay(e.target.value)}
          />
        </label>
      </div>

      <label className="field-label">Short message</label>
      <input
        className="input"
        placeholder="For example: On vacation"
        maxLength={100}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      />

      <label className="field-label">Message</label>
      <textarea
        className="input"
        rows={4}
        placeholder="For example: I’m away until 3 December. For anything urgent, contact Carol."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />

      <label className="field-label">Contact instead (optional)</label>
      {replacement ? (
        <div className="ooo-replacement">
          <Avatar accountId={accountId} userId={replacement.id} name={replacement.name} size={24} />
          <span>{replacement.name}</span>
          <button className="icon-btn small" title="Remove" onClick={() => setReplacement(null)}>
            <X size={15} />
          </button>
        </div>
      ) : (
        <div className="guest-picker">
          <input
            className="input"
            placeholder="Search for a colleague"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {matches.length > 0 && (
            <div className="guest-results">
              {matches.map((p) => (
                <button
                  key={p.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setReplacement({ id: p.id, name: p.name })
                    setQuery('')
                  }}
                >
                  <Avatar accountId={accountId} userId={p.id} name={p.name} size={24} />
                  <span>{p.name}</span>
                  {p.subline && <span className="sub">{p.subline}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
