import { useCallback, useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { talk, type Poll } from '@renderer/api/talk'
import { showToast, useApp } from '@renderer/store/app'

// A Talk poll in the chat: vote, then see the results (or wait for them when they are hidden until
// the poll closes). Refreshes while open.

const REFRESH = 15_000

export function PollCard(props: {
  accountId: string
  token: string
  pollId: string
  name: string
  canClose: boolean
}) {
  const { accountId, token, pollId } = props
  const selfId = useApp((s) => s.accounts[accountId]?.user?.id)
  const [poll, setPoll] = useState<Poll | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      talk(accountId)
        .poll(token, pollId)
        .then(setPoll)
        .catch(() => undefined),
    [accountId, token, pollId]
  )
  useEffect(() => {
    void load()
  }, [load])
  const open = poll?.status === 0
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => void load(), REFRESH)
    return () => clearInterval(t)
  }, [open, load])

  if (!poll) {
    return (
      <div className="poll-card loading">
        <BarChart3 size={16} /> {props.name}
      </div>
    )
  }

  const voted = (poll.votedSelf?.length ?? 0) > 0
  const voting = open && (!voted || changing)
  const multiple = poll.maxVotes !== 1
  const total = Object.values(poll.votes ?? {}).reduce((a, b) => a + b, 0)
  const showResults = !voting && poll.votes !== undefined && (poll.resultMode === 0 || !open)
  const isOwner = poll.actorType === 'users' && poll.actorId === selfId

  const toggle = (i: number): void =>
    setPicked((p) => (multiple ? (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]) : [i]))

  const act = async (fn: () => Promise<Poll>): Promise<void> => {
    setBusy(true)
    try {
      setPoll(await fn())
      setChanging(false)
      setPicked([])
    } catch (err) {
      showToast(`Poll: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`poll-card${open ? '' : ' closed'}`}>
      <div className="poll-question">
        <BarChart3 size={16} /> {poll.question}
      </div>
      <div className="poll-meta">
        {open ? (multiple ? 'Pick one or more' : 'Pick one') : 'Poll closed'}
        {poll.numVoters !== undefined && ` · ${poll.numVoters} ${poll.numVoters === 1 ? 'vote' : 'votes'}`}
        {poll.resultMode === 1 && open && ' · results when closed'}
      </div>
      <div className="poll-options">
        {poll.options.map((option, i) => {
          const count = poll.votes?.[`option-${i}`] ?? 0
          const percent = total ? Math.round((count / total) * 100) : 0
          const mine = poll.votedSelf?.includes(i)
          if (voting) {
            return (
              <label key={i} className="poll-option">
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name={`poll-${pollId}`}
                  checked={picked.includes(i)}
                  onChange={() => toggle(i)}
                />
                {option}
              </label>
            )
          }
          return (
            <div key={i} className={`poll-result${mine ? ' mine' : ''}`}>
              <div className="poll-result-row">
                <span>
                  {option}
                  {mine && ' ✓'}
                </span>
                {showResults && <span className="poll-percent">{percent}%</span>}
              </div>
              {showResults && (
                <span className="poll-bar">
                  <span style={{ width: `${percent}%` }} />
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="poll-actions">
        {voting && (
          <button
            className="btn btn-primary small"
            disabled={!picked.length || busy}
            onClick={() => void act(() => talk(accountId).vote(token, pollId, picked))}
          >
            Vote
          </button>
        )}
        {open && voted && !changing && (
          <button className="btn btn-tertiary small" onClick={() => setChanging(true)}>
            Change vote
          </button>
        )}
        {open && (isOwner || props.canClose) && (
          <button
            className="btn btn-tertiary small"
            disabled={busy}
            onClick={() => void act(() => talk(accountId).closePoll(token, pollId))}
          >
            End poll
          </button>
        )}
      </div>
    </div>
  )
}
