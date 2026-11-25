import { useEffect, useState, type ReactNode } from 'react'
import {
  CalendarOff,
  Clock,
  Globe,
  Link2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Smile,
  Video
} from 'lucide-react'
import { formatLastSeen, formatUntil, STATUS_LABEL } from '@renderer/lib/status'
import { setApp, useApp } from '@renderer/store/app'
import { callPeople, openDirectMessage } from '@renderer/sync/actions'
import { lastSeen, loadPersonCard, type PersonCard } from '@renderer/sync/status'
import { absenceOf, absenceUntil } from '@renderer/sync/absence'
import { contactByEmail } from '@renderer/sync/contacts'
import type { Contact } from '@renderer/lib/contacts'
import type { CurrentAbsence } from '@renderer/api/talk'
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

/** Opens the card of someone outside the server, from your contacts by their email address */
export function openContactCard(accountId: string, email: string, name: string, el: Element): void {
  const r = el.getBoundingClientRect()
  setApp({
    profileCard: { accountId, email, name, anchor: { x: r.left, y: r.bottom + 4, height: r.height + 8 } }
  })
}

const close = (): void => setApp({ profileCard: null })

export function ProfileCardHost() {
  const card = useApp((s) => s.profileCard)
  if (!card) return null
  const key = `${card.accountId}/${card.userId ?? card.email}/${card.anchor.x}/${card.anchor.y}`
  if (card.userId) return <ProfileCard key={key} {...card} userId={card.userId} />
  if (card.email) return <ContactCard key={key} {...card} email={card.email} />
  return null
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
  const [absence, setAbsence] = useState<CurrentAbsence | null>(null)
  const [contact, setContact] = useState<Contact | undefined>()

  useEffect(() => {
    let current = true
    void absenceOf(accountId, userId).then((a) => current && setAbsence(a))
    return () => {
      current = false
    }
  }, [accountId, userId])

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
  const email = contacts.find((a) => a.id === 'email')?.target.replace(/^mailto:/i, '')
  // Phone numbers you keep for them in your contacts that their profile doesn't show
  const known = new Set(contacts.filter((a) => a.id === 'phone').map((a) => digits(a.target)))
  const extraPhones = (contact?.phones ?? []).filter((ph) => !known.has(digits(ph.value)))

  useEffect(() => {
    if (!email) return
    let current = true
    void contactByEmail(accountId, email).then((c) => current && setContact(c))
    return () => {
      current = false
    }
  }, [accountId, email])
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

      {absence && (
        <div className="pc-absence">
          <div className="pc-absence-title">
            <CalendarOff size={15} />
            <span>
              Out of office {absenceUntil(absence.endDate)}
              {absence.shortMessage ? ` · ${absence.shortMessage}` : ''}
            </span>
          </div>
          {absence.message && <p className="pc-absence-message">{absence.message}</p>}
          {absence.replacementUserId && (
            <button
              className="link-btn"
              onClick={(e) =>
                openProfileCard(
                  accountId,
                  absence.replacementUserId!,
                  absence.replacementUserDisplayName ?? absence.replacementUserId!,
                  e.currentTarget
                )
              }
            >
              Contact instead: {absence.replacementUserDisplayName ?? absence.replacementUserId}
            </button>
          )}
        </div>
      )}

      {p?.headline && <p className="pc-headline">{p.headline}</p>}

      {(contacts.length > 0 || extraPhones.length > 0 || p?.address || localTime) && (
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
          {extraPhones.map((ph) => (
            <button
              key={ph.value}
              className="pc-detail link"
              title="From your contacts"
              onClick={() => void window.hubbub.app.openExternal(`tel:${ph.value.replace(/\s+/g, '')}`)}
            >
              <Phone size={15} />
              <span>
                {ph.value}
                {ph.type && <span className="pc-detail-type"> · {ph.type}</span>}
              </span>
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

const digits = (phone: string): string => phone.replace(/[^\d+]/g, '')

/** The card of someone who isn't a user of the server: what your contacts say about them */
function ContactCard({
  accountId,
  email,
  name,
  anchor
}: {
  accountId: string
  email: string
  name: string
  anchor: { x: number; y: number; height?: number }
}) {
  const [contact, setContact] = useState<Contact | null | undefined>()

  useEffect(() => {
    let current = true
    void contactByEmail(accountId, email)
      .then((c) => current && setContact(c ?? null))
      .catch(() => current && setContact(null))
    return () => {
      current = false
    }
  }, [accountId, email])

  const c = contact ?? undefined
  const displayName = c?.name || name || email
  const emails = c?.emails.length ? c.emails : [{ value: email }]

  return (
    <Popover anchor={anchor} onClose={close} className="popover profile-card">
      <div className="pc-head">
        {c?.photo ? (
          <span className="avatar" style={{ width: 72, height: 72 }}>
            <img src={c.photo} alt="" draggable={false} />
          </span>
        ) : (
          <Avatar accountId={accountId} name={displayName} size={72} />
        )}
        <div className="pc-who">
          <div className="pc-name">{displayName}</div>
          {c?.title && <div className="pc-line">{c.title}</div>}
          {c?.organization && <div className="pc-line">{c.organization}</div>}
          <div className="pc-presence">
            {contact === undefined
              ? ' '
              : c
                ? c.recent
                  ? 'Recently contacted'
                  : 'In your contacts'
                : 'Not in your contacts'}
          </div>
        </div>
      </div>

      <div className="pc-details">
        {emails.map((e) => (
          <button
            key={e.value}
            className="pc-detail link"
            title={`Write to ${e.value}`}
            onClick={() => void window.hubbub.app.openExternal(`mailto:${e.value}`)}
          >
            <Mail size={15} />
            <span>
              {e.value}
              {e.type && <span className="pc-detail-type"> · {e.type}</span>}
            </span>
          </button>
        ))}
        {(c?.phones ?? []).map((ph) => (
          <button
            key={ph.value}
            className="pc-detail link"
            onClick={() => void window.hubbub.app.openExternal(`tel:${ph.value.replace(/\s+/g, '')}`)}
          >
            <Phone size={15} />
            <span>
              {ph.value}
              {ph.type && <span className="pc-detail-type"> · {ph.type}</span>}
            </span>
          </button>
        ))}
        {c?.website && /^https?:\/\//i.test(c.website) && (
          <button className="pc-detail link" onClick={() => void window.hubbub.app.openExternal(c.website!)}>
            <Globe size={15} />
            <span>{c.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</span>
          </button>
        )}
        {c?.address && (
          <div className="pc-detail">
            <MapPin size={15} />
            <span>{c.address}</span>
          </div>
        )}
      </div>

      {c?.note && <p className="pc-headline">{c.note}</p>}

      <div className="pc-actions">
        <button
          className="ev-btn"
          onClick={() => {
            close()
            void window.hubbub.app.openExternal(`mailto:${emails[0].value}`)
          }}
        >
          <Mail size={15} /> Send email
        </button>
      </div>
    </Popover>
  )
}
