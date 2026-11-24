import { useEffect, useState } from 'react'
import { BellRing, Check, X } from 'lucide-react'
import { RoomType, type Participant } from '@shared/talk-types'
import { addAndRing, inviteMode, moveCall, notInCall, ring } from '@renderer/calls/invite'
import type { Person } from '@renderer/lib/people'
import { useApp } from '@renderer/store/app'
import { updateCall, useCall } from '@renderer/store/call'
import { usePeopleSearch } from '@renderer/sync/people'
import { Avatar } from '../common/Avatar'

// "Add people" during a call: ring members who aren't in it, or bring in someone new.

const close = (): void => updateCall((c) => void (c.addPeople = false))

export function AddPeople() {
  const call = useCall((s) => s.active)
  const account = useApp((s) => (call ? s.accounts[call.accountId] : undefined))
  const room = call && account?.rooms[call.token]
  const selfId = account?.user?.id ?? ''
  const [members, setMembers] = useState<Participant[] | null>(null)
  const [rung, setRung] = useState<Set<number>>(new Set())
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Person[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { people } = usePeopleSearch(call?.accountId, query)

  const mode = account && room ? inviteMode(account, room) : 'move'
  const accountId = call?.accountId
  const token = call?.token
  useEffect(() => {
    if (!accountId || !token || mode !== 'add') return
    void notInCall(accountId, token, selfId)
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [accountId, token, mode, selfId])

  if (!call || !account || !room) return null
  const isPicked = (p: Person): boolean => picked.some((x) => x.id === p.id)
  const toggle = (p: Person): void => {
    setPicked((list) => (isPicked(p) ? list.filter((x) => x.id !== p.id) : [...list, p]))
    setQuery('')
  }
  const results = query
    ? people.filter((p) => p.id !== selfId && !members?.some((m) => m.actorId === p.id)).slice(0, 8)
    : []

  const submit = async (): Promise<void> => {
    if (!picked.length || busy) return
    setBusy(true)
    setError(null)
    const refs = picked.map((p) => ({ id: p.id, name: p.name }))
    try {
      if (mode === 'add') await addAndRing(call.accountId, room, refs)
      else await moveCall(call.accountId, call.token, selfId, refs)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="sp-backdrop" onClick={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div
        className="sp-dialog ap-dialog"
        role="dialog"
        aria-label="Add people"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sp-header">
          <h2>Add people to the call</h2>
          <button className="sp-close" title="Close" onClick={close}>
            <X size={18} />
          </button>
        </div>

        <div className="ap-body">
          {error && <div className="error-box">{error}</div>}

          {mode === 'add' && (
            <>
              <div className="ap-label">In this conversation, not in the call</div>
              {members === null && <div className="ap-empty">Loading…</div>}
              {members?.length === 0 && <div className="ap-empty">Everyone is already in the call</div>}
              {members?.map((m) => (
                <div key={m.attendeeId} className="ap-row">
                  <Avatar accountId={call.accountId} userId={m.actorId} name={m.displayName} size={28} />
                  <span className="ap-name">{m.displayName}</span>
                  <button
                    className="btn btn-tertiary small"
                    disabled={rung.has(m.attendeeId)}
                    onClick={() =>
                      void ring(call.accountId, call.token, m.attendeeId)
                        .then(() => setRung((s) => new Set(s).add(m.attendeeId)))
                        .catch((err) => setError(String(err?.message ?? err)))
                    }
                  >
                    {rung.has(m.attendeeId) ? <Check size={14} /> : <BellRing size={14} />}
                    {rung.has(m.attendeeId) ? 'Ringing' : 'Ring'}
                  </button>
                </div>
              ))}
            </>
          )}

          {mode === 'none' && (
            <p className="ap-note">
              Only moderators can add people to this conversation and ring them. Ask a moderator, or start a
              new call with the people you need from the + menu.
            </p>
          )}
          {mode !== 'none' && (
            <div className="ap-label">{mode === 'add' ? 'Someone else' : 'Who should join?'}</div>
          )}
          {mode === 'move' && (
            <p className="ap-note">
              {room.type === RoomType.OneToOne
                ? 'A one-to-one call can’t take more people, so the call moves to a group message with everyone.'
                : 'The call moves to a group message with everyone in it now and the people you add.'}{' '}
              Your microphone, camera and screen sharing carry over, and the others are rung there.
            </p>
          )}
          {mode !== 'none' && (
            <>
              <div className="people-input">
                {picked.map((p) => (
                  <span key={p.id} className="people-chip">
                    <Avatar accountId={call.accountId} userId={p.id} name={p.name} size={20} />
                    {p.name}
                    <button title={`Remove ${p.name}`} onClick={() => toggle(p)}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <input
                  autoFocus
                  placeholder="Search by name, username or e-mail"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && results[0]) toggle(results[0])
                    else if (e.key === 'Enter' && !query) void submit()
                    else if (e.key === 'Backspace' && !query) setPicked((l) => l.slice(0, -1))
                  }}
                />
              </div>
              {results.map((p) => (
                <button key={p.id} className="ap-row ap-result" onClick={() => toggle(p)}>
                  <Avatar accountId={call.accountId} userId={p.id} name={p.name} size={28} />
                  <span className="ap-name">{p.name}</span>
                  {isPicked(p) && <Check size={16} className="lr-check" />}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="sp-footer">
          <span className="sp-tip" />
          <button className="btn btn-tertiary" onClick={close}>
            Close
          </button>
          {mode !== 'none' && (
            <button
              className="btn btn-primary"
              disabled={!picked.length || busy}
              onClick={() => void submit()}
            >
              {mode === 'add' ? 'Add and ring' : 'Move the call'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
