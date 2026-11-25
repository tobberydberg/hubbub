import { useEffect, useState } from 'react'
import {
  Ban as BanIcon,
  MoreHorizontal,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Trash2,
  UserMinus
} from 'lucide-react'
import {
  ALL_PERMISSIONS,
  Permission,
  RoomType,
  type Ban,
  type Participant,
  type Room
} from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { fromLocalInput, toLocalInput } from '@renderer/lib/time'
import { hasFeature, type AccountState } from '@renderer/store/app'
import { confirmClearHistory, confirmRemove, isModeratorType, moderate } from '@renderer/sync/moderation'
import { anchorFrom, Menu, MenuItem, MenuSeparator, type Anchor } from '../common/Menu'
import { Modal, Toggle } from '../common/Modal'

// The moderator's part of a conversation's Info panel, and what moderators can do to one member.

const EXPIRATION = [
  { seconds: 0, label: 'Off' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 8 * 3600, label: '8 hours' },
  { seconds: 86_400, label: '1 day' },
  { seconds: 7 * 86_400, label: '1 week' },
  { seconds: 28 * 86_400, label: '4 weeks' }
]

/** What a person can be allowed, with the Talk feature that has to be there for it */
const PERMISSIONS: { bit: number; label: string; feature?: string }[] = [
  { bit: Permission.StartCall, label: 'Start calls' },
  { bit: Permission.JoinCall, label: 'Join calls' },
  { bit: Permission.Audio, label: 'Use their microphone' },
  { bit: Permission.Video, label: 'Use their camera' },
  { bit: Permission.Screen, label: 'Share their screen' },
  { bit: Permission.Chat, label: 'Write messages', feature: 'chat-permission' },
  { bit: Permission.React, label: 'React to messages', feature: 'react-permission' }
]

/** Permissions as Talk reports them: 0 means the default, which is everything */
const effective = (p: number | undefined): number => (!p ? ALL_PERMISSIONS : p)

export function ModerationSection({ account, room }: { account: AccountState; room: Room }) {
  const accountId = account.info.id
  const token = room.token
  const call = account.caps?.config.call
  const lobbyOn = room.lobbyState === 1
  const group = room.type === RoomType.Group || room.type === RoomType.Public
  const [editing, setEditing] = useState(false)

  return (
    <div className="info-block moderation">
      <div className="label">
        <ShieldCheck size={12} /> Moderation
      </div>

      {hasFeature(account, 'webinary-lobby') && (
        <div className="mod-row">
          <div className="mod-text">
            <div className="mod-title">Lobby</div>
            <div className="mod-sub">Only moderators get in; everyone else waits until you open it</div>
          </div>
          <Toggle
            on={lobbyOn}
            onChange={(on) =>
              void moderate(
                accountId,
                'Changing the lobby',
                () => talk(accountId).setLobby(token, on ? 1 : 0),
                on ? 'The lobby is on' : 'The lobby is off: everyone can join'
              )
            }
          />
        </div>
      )}
      {lobbyOn && (
        <label className="mod-sub-row">
          <span>Opens by itself at</span>
          <input
            className="input"
            type="datetime-local"
            value={room.lobbyTimer ? toLocalInput(room.lobbyTimer) : ''}
            onChange={(e) => {
              const at = fromLocalInput(e.target.value)
              void moderate(accountId, 'Setting the time', () => talk(accountId).setLobby(token, 1, at))
            }}
          />
        </label>
      )}

      {hasFeature(account, 'read-only-rooms') && (
        <div className="mod-row">
          <div className="mod-text">
            <div className="mod-title">Read-only</div>
            <div className="mod-sub">Nobody can write, react or start calls</div>
          </div>
          <Toggle
            on={room.readOnly === 1}
            onChange={(on) =>
              void moderate(accountId, 'Changing read-only', () =>
                talk(accountId).setReadOnly(token, on ? 1 : 0)
              )
            }
          />
        </div>
      )}

      {hasFeature(account, 'message-expiration') && (
        <label className="mod-row">
          <div className="mod-text">
            <div className="mod-title">Delete messages after</div>
            <div className="mod-sub">New messages disappear for everyone</div>
          </div>
          <select
            className="input small"
            value={
              EXPIRATION.some((x) => x.seconds === (room.messageExpiration ?? 0))
                ? (room.messageExpiration ?? 0)
                : ''
            }
            onChange={(e) =>
              void moderate(accountId, 'Changing message expiry', () =>
                talk(accountId).setMessageExpiration(token, Number(e.target.value))
              )
            }
          >
            {EXPIRATION.map((x) => (
              <option key={x.seconds} value={x.seconds}>
                {x.label}
              </option>
            ))}
            {!EXPIRATION.some((x) => x.seconds === (room.messageExpiration ?? 0)) && (
              <option value="">{Math.round((room.messageExpiration ?? 0) / 3600)} hours</option>
            )}
          </select>
        </label>
      )}

      {hasFeature(account, 'mention-permissions') && (
        <label className="mod-row">
          <div className="mod-text">
            <div className="mod-title">Who can mention @all</div>
          </div>
          <select
            className="input small"
            value={room.mentionPermissions ?? 0}
            onChange={(e) =>
              void moderate(accountId, 'Changing who can mention everyone', () =>
                talk(accountId).setMentionPermissions(token, Number(e.target.value) as 0 | 1)
              )
            }
          >
            <option value={0}>Everyone</option>
            <option value={1}>Moderators</option>
          </select>
        </label>
      )}

      {group && hasFeature(account, 'listable-rooms') && (
        <label className="mod-row">
          <div className="mod-text">
            <div className="mod-title">Who can find it</div>
            <div className="mod-sub">In “Browse channels”</div>
          </div>
          <select
            className="input small"
            value={room.listable ?? 0}
            onChange={(e) =>
              void moderate(accountId, 'Changing who can find it', () =>
                talk(accountId).setListable(token, Number(e.target.value) as 0 | 1 | 2)
              )
            }
          >
            <option value={0}>Only its members</option>
            <option value={1}>Everyone on the server</option>
            <option value={2}>Everyone, guests too</option>
          </select>
        </label>
      )}

      {call?.recording && call['recording-consent'] === 2 && (
        <div className="mod-row">
          <div className="mod-text">
            <div className="mod-title">Ask before recording</div>
            <div className="mod-sub">People agree to being recorded before they join a call</div>
          </div>
          <Toggle
            on={room.recordingConsent === 1}
            onChange={(on) =>
              void moderate(accountId, 'Changing recording consent', () =>
                talk(accountId).setRecordingConsent(token, on ? 1 : 0)
              )
            }
          />
        </div>
      )}

      <div className="mod-buttons">
        {hasFeature(account, 'conversation-permissions') && (
          <button className="btn btn-tertiary small" onClick={() => setEditing(true)}>
            <SlidersHorizontal size={14} /> What everyone can do…
          </button>
        )}
        {hasFeature(account, 'clear-history') && (
          <button
            className="btn btn-tertiary small danger"
            onClick={() => confirmClearHistory(accountId, token, room.displayName)}
          >
            <Trash2 size={14} /> Delete all messages…
          </button>
        )}
      </div>

      {hasFeature(account, 'ban-v1') && <BannedList accountId={accountId} token={token} />}

      {editing && (
        <PermissionsDialog
          account={account}
          title="What everyone can do"
          intro={`Applies to everyone in ${room.displayName} except moderators and people with their own settings.`}
          permissions={effective(room.defaultPermissions)}
          onClose={() => setEditing(false)}
          onSave={(bits) =>
            moderate(
              accountId,
              'Changing the permissions',
              () =>
                talk(accountId).setDefaultPermissions(
                  token,
                  bits === null || bits === ALL_PERMISSIONS ? 0 : bits | Permission.Custom
                ),
              'Permissions changed'
            )
          }
        />
      )}
    </div>
  )
}

