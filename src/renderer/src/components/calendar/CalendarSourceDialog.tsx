import { useMemo, useState } from 'react'
import { Cloud, Link2, Server } from 'lucide-react'
import type { CalendarSourceInput, CalendarSourceKind } from '@shared/ipc'
import { parseCalendarList } from '@renderer/lib/caldav'
import { parseCalendarObjects } from '@renderer/lib/ics-expand'
import { setApp, showToast } from '@renderer/store/app'
import { useCalendar } from '@renderer/store/calendar'
import { useExternal } from '@renderer/store/external'
import { usePrefs } from '@renderer/store/prefs'
import { BUSY_DAYS } from '@renderer/sync/busy-time'
import { removeSource, saveSource } from '@renderer/sync/external'
import { ColorPicker } from '../common/ColorPicker'
import { Modal, Toggle } from '../common/Modal'

// Adding a calendar from elsewhere to a server's calendar, or changing one: a calendar link, an iCloud
// account or another CalDAV server, checked before it's saved, and optionally its busy time copied
// into a Nextcloud calendar.

const close = (): void => setApp({ modal: null })

const COLORS = [
  '#b64fc8',
  '#1c58d9',
  '#3db887',
  '#e07315',
  '#d24b4e',
  '#0a8a9c',
  '#c43e8a',
  '#6b7b0c',
  '#3f4350'
]

const KINDS: { kind: CalendarSourceKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'link', label: 'Calendar link', icon: <Link2 size={15} /> },
  { kind: 'icloud', label: 'iCloud', icon: <Cloud size={15} /> },
  { kind: 'caldav', label: 'CalDAV server', icon: <Server size={15} /> }
]

type Checked = { ok: true; summary: string } | { ok: false; error: string } | null

