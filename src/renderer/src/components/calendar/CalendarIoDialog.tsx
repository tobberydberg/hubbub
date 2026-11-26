import { useMemo, useState } from 'react'
import { Download, FileUp, Upload } from 'lucide-react'
import { splitIcs, type ImportItem } from '@renderer/lib/ics-import'
import { formatDate } from '@renderer/lib/calendar-time'
import { setApp } from '@renderer/store/app'
import { useCalendar } from '@renderer/store/calendar'
import { usePrefs } from '@renderer/store/prefs'
import { exportCalendar, importEvents, type ImportResult } from '@renderer/sync/calendar-io'
import { Modal } from '../common/Modal'

// Importing an .ics file into one of your calendars, or exporting a calendar as one.

const close = (): void => setApp({ modal: null })

export function CalendarIoDialog({ accountId, mode }: { accountId: string; mode: 'import' | 'export' }) {
  const calendars = useCalendar((s) => s.accounts[accountId]?.calendars)
  const preferred = usePrefs((s) => s.defaultCalendars[accountId])
  const writable = useMemo(() => (calendars ?? []).filter((c) => c.writable), [calendars])
  const all = calendars ?? []
  const choices = mode === 'import' ? writable : all
  const [href, setHref] = useState(
    () =>
      (choices.find((c) => c.href === preferred) ?? choices.find((c) => !c.sharedBy) ?? choices[0])?.href ??
      ''
  )
  const [file, setFile] = useState<{ name: string; items: ImportItem[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)

  const choose = async (): Promise<void> => {
    setError(null)
    setResult(null)
    try {
      const picked = await window.hubbub.openIcsFile()
      if (!picked) return
      const items = splitIcs(picked.text)
      if (!items.length) throw new Error('There are no events in it')
      setFile({ name: picked.name, items })
    } catch (err) {
      setFile(null)
      setError(`That file can’t be imported: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const run = async (): Promise<void> => {
    const calendar = all.find((c) => c.href === href)
    if (!calendar || busy) return
    setBusy(true)
    if (mode === 'export') {
      await exportCalendar(accountId, calendar)
      setBusy(false)
      close()
      return
    }
    if (!file) return
    setDone(0)
    setResult(await importEvents(accountId, href, file.items, setDone))
    setBusy(false)
  }

  const span =
    file && file.items.length
      ? [file.items[0].start, file.items[file.items.length - 1].start]
          .filter(Boolean)
          .map((t) => formatDate(t, { year: 'numeric' }))
      : []

  return (
    <Modal
      title={mode === 'import' ? 'Import a calendar file' : 'Export a calendar'}
      onClose={close}
      footer={
        result ? (
          <button className="btn btn-primary" onClick={close}>
            Done
          </button>
        ) : (
          <>
            <button className="btn btn-tertiary" onClick={close}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !href || (mode === 'import' && !file)}
              onClick={() => void run()}
            >
              {mode === 'export'
                ? busy
                  ? 'Exporting…'
                  : 'Export…'
                : busy
                  ? `Importing ${done} of ${file?.items.length ?? 0}…`
                  : `Import ${file ? `${file.items.length} ${file.items.length === 1 ? 'event' : 'events'}` : ''}`}
            </button>
          </>
        )
      }
    >
      {mode === 'import' && !result && (
        <>
          <button className="ev-btn light io-choose" onClick={() => void choose()} disabled={busy}>
            <FileUp size={16} /> {file ? 'Choose another file…' : 'Choose an .ics file…'}
          </button>
          {file && (
            <p className="io-file">
              <b>{file.name}</b>: {file.items.length} {file.items.length === 1 ? 'event' : 'events'}
              {span.length ? `, ${span[0]}${span[1] && span[1] !== span[0] ? ` to ${span[1]}` : ''}` : ''}
            </p>
          )}
          {error && <p className="error-text">{error}</p>}
        </>
      )}

      {!result && (
        <>
          <label className="field-label">{mode === 'import' ? 'Into the calendar' : 'Calendar'}</label>
          <select className="input" value={href} onChange={(e) => setHref(e.target.value)} disabled={busy}>
            {choices.map((c) => (
              <option key={c.href} value={c.href}>
                {c.name}
                {c.sharedBy ? ` (${c.sharedBy})` : ''}
              </option>
            ))}
          </select>
          <p className="help">
            {mode === 'import'
              ? 'Events already in that calendar are left as they are. Nobody is sent anything, also for meetings with invitees.'
              : 'All of its events, as one .ics file that other calendar apps can import.'}
          </p>
        </>
      )}

      {result && (
        <div className="io-result">
          <p>
            {mode === 'import' ? <Upload size={16} /> : <Download size={16} />} {result.added}{' '}
            {result.added === 1 ? 'event' : 'events'} added
            {result.skipped ? `, ${result.skipped} already there` : ''}
            {result.failed.length ? `, ${result.failed.length} couldn’t be added` : ''}.
          </p>
          {result.failed.length > 0 && (
            <ul className="io-failed">
              {result.failed.slice(0, 8).map((f, i) => (
                <li key={i}>
                  {f.title}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  )
}
