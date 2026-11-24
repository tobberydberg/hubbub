import { useEffect, useState, type ReactNode } from 'react'
import { Clock, Globe, Link2, Mail, MapPin, MessageSquare, Phone, Smile, Video } from 'lucide-react'
import { formatLastSeen, formatUntil, STATUS_LABEL } from '@renderer/lib/status'
import { setApp, useApp } from '@renderer/store/app'
import { callPeople, openDirectMessage } from '@renderer/sync/actions'
import { lastSeen, loadPersonCard, type PersonCard } from '@renderer/sync/status'
import { Avatar } from './Avatar'
import { Popover } from './Menu'

// Someone's profile card, like Mattermost's: opened from their name or picture. It shows what they
// share in their Nextcloud profile (title, company, how to reach them), their status, their local
// time and when they were last active.

/** Opens the profile card under the clicked name or picture */
export function openProfileCard(accountId: string, userId: string, name: string, el: Element): void {
  const r = el.getBoundingClientRect()
  setApp({
    profileCard: { accountId, userId, name, anchor: { x: r.left, y: r.bottom + 4, height: r.height + 8 } }
  })
}

const close = (): void => setApp({ profileCard: null })

export function ProfileCardHost() {
  const card = useApp((s) => s.profileCard)
  if (!card) return null
  return <ProfileCard key={`${card.accountId}/${card.userId}/${card.anchor.x}/${card.anchor.y}`} {...card} />
}

const ICONS: Record<string, ReactNode> = {
  email: <Mail size={15} />,
  phone: <Phone size={15} />,
  website: <Globe size={15} />
}

/** How people are reached, in this order; Talk's own actions are the buttons below */
const ORDER = ['email', 'phone', 'website']

function ProfileCard({
  accountId,
  userId,
  name,
  anchor
}: {
  accountId: string
  userId: string
  name: string
  anchor: { x: number; y: number; height?: number }
}) {
  const [data, setData] = useState<PersonCard | null>(null)
  const self = useApp((s) => s.accounts[accountId]?.user?.id === userId)
  const ownStatus = useApp((s) => s.accounts[accountId]?.ownStatus)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let current = true
    void loadPersonCard(accountId, userId)
      .then((d) => current && setData(d))
      .catch(() => current && setData({ profile: null, status: null }))
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => {
      current = false
      clearInterval(t)
    }
  }, [accountId, userId])

  const p = data?.profile
  const st = self ? (ownStatus ?? data?.status) : data?.status
  const displayName = p?.displayname || name
  const active = !!st && st.status !== 'offline' && st.status !== 'invisible'
  const seen = active ? null : lastSeen(accountId, userId)
  const contacts = (p?.actions ?? [])
    .filter((a) => !a.id.startsWith('talk'))
    .sort((a, b) => rank(a.id) - rank(b.id))
  const localTime =
    p?.timezone && p.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone
      ? localTimeIn(p.timezone, now)
      : null

  return (
    <Popover anchor={anchor} onClose={close} className="popover profile-card">
      <div className="pc-head">
        <Avatar
          accountId={accountId}
          userId={userId}
          name={displayName}
          size={72}
          status={st?.status ?? null}
        />
        <div className="pc-who">
          <div className="pc-name" title={`@${userId}`}>
            {displayName}
            {p?.pronouns && <span className="pc-pronouns"> ({p.pronouns})</span>}
          </div>
          {p?.role && <div className="pc-line">{p.role}</div>}
          {p?.organisation && <div className="pc-line">{p.organisation}</div>}
          <div className={`pc-presence${active ? ` on ${st.status}` : ''}`}>
            {!data
              ? ' '
              : active
                ? (STATUS_LABEL[st.status] ?? st.status)
                : seen
                  ? formatLastSeen(seen, now)
                  : 'Offline'}
          </div>
        </div>
      </div>

      {(st?.message || st?.icon) && (
        <div className="pc-status">
          <span className="pc-status-icon">{st.icon || <Smile size={15} />}</span>
          <span>
            {st.message}
            {st.clearAt ? <span className="pc-until"> · {formatUntil(st.clearAt, now)}</span> : null}
          </span>
        </div>
      )}

      {p?.headline && <p className="pc-headline">{p.headline}</p>}

      {(contacts.length > 0 || p?.address || localTime) && (
        <div className="pc-details">
          {contacts.map((a) => (
            <button
              key={a.id + a.target}
              className="pc-detail link"
              title={a.title}
              onClick={() => void window.hubbub.app.openExternal(a.target)}
            >
              {ICONS[a.id] ?? <Link2 size={15} />}
              <span>{contactText(a.id, a.title, a.target)}</span>
            </button>
          ))}
          {p?.address && (
            <div className="pc-detail">
              <MapPin size={15} />
              <span>{p.address}</span>
            </div>
          )}
          {localTime && (
            <div className="pc-detail">
              <Clock size={15} />
              <span>{localTime} local time</span>
            </div>
          )}
        </div>
      )}

      <div className="pc-actions">
        {self ? (
          <button
            className="ev-btn light"
            onClick={() => {
              close()
              setApp({ modal: { type: 'status', accountId } })
            }}
          >
            <Smile size={15} /> Set status
          </button>
        ) : (
          <>
            <button
              className="ev-btn"
              onClick={() => {
                close()
                void openDirectMessage(accountId, userId)
              }}
            >
              <MessageSquare size={15} /> Message
            </button>
            <button
              className="ev-btn light"
              onClick={() => {
                close()
                void callPeople(accountId, [{ id: userId, name: displayName }])
              }}
            >
              <Video size={15} /> Call
            </button>
          </>
        )}
      </div>
    </Popover>
  )
}

const rank = (id: string): number => {
  const i = ORDER.indexOf(id)
  return i === -1 ? ORDER.length : i
}

/** The address itself where the action has one, else the action's title ("Visit …'s website") */
function contactText(id: string, title: string, target: string): string {
  if (id === 'email') return target.replace(/^mailto:/i, '')
  if (id === 'phone') return target.replace(/^tel:/i, '')
  if (id === 'website') return target.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  return title
}

function localTimeIn(timeZone: string, now: Date): string | null {
  try {
    return now.toLocaleTimeString(undefined, { timeZone, hour: 'numeric', minute: '2-digit' })
  } catch {
    return null
  }
}