function BannedList({ accountId, token }: { accountId: string; token: string }) {
  const [bans, setBans] = useState<Ban[] | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    talk(accountId)
      .bans(token)
      .then((b) => current && setBans(b))
      .catch(() => current && setBans([]))
    return () => {
      current = false
    }
  }, [accountId, token, tick])

  if (!bans?.length) return null
  return (
    <div className="mod-bans">
      <div className="mod-title">Banned</div>
      {bans.map((b) => (
        <div key={b.id} className="mod-ban">
          <BanIcon size={14} />
          <span className="mod-ban-name" title={b.internalNote || undefined}>
            {b.bannedDisplayName || b.bannedId}
            {b.internalNote && <span className="mod-sub"> · {b.internalNote}</span>}
          </span>
          <button
            className="btn btn-tertiary small"
            onClick={() =>
              void moderate(
                accountId,
                'Lifting the ban',
                () => talk(accountId).unban(token, b.id),
                'Ban lifted'
              ).then(() => setTick((t) => t + 1))
            }
          >
            Lift ban
          </button>
        </div>
      ))}
    </div>
  )
}

function PermissionsDialog({
  account,
  title,
  intro,
  permissions,
  allowDefault,
  onSave,
  onClose
}: {
  account: AccountState
  title: string
  intro: string
  permissions: number
  /** For one person: going back to what everyone can do */
  allowDefault?: boolean
  onSave: (bits: number | null) => Promise<boolean>
  onClose: () => void
}) {
  const [bits, setBits] = useState(permissions)
  const [saving, setSaving] = useState(false)
  const shown = PERMISSIONS.filter((p) => !p.feature || hasFeature(account, p.feature))
  const save = async (value: number | null): Promise<void> => {
    setSaving(true)
    const ok = await onSave(value)
    setSaving(false)
    if (ok) onClose()
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {allowDefault && (
            <button
              className="btn btn-tertiary status-clear-btn"
              disabled={saving}
              onClick={() => void save(null)}
            >
              Same as everyone
            </button>
          )}
          <button className="btn btn-tertiary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save(bits)}>
            Save
          </button>
        </>
      }
    >
      <p className="help" style={{ marginTop: 0 }}>
        {intro}
      </p>
      <div className="perm-list">
        {shown.map((p) => (
          <label key={p.bit} className="perm-row">
            <input
              type="checkbox"
              checked={(bits & p.bit) !== 0}
              onChange={(e) => setBits((b) => (e.target.checked ? b | p.bit : b & ~p.bit))}
            />
            {p.label}
          </label>
        ))}
      </div>
    </Modal>
  )
}

