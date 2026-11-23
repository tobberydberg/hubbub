import { useEffect, useRef, useState } from 'react'
import { Circle, Clock, MinusCircle, Plus, Search, Settings, EyeOff } from 'lucide-react'
import { setApp, useActiveAccount } from '@renderer/store/app'
import { setUserStatus } from '@renderer/sync/actions'
import { Avatar } from './common/Avatar'
import { anchorFrom, Menu, MenuItem, MenuSeparator, useMenuState } from './common/Menu'
import { openSearch } from './rhs/Rhs'
import logoUrl from '../assets/logo.svg'

const STATUSES = [
  {
    value: 'online',
    label: 'Online',
    icon: <Circle size={16} fill="var(--online-indicator)" stroke="none" />
  },
  { value: 'away', label: 'Away', icon: <Clock size={16} color="var(--away-indicator)" /> },
  { value: 'dnd', label: 'Do not disturb', icon: <MinusCircle size={16} color="var(--dnd-indicator)" /> },
  { value: 'invisible', label: 'Invisible', icon: <EyeOff size={16} /> }
]

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
            title={account.user?.displayname}
            onClick={(e) => menu.open(anchorFrom(e.currentTarget, 'right'), true)}
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
          {STATUSES.map((s) => (
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