export function CalendarSourceDialog({ accountId, sourceId }: { accountId: string; sourceId?: string }) {
  const existing = useExternal((s) => s.sources.find((x) => x.id === sourceId))
  const status = useExternal((s) => (sourceId ? s.status[sourceId] : undefined))
  const calendars = useCalendar((s) => s.accounts[accountId]?.calendars)
  const targets = useMemo(
    () => (calendars ?? []).filter((c) => c.writable && !c.sharedBy && !c.subscription),
    [calendars]
  )
  const [kind, setKind] = useState<CalendarSourceKind>(existing?.kind ?? 'link')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState(existing?.username ?? '')
  const [password, setPassword] = useState('')
  const [name, setName] = useState(existing?.name ?? '')
  const [nameTouched, setNameTouched] = useState(!!existing)
  const [color, setColor] = useState(existing?.color ?? COLORS[0])
  const [busyOn, setBusyOn] = useState(!!existing?.busy)
  const [busyCalendar, setBusyCalendar] = useState(existing?.busy?.calendarHref ?? '')
  const [busyTitle, setBusyTitle] = useState(existing?.busy?.title ?? 'Busy')
  const [busyAllDay, setBusyAllDay] = useState(existing?.busy?.allDay ?? false)
  const [checked, setChecked] = useState<Checked>(null)
  const [working, setWorking] = useState<'check' | 'save' | 'remove' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const preferred = usePrefs((s) => s.defaultCalendars[accountId])
  // The calendar new events go into, unless another is chosen
  const target =
    targets.find((c) => c.href === busyCalendar) ?? targets.find((c) => c.href === preferred) ?? targets[0]
  const input = (): CalendarSourceInput => ({
    id: existing?.id,
    accountId,
    kind,
    name:
      name.trim() ||
      (kind === 'icloud'
        ? 'iCloud'
        : kind === 'caldav'
          ? url.replace(/^\w+:\/\//, '').split('/')[0]
          : 'Private'),
    color,
    url: url.trim() || undefined,
    username: kind === 'link' ? undefined : username,
    password: password || undefined,
    busy: busyOn && target ? { calendarHref: target.href, title: busyTitle, allDay: busyAllDay } : null
  })
  // Anything typed makes the last check out of date
  const changed =
    <T,>(set: (v: T) => void) =>
    (v: T): void => {
      set(v)
      setChecked(null)
    }

  const check = async (): Promise<boolean> => {
    setWorking('check')
    const res = await window.hubbub.calendarSources.test(input())
    setWorking(null)
    if (!res.ok) {
      setChecked({
        ok: false,
        error: res.error.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      })
      return false
    }
    if (res.kind === 'link') {
      const parsed = parseCalendarObjects([{ href: 'feed', ics: res.text }])
      if (!nameTouched && parsed.name) setName(parsed.name)
      if (!existing && parsed.color) setColor(parsed.color.toLowerCase())
      const n = parsed.series.length
      setChecked({
        ok: true,
        summary: `Found${parsed.name ? ` “${parsed.name}”` : ''}: ${n} ${n === 1 ? 'event' : 'events'}`
      })
    } else {
      const list = parseCalendarList(res.calendarsXml, '')
      setChecked({
        ok: true,
        summary: list.length
          ? `Found ${list.length} ${list.length === 1 ? 'calendar' : 'calendars'}: ${list.map((c) => c.name).join(', ')}`
          : 'Signed in, but there are no calendars with events there'
      })
    }
    return true
  }

  const save = async (): Promise<void> => {
    if (!checked?.ok && !(await check())) return
    setWorking('save')
    try {
      await saveSource(input())
      close()
    } catch (err) {
      setChecked({
        ok: false,
        error: (err instanceof Error ? err.message : String(err)).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          ''
        )
      })
      setWorking(null)
    }
  }

  const remove = async (): Promise<void> => {
    if (!existing) return
    setWorking('remove')
    const { busyLeft } = await removeSource(existing.id)
    if (busyLeft) showToast('Some of its busy time couldn’t be removed from Nextcloud', 'error')
    close()
  }

  const ready =
    kind === 'link'
      ? !!(url.trim() || existing)
      : (kind === 'icloud' || !!(url.trim() || existing)) && !!username.trim() && !!(password || existing)

  return (
    <Modal
      title={existing ? existing.name : 'Add a calendar'}
      onClose={close}
      footer={
        confirmRemove ? (
          <>
            <span className="left help">
              Remove it from Hubbub{existing?.busy ? ', with its busy time in Nextcloud' : ''}?
            </span>
            <button className="btn btn-tertiary" onClick={() => setConfirmRemove(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" disabled={!!working} onClick={() => void remove()}>
              {working === 'remove' ? 'Removing…' : 'Remove'}
            </button>
          </>
        ) : (
          <>
            {existing && (
              <button
                className="btn btn-tertiary left"
                style={{ color: 'var(--error-text-color)' }}
                onClick={() => setConfirmRemove(true)}
              >
                Remove
              </button>
            )}
            <button className="btn btn-tertiary" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!ready || !!working} onClick={() => void save()}>
              {working === 'save' ? 'Saving…' : existing ? 'Save' : 'Add'}
            </button>
          </>
        )
      }
    >
      {!existing && (
        <div className="sp-tabs src-kinds" role="tablist">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              role="tab"
              aria-selected={kind === k.kind}
              className={kind === k.kind ? 'active' : ''}
              onClick={() => {
                setKind(k.kind)
                setChecked(null)
              }}
            >
              {k.icon} {k.label}
            </button>
          ))}
        </div>
      )}

      {kind === 'link' && (
        <div className="field">
          <label>Link to the calendar</label>
          <input
            className="input"
            autoFocus={!existing}
            placeholder={
              existing ? `Kept (${existing.where}): paste a new link to change it` : 'https://… or webcal://…'
            }
            value={url}
            onChange={(e) => changed(setUrl)(e.target.value)}
          />
          <div className="help src-help">
            <b>Google:</b> Settings → your calendar → Integrate calendar → Secret address in iCal format.{' '}
            <b>iCloud:</b> share the calendar as a Public Calendar and copy its link. <b>Outlook.com:</b>{' '}
            Settings → Calendar → Shared calendars → Publish a calendar → the ICS link.
            <br />
            The link works like a password: Hubbub keeps it encrypted on this computer, and it never goes to
            Nextcloud. Read-only, and checked every 15 minutes.
          </div>
        </div>
      )}

      {kind !== 'link' && (
        <>
          {kind === 'caldav' && (
            <div className="field">
              <label>Server</label>
              <input
                className="input"
                autoFocus={!existing}
                placeholder={
                  existing
                    ? `Kept (${existing.where}): enter another to change it`
                    : 'https://caldav.example.com'
                }
                value={url}
                onChange={(e) => changed(setUrl)(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label>{kind === 'icloud' ? 'Apple ID' : 'User name'}</label>
            <input
              className="input"
              autoFocus={!existing && kind === 'icloud'}
              placeholder={kind === 'icloud' ? 'name@icloud.com' : ''}
              value={username}
              onChange={(e) => changed(setUsername)(e.target.value)}
            />
          </div>
          <div className="field">
            <label>{kind === 'icloud' ? 'App-specific password' : 'Password'}</label>
            <input
              className="input"
              type="password"
              placeholder={
                existing
                  ? 'Kept: type a new one to change it'
                  : kind === 'icloud'
                    ? 'xxxx-xxxx-xxxx-xxxx'
                    : ''
              }
              value={password}
              onChange={(e) => changed(setPassword)(e.target.value)}
            />
            <div className="help src-help">
              {kind === 'icloud' ? (
                <>
                  Your Apple ID password doesn’t work here: make an app-specific password at{' '}
                  <button
                    className="link-btn"
                    onClick={() =>
                      void window.hubbub.app.openExternal('https://account.apple.com/account/manage')
                    }
                  >
                    account.apple.com
                  </button>{' '}
                  (Sign-In and Security → App-Specific Passwords).
                </>
              ) : (
                'Use an app password where the server offers them.'
              )}{' '}
              Kept encrypted on this computer, and never sent to Nextcloud. Read-only, and checked every 5
              minutes.
            </div>
          </div>
        </>
      )}

      <div className="src-check">
        <button className="ev-btn light" disabled={!ready || !!working} onClick={() => void check()}>
          {working === 'check' ? 'Checking…' : 'Check'}
        </button>
        {checked?.ok && <span className="src-ok">{checked.summary}</span>}
        {checked && !checked.ok && <span className="error-text">{checked.error}</span>}
      </div>

      <div className="field">
        <label>Name</label>
        <input
          className="input"
          value={name}
          placeholder={kind === 'icloud' ? 'iCloud' : kind === 'caldav' ? 'The server’s name' : 'Private'}
          onChange={(e) => {
            setName(e.target.value)
            setNameTouched(true)
          }}
        />
        {kind !== 'link' && <div className="help">Its calendars keep their own names and colors.</div>}
      </div>
      {kind === 'link' && (
        <div className="field">
          <label>Color</label>
          <ColorPicker colors={COLORS} value={color} onChange={setColor} />
        </div>
      )}

      <div className="src-busy">
        <div className="src-busy-head">
          <div>
            <div className="sr-title">Block the time in Nextcloud</div>
            <div className="help">
              Copies its events as “{busyTitle.trim() || 'Busy'}” into one of your Nextcloud calendars, from
              today and {BUSY_DAYS} days ahead, so colleagues see you’re busy when they book a meeting. The
              copies have only the time and that title: no names, places or notes, and nobody is sent
              anything.
            </div>
          </div>
          <Toggle on={busyOn} onChange={setBusyOn} />
        </div>
        {busyOn && (
          <div className="src-busy-options">
            <label className="field-label">Into the calendar</label>
            {targets.length ? (
              <select
                className="input"
                value={target?.href ?? ''}
                onChange={(e) => setBusyCalendar(e.target.value)}
              >
                {targets.map((c) => (
                  <option key={c.href} value={c.href}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="error-text">You have no Nextcloud calendar to copy into.</p>
            )}
            <label className="field-label">Shown as</label>
            <input
              className="input"
              value={busyTitle}
              maxLength={100}
              onChange={(e) => setBusyTitle(e.target.value)}
            />
            <label className="src-busy-allday">
              <input type="checkbox" checked={busyAllDay} onChange={(e) => setBusyAllDay(e.target.checked)} />
              All-day events too (they block the whole day)
            </label>
            <div className="help">Events marked as free don’t block anything.</div>
          </div>
        )}
      </div>

      {existing && status && (
        <p className={`help src-status${status.error ? ' error' : ''}`}>
          {status.error
            ? `Last check failed: ${status.error}`
            : status.checkedAt
              ? `Checked ${new Date(status.checkedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}: ${status.calendars ?? 0} events`
              : 'Not checked yet'}
          {status.busy &&
            (status.busy.error
              ? ` · Busy time: ${status.busy.error}`
              : ` · ${status.busy.count} busy ${status.busy.count === 1 ? 'time' : 'times'} in Nextcloud`)}
        </p>
      )}
    </Modal>
  )
}
