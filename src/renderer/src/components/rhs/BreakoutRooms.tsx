import { useEffect, useMemo, useState } from 'react'
import { DoorOpen, LifeBuoy, Megaphone, Play, Square, Trash2, Undo2, Users } from 'lucide-react'
import type { Participant, Room } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { startCall } from '@renderer/calls/call'
import { setApp, showToast, useApp, type AccountState } from '@renderer/store/app'
import { useCall } from '@renderer/store/call'
import { openRoom } from '@renderer/sync/actions'
import { canModerate, moderate } from '@renderer/sync/moderation'
import { Modal } from '../common/Modal'

// Breakout rooms: a moderator splits a conversation's call into smaller rooms for a while. Talk
// creates a conversation per room (listed under the main one, not in the sidebar), and moves people
// in a call to their room when the rooms start and back when they stop.

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The breakout rooms of a conversation you're in */
export function useBreakoutRooms(accountId: string, token: string): Room[] {
  const rooms = useApp((s) => s.accounts[accountId]?.rooms)
  return useMemo(
    () =>
      Object.values(rooms ?? {})
        .filter((r) => r.objectType === 'room' && r.objectId === token)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true })),
    [rooms, token]
  )
}

/** Opens a breakout room, and moves a running call there */
async function goTo(accountId: string, parent: Room, target: Room): Promise<void> {
  try {
    // In free mode people choose their room themselves
    if (parent.breakoutRoomMode === 3 && !canModerate(parent)) {
      await talk(accountId).switchBreakoutRoom(parent.token, target.token)
    }
    openRoom(accountId, target.token)
    const call = useCall.getState().active
    if (call?.accountId === accountId && (call.token === parent.token || call.token !== target.token)) {
      await startCall(accountId, target.token)
    }
  } catch (err) {
    showToast(`You couldn’t go to ${target.displayName}: ${errorText(err)}`, 'error')
  }
}

/** Above the chat: breakout rooms are open (in the main conversation), or you're in one */
export function BreakoutBanner({ account, room }: { account: AccountState; room: Room }) {
  const accountId = account.info.id
  const children = useBreakoutRooms(accountId, room.token)
  const parent = useApp((s) =>
    room.objectType === 'room' && room.objectId ? s.accounts[accountId]?.rooms[room.objectId] : undefined
  )

  if (room.objectType === 'room') {
    const helpAsked = room.breakoutRoomStatus === 2
    return (
      <div className="breakout-banner">
        <DoorOpen size={18} />
        <span className="breakout-text">
          Breakout room{parent ? ` of ${parent.displayName}` : ''}
          {helpAsked && <span className="breakout-help"> · You asked for help</span>}
        </span>
        <button
          className="ev-btn light"
          onClick={() =>
            void moderate(accountId, helpAsked ? 'Withdrawing the request' : 'Asking for help', () =>
              talk(accountId).requestAssistance(room.token, !helpAsked)
            )
          }
        >
          <LifeBuoy size={15} /> {helpAsked ? 'Never mind' : 'Ask for help'}
        </button>
        {parent && (
          <button className="ev-btn light" onClick={() => void goBack(accountId, parent, room)}>
            <Undo2 size={15} /> Back to {parent.displayName}
          </button>
        )}
      </div>
    )
  }

  if (!room.breakoutRoomMode || room.breakoutRoomStatus !== 1 || !children.length) return null
  const moderator = canModerate(room)
  const help = children.filter((c) => c.breakoutRoomStatus === 2)
  return (
    <div className="breakout-banner">
      <DoorOpen size={18} />
      <span className="breakout-text">
        Breakout rooms are open
        {moderator && help.length > 0 && (
          <span className="breakout-help"> · {help.map((h) => h.displayName).join(', ')} asked for help</span>
        )}
      </span>
      {(moderator ? (help.length ? help : children.slice(0, 3)) : children).map((c) => (
        <button key={c.token} className="ev-btn" onClick={() => void goTo(accountId, room, c)}>
          Go to {c.displayName}
        </button>
      ))}
      {moderator && (
        <button
          className="ev-btn light"
          onClick={() => setApp({ rhs: { type: 'info', accountId, token: room.token } })}
        >
          Manage
        </button>
      )}
    </div>
  )
}

async function goBack(accountId: string, parent: Room, room: Room): Promise<void> {
  openRoom(accountId, parent.token)
  const call = useCall.getState().active
  if (call?.accountId === accountId && call.token === room.token) await startCall(accountId, parent.token)
}