/** The "…" menu of a member, for moderators */
export function MemberActions({
  account,
  room,
  member,
  onChanged
}: {
  account: AccountState
  room: Room
  member: Participant
  onChanged: () => void
}) {
  const accountId = account.info.id
  const token = room.token
  const [menu, setMenu] = useState<Anchor | null>(null)
  const [dialog, setDialog] = useState<'permissions' | 'ban' | null>(null)
  const moderator = isModeratorType(member.participantType)
  const owner = member.participantType === 1
  const user = member.actorType === 'users'
  const name = member.displayName || member.actorId

  const act = (what: string, fn: () => Promise<unknown>, done?: string) => (): void => {
    setMenu(null)
    void moderate(accountId, what, fn, done).then((ok) => ok && onChanged())
  }

  return (
    <>
      <button
        className="icon-btn small"
        title="Moderate"
        onClick={(e) => setMenu(anchorFrom(e.currentTarget, 'right'))}
      >
        <MoreHorizontal size={16} />
      </button>
      {menu && (
        <Menu anchor={menu} onClose={() => setMenu(null)}>
          {!owner &&
            (user || member.actorType === 'guests' || member.actorType === 'emails') &&
            (moderator ? (
              <MenuItem
                icon={<ShieldOff size={18} />}
                label="Remove as moderator"
                onClick={act(
                  'Demoting',
                  () => talk(accountId).demoteModerator(token, member.attendeeId),
                  `${name} is no longer a moderator`
                )}
              />
            ) : (
              <MenuItem
                icon={<ShieldCheck size={18} />}
                label="Make moderator"
                onClick={act(
                  'Promoting',
                  () => talk(accountId).promoteModerator(token, member.attendeeId),
                  `${name} is now a moderator`
                )}
              />
            ))}
          {!moderator && hasFeature(account, 'conversation-permissions') && (
            <MenuItem
              icon={<SlidersHorizontal size={18} />}
              label="Permissions…"
              onClick={() => {
                setMenu(null)
                setDialog('permissions')
              }}
            />
          )}
          {!owner && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<UserMinus size={18} />}
                label="Remove from conversation"
                danger
                onClick={() => {
                  setMenu(null)
                  confirmRemove(accountId, token, member, onChanged)
                }}
              />
              {hasFeature(account, 'ban-v1') && !moderator && (
                <MenuItem
                  icon={<BanIcon size={18} />}
                  label="Ban…"
                  danger
                  onClick={() => {
                    setMenu(null)
                    setDialog('ban')
                  }}
                />
              )}
            </>
          )}
        </Menu>
      )}
      {dialog === 'permissions' && (
        <PermissionsDialog
          account={account}
          title={`What ${name} can do`}
          intro={`Instead of what everyone in ${room.displayName} can do.`}
          permissions={effective(member.attendeePermissions || room.defaultPermissions)}
          allowDefault
          onClose={() => setDialog(null)}
          onSave={(bits) =>
            moderate(
              accountId,
              'Changing the permissions',
              () =>
                talk(accountId).setAttendeePermissions(
                  token,
                  member.attendeeId,
                  bits === null ? 0 : bits | Permission.Custom
                ),
              'Permissions changed'
            ).then((ok) => {
              if (ok) onChanged()
              return ok
            })
          }
        />
      )}
      {dialog === 'ban' && (
        <BanDialog
          name={name}
          onClose={() => setDialog(null)}
          onBan={(note) =>
            moderate(
              accountId,
              'Banning',
              () => talk(accountId).ban(token, member.actorType, member.actorId, note),
              `${name} is banned`
            ).then((ok) => {
              if (ok) onChanged()
              return ok
            })
          }
        />
      )}
    </>
  )
}

function BanDialog({
  name,
  onBan,
  onClose
}: {
  name: string
  onBan: (note: string) => Promise<boolean>
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title={`Ban ${name}?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-tertiary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const ok = await onBan(note.trim())
              setBusy(false)
              if (ok) onClose()
            }}
          >
            Ban
          </button>
        </>
      }
    >
      <p className="help" style={{ marginTop: 0 }}>
        {name} is removed and can’t join again until a moderator lifts the ban.
      </p>
      <label className="field-label">Note for moderators (optional)</label>
      <input
        className="input"
        value={note}
        maxLength={4000}
        onChange={(e) => setNote(e.target.value)}
        autoFocus
      />
    </Modal>
  )
}
