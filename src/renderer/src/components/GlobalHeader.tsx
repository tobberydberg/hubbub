import { useEffect, useRef, useState } from 'react'
import { AlarmClock, Plus, Search, Settings, Smile, X } from 'lucide-react'
import { formatUntil } from '@renderer/lib/status'
import { hasFeature, setApp, useActiveAccount } from '@renderer/store/app'
import { setUserStatus } from '@renderer/sync/actions'
import { clearOwnStatusMessage, refreshOwnStatus } from '@renderer/sync/status'
import { STATUS_CHOICES } from './modals/StatusModal'
import { Avatar } from './common/Avatar'
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
