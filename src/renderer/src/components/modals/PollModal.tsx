import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { talk } from '@renderer/api/talk'
import { setApp, type ModalState } from '@renderer/store/app'
import { Modal, Toggle } from '../common/Modal'

const close = (): void => setApp({ modal: null })
const MAX_OPTIONS = 20

export function PollModal({ modal }: { modal: Extract<ModalState, { type: 'poll' }> }) {
  const [question, setQuestion] = useState(modal.question ?? '')
  const [options, setOptions] = useState(['', ''])
  const [multiple, setMultiple] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filled = options.map((o) => o.trim()).filter(Boolean)
  const valid = question.trim() && filled.length >= 2

  const create = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    try {
      await talk(modal.accountId).createPoll(modal.token, {
        question: question.trim(),
        options: filled,
        resultMode: hidden ? 1 : 0,
        maxVotes: multiple ? 0 : 1,
        threadId: modal.threadId
      })
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Create a poll"
      onClose={close}
      footer={
        <>
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void create()}>
            Create poll
          </button>
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}
      <label className="field-label">Question</label>
      <input
        className="input"
        autoFocus
        value={question}
        placeholder="What should we…?"
        onChange={(e) => setQuestion(e.target.value)}
      />
      <label className="field-label">Answers</label>
      <div className="poll-options-edit">
        {options.map((o, i) => (
          <div key={i} className="poll-option-edit">
            <input
              className="input"
              value={o}
              placeholder={`Answer ${i + 1}`}
              onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && i === options.length - 1 && options.length < MAX_OPTIONS) {
                  setOptions((list) => [...list, ''])
                }
              }}
            />
            {options.length > 2 && (
              <button
                className="icon-btn small"
                title="Remove this answer"
                onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <button className="btn-link" onClick={() => setOptions((list) => [...list, ''])}>
            <Plus size={14} /> Add an answer
          </button>
        )}
      </div>
      <div className="poll-settings">
        <label>
          <Toggle on={multiple} onChange={setMultiple} /> Allow several answers
        </label>
        <label>
          <Toggle on={hidden} onChange={setHidden} /> Hide results until the poll is closed
        </label>
      </div>
    </Modal>
  )
}