/** The moderator's breakout rooms, in the Info panel */
export function BreakoutSection({ account, room }: { account: AccountState; room: Room }) {
  const accountId = account.info.id
  const token = room.token
  const children = useBreakoutRooms(accountId, token)
  const [people, setPeople] = useState<(Participant & { roomToken: string })[]>([])
  const [dialog, setDialog] = useState<'create' | 'broadcast' | null>(null)
  const configured = !!room.breakoutRoomMode
  const started = room.breakoutRoomStatus === 1

  useEffect(() => {
    if (!configured) return
    let current = true
    const load = (): void =>
      void talk(accountId)
        .breakoutParticipants(token)
        .then((p) => current && setPeople(p))
        .catch(() => undefined)
    load()
    const t = setInterval(load, 10_000)
    return () => {
      current = false
      clearInterval(t)
    }
  }, [accountId, token, configured, started])

  return (
    <div className="info-block moderation">
      <div className="label">
        <DoorOpen size={12} /> Breakout rooms
      </div>
      {!configured ? (
        <>
          <p className="mod-sub" style={{ margin: '0 0 8px' }}>
            Split the call into smaller groups for a while. Everyone comes back when you close them.
          </p>
          <button className="btn btn-tertiary small" onClick={() => setDialog('create')}>
            <Users size={14} /> Set up breakout rooms…
          </button>
        </>
      ) : (
        <>
          <div className="breakout-list">
            {children.map((c) => {
              const inRoom = people.filter((p) => p.roomToken === c.token)
              return (
                <div key={c.token} className="breakout-room">
                  <div className="breakout-room-head">
                    <span className="mod-title">{c.displayName}</span>
                    {c.breakoutRoomStatus === 2 && (
                      <span className="breakout-help">
                        <LifeBuoy size={12} /> Asks for help
                      </span>
                    )}
                    <button className="link-btn" onClick={() => void goTo(accountId, room, c)}>
                      Join
                    </button>
                  </div>
                  <div className="mod-sub">
                    {inRoom.length ? inRoom.map((p) => p.displayName || p.actorId).join(', ') : 'Nobody yet'}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mod-buttons">
            {started ? (
              <button
                className="btn btn-tertiary small"
                onClick={() =>
                  void moderate(
                    accountId,
                    'Closing the rooms',
                    () => talk(accountId).stopBreakoutRooms(token),
                    'Everyone is back'
                  )
                }
              >
                <Square size={14} /> Close the rooms
              </button>
            ) : (
              <button
                className="btn btn-primary small"
                onClick={() =>
                  void moderate(
                    accountId,
                    'Opening the rooms',
                    () => talk(accountId).startBreakoutRooms(token),
                    'The breakout rooms are open'
                  )
                }
              >
                <Play size={14} /> Open the rooms
              </button>
            )}
            {started && (
              <button className="btn btn-tertiary small" onClick={() => setDialog('broadcast')}>
                <Megaphone size={14} /> Message all rooms…
              </button>
            )}
            {!started && (
              <button
                className="btn btn-tertiary small danger"
                onClick={() =>
                  void moderate(
                    accountId,
                    'Removing the rooms',
                    () => talk(accountId).removeBreakoutRooms(token),
                    'Breakout rooms removed'
                  )
                }
              >
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>
        </>
      )}
      {dialog === 'create' && (
        <CreateDialog accountId={accountId} token={token} onClose={() => setDialog(null)} />
      )}
      {dialog === 'broadcast' && (
        <BroadcastDialog accountId={accountId} token={token} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

function CreateDialog({
  accountId,
  token,
  onClose
}: {
  accountId: string
  token: string
  onClose: () => void
}) {
  const [amount, setAmount] = useState(2)
  const [mode, setMode] = useState<1 | 3>(1)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title="Set up breakout rooms"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-tertiary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || amount < 1 || amount > 20}
            onClick={async () => {
              setBusy(true)
              const ok = await moderate(
                accountId,
                'Setting up the rooms',
                () => talk(accountId).configureBreakoutRooms(token, mode, amount),
                `${amount} breakout rooms are ready; open them when you like`
              )
              setBusy(false)
              if (ok) onClose()
            }}
          >
            Create rooms
          </button>
        </>
      }
    >
      <label className="field-label">Number of rooms</label>
      <input
        className="input"
        type="number"
        min={1}
        max={20}
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
      />
      <label className="field-label">Who goes where</label>
      <div className="perm-list">
        <label className="perm-row">
          <input type="radio" checked={mode === 1} onChange={() => setMode(1)} />
          Spread everyone evenly, automatically
        </label>
        <label className="perm-row">
          <input type="radio" checked={mode === 3} onChange={() => setMode(3)} />
          Let people choose their room
        </label>
      </div>
    </Modal>
  )
}

function BroadcastDialog({
  accountId,
  token,
  onClose
}: {
  accountId: string
  token: string
  onClose: () => void
}) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title="Message all breakout rooms"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-tertiary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !message.trim()}
            onClick={async () => {
              setBusy(true)
              const ok = await moderate(
                accountId,
                'Sending the message',
                () => talk(accountId).broadcastToBreakoutRooms(token, message.trim()),
                'Sent to every room'
              )
              setBusy(false)
              if (ok) onClose()
            }}
          >
            Send
          </button>
        </>
      }
    >
      <textarea
        className="input"
        rows={3}
        autoFocus
        placeholder="For example: 5 minutes left"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
    </Modal>
  )
}
