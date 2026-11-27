import { Brain, Copy, Save } from 'lucide-react'
import { media } from '@shared/ipc'
import { assistant } from '@renderer/api/assistant'
import type { AiTask } from '@renderer/api/talk'
import { cleanAiOutput } from '@renderer/lib/ai-output'
import type { Shape, TaskType } from '@renderer/lib/ai-tasks'
import { setApp, showToast } from '@renderer/store/app'
import { copyText } from '@renderer/sync/actions'
import { aiErrorText } from '@renderer/sync/ai'
import { MessageText } from '../channel/MessageText'

// What a finished AI task gave: text (shown as formatted text), images, speech or other files, by
// the task type's output shape.

const ids = (value: unknown): number[] =>
  (Array.isArray(value) ? value : [value]).map(Number).filter((n) => Number.isInteger(n) && n > 0)

export function TaskOutput({
  accountId,
  task,
  type,
  canSave
}: {
  accountId: string
  task: AiTask
  type: TaskType | undefined
  /** The Assistant can save files a task made into your files */
  canSave: boolean
}) {
  const output = task.output ?? {}
  const shapes: [string, Shape][] = type
    ? Object.entries(type.outputShape)
    : Object.keys(output).map((k) => [
        k,
        { name: k, description: '', type: typeof output[k] === 'string' ? 'Text' : 'File' }
      ])
  const reasoning = typeof output.reasoning === 'string' ? output.reasoning.trim() : ''

  const save = async (fileId: number): Promise<void> => {
    try {
      const path = await assistant(accountId).saveOutputFile(task.id, fileId)
      showToast(path ? `Saved to ${path.replace(/^\/[^/]+\/files/, '')}` : 'Saved to your files')
    } catch (err) {
      showToast(`Couldn’t save it: ${aiErrorText(err)}`, 'error')
    }
  }

  return (
    <div className="ai-output">
      {reasoning && (
        <details className="ai-reasoning">
          <summary>
            <Brain size={13} /> How it thought about it
          </summary>
          <div>{reasoning}</div>
        </details>
      )}
      {shapes.map(([key, shape]) => {
        const value = output[key]
        if (value === undefined || value === null || value === '') return null
        const label = shapes.length > 1 ? <div className="ai-output-label">{shape.name}</div> : null
        if (shape.type === 'Text' || shape.type === 'Number') {
          const text = typeof value === 'string' ? cleanAiOutput(value) : String(value)
          return (
            <div key={key} className="ai-output-part">
              {label}
              <MessageText markdown={text} className="ai-output-text" />
              <div className="ai-output-actions">
                <button className="btn btn-tertiary small" onClick={() => void copyText(text, 'Copied')}>
                  <Copy size={14} /> Copy
                </button>
              </div>
            </div>
          )
        }
        if (shape.type === 'ListOfText' && Array.isArray(value)) {
          return (
            <div key={key} className="ai-output-part">
              {label}
              <ul className="ai-output-list">
                {value.map((v, i) => (
                  <li key={i}>{String(v)}</li>
                ))}
              </ul>
            </div>
          )
        }
        const files = ids(value)
        const image = /Image/.test(shape.type)
        const audio = /Audio/.test(shape.type)
        return (
          <div key={key} className="ai-output-part">
            {label}
            <div className={image ? 'ai-output-images' : 'ai-output-files'}>
              {files.map((fileId) => {
                const src = media.taskFile(accountId, task.id, fileId)
                return (
                  <div key={fileId} className="ai-output-file">
                    {image ? (
                      <img
                        src={src}
                        alt={shape.name}
                        onClick={() => setApp({ modal: { type: 'image', src, name: shape.name } })}
                      />
                    ) : audio ? (
                      <audio controls src={src} />
                    ) : (
                      <span className="ai-output-filename">{shape.name}</span>
                    )}
                    {canSave && (
                      <button className="btn btn-tertiary small" onClick={() => void save(fileId)}>
                        <Save size={14} /> Save to Nextcloud
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
