import { useEffect, useRef, useState } from 'react'
import { AlarmClock, CalendarOff, Plus, Search, Settings, Smile, X } from 'lucide-react'
import { formatUntil } from '@renderer/lib/status'
import { hasFeature, setApp, useActiveAccount } from '@renderer/store/app'
import { setUserStatus } from '@renderer/sync/actions'
import { clearOwnStatusMessage, refreshOwnStatus } from '@renderer/sync/status'
import { absentToday, loadOwnAbsence } from '@renderer/sync/absence'
import { STATUS_CHOICES } from './modals/StatusModal'
import { Avatar } from './common/Avatar'
import { NotificationCenter } from './NotificationCenter'
import { anchorFrom, Menu, MenuItem, MenuSeparator, useMenuState } from './common/Menu'
import { openSearch } from './rhs/Rhs'
import logoUrl from '../assets/logo.svg'

export function GlobalHeader() {
  const account = useActiveAccount()
  const [query, setQuery] = useState('')
  const menu = useMenuState()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focus = (): void => inputRef.current?.focus()
    window.addEventListener('hubbub:focus-search', focus)
    return () => window.removeEventListener('hubbub:focus-search', focus)
  }, [])

  return (
    <header className="global-header">
      <div className="gh-brand">
        <img src={logoUrl} className="gh-brand-logo" alt="" />
        Hubbub
      </div>
      <div className="gh-search">
        {account && (
          <div className="gh-search-box">
            <Search size={14} />
            <input
              ref={inputRef}
              placeholder={`Search messages on ${account.info.label}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openSearch(account.info.id, query)
                if (e.key === 'Escape') {
                  setQuery('')
                  e.currentTarget.blur()
                }
              }}
            />
          </div>
        )}
      </div>
      <div className="gh-right">
        <NotificationCenter />
        <button
          className="gh-icon-btn"
          title="Settings"
          onClick={() => setApp({ modal: { type: 'settings' } })}
        >
          <Settings size={18} />
        </button>
        {account && (
          <button
            className="gh-icon-btn"
            title={[
              account.user?.displayname,
              account.ownStatus?.message &&
                `${account.ownStatus.icon ?? ''} ${account.ownStatus.message}`.trim()
            ]
              .filter(Boolean)
              .join(' · ')}
            onClick={(e) => {
              menu.open(anchorFrom(e.currentTarget, 'right'), true)
              void refreshOwnStatus(account.info.id)
              void loadOwnAbsence(account.info.id)
            }}
          >
            <Avatar
              accountId={account.info.id}
              userId={account.user?.id ?? account.info.userId}
              name={account.info.displayName}
              size={24}
              status={account.userStatus ?? null}
            />
          </button>
        )}
      </div>

      {menu.state && account && (
        <Menu anchor={menu.state.anchor} onClose={menu.close}>
          <div className="menu-user">
            <Avatar
              accountId={account.info.id}
              userId={account.user?.id ?? account.info.userId}
              name={account.info.displayName}
              size={36}
            />
            <div>
              <div className="mu-name">{account.user?.displayname ?? account.info.displayName}</div>
              <div className="mu-sub">@{account.user?.id ?? account.info.userId}</div>
            </div>
          </div>
          <div className="menu-custom-status">
            <button
              className="mcs-open"
              onClick={() => {
                menu.close()
                setApp({ modal: { type: 'status', accountId: account.info.id } })
              }}
            >
              <span className="mcs-icon">{account.ownStatus?.icon || <Smile size={18} />}</span>
              {account.ownStatus?.message ? (
                <span className="mcs-text">
                  <span className="mcs-message">{account.ownStatus.message}</span>
                  {account.ownStatus.clearAt ? (
                    <span className="mcs-until">{formatUntil(account.ownStatus.clearAt)}</span>
                  ) : null}
                </span>
              ) : (
                <span className="mcs-text placeholder">Set a custom status</span>
              )}
            </button>
            {(account.ownStatus?.message || account.ownStatus?.icon) && (
              <button
                className="icon-btn small"
                title="Clear the status message"
                onClick={() => void clearOwnStatusMessage(account.info.id)}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <MenuSeparator />
          {STATUS_CHOICES.filter((s) => s.value !== 'busy' || account.canBeBusy).map((s) => (
            <MenuItem
              key={s.value}
              icon={s.icon}
              label={s.label}
              checked={account.userStatus === s.value}
              onClick={() => {
                menu.close()
                void setUserStatus(account.info.id, s.value)
              }}
            />
          ))}
          {account.absenceSupported !== false && (
            <MenuItem
              icon={<CalendarOff size={18} />}
              label={
                account.ownAbsence ? (
                  <span className="menu-ooo">
                    Out of office
                    <span className="menu-ooo-when">
                      {absentToday(account.ownAbsence) ? 'Now, until ' : 'From '}
                      {absentToday(account.ownAbsence)
                        ? shortDay(account.ownAbsence.lastDay)
                        : `${shortDay(account.ownAbsence.firstDay)} to ${shortDay(account.ownAbsence.lastDay)}`}
                    </span>
                  </span>
                ) : (
                  'Set out of office…'
                )
              }
              onClick={() => {
                menu.close()
                setApp({ modal: { type: 'out-of-office', accountId: account.info.id } })
              }}
            />
          )}
          <MenuSeparator />
          {hasFeature(account, 'remind-me-later') && (
            <MenuItem
              icon={<AlarmClock size={18} />}
              label="Upcoming reminders"
              onClick={() => {
                menu.close()
                setApp({ rhs: { type: 'reminders', accountId: account.info.id } })
              }}
            />
          )}
          <MenuItem
            icon={<Settings size={18} />}
            label="Server settings…"
            onClick={() => {
              menu.close()
              setApp({ modal: { type: 'server-settings', accountId: account.info.id } })
            }}
          />
          <MenuItem
            icon={<Plus size={18} />}
            label="Add another server…"
            onClick={() => {
              menu.close()
              setApp({ modal: { type: 'add-server' } })
            }}
          />
        </Menu>
      )}
    </header>
  )
}

/** "Wed 3 Dec" for a yyyy-mm-dd day */
function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })
}
