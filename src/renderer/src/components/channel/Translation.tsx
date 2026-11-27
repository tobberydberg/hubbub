import { useEffect, useState } from 'react'
import { Languages, X } from 'lucide-react'
import { usePrefs } from '@renderer/store/prefs'
import {
  aiErrorText,
  preferredTarget,
  translateText,
  translationTargets,
  type Language
} from '@renderer/sync/ai'

// A message translated by the server (its translation app or its AI), under the original, with
// the language to translate to.

export function Translation({
  accountId,
  text,
  onClose
}: {
  accountId: string
  text: string
  onClose: () => void
}) {
  const chosen = usePrefs((s) => s.translateTo)
  const [languages, setLanguages] = useState<Language[] | null>(null)
  const [to, setTo] = useState<string | undefined>()
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    translationTargets(accountId)
      .then((l) => {
        if (!current) return
        setLanguages(l)
        setTo(preferredTarget(l, chosen))
      })
      .catch((err: unknown) => current && setError(aiErrorText(err)))
    return () => {
      current = false
    }
    // The chosen language only matters for the first pick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  useEffect(() => {
    if (!to) return
    const abort = new AbortController()
    setResult(null)
    setError(null)
    translateText(accountId, text, to, { signal: abort.signal })
      .then((t) => !abort.signal.aborted && setResult(t))
      .catch((err: unknown) => !abort.signal.aborted && setError(aiErrorText(err)))
    return () => abort.abort()
  }, [accountId, text, to])

  return (
    <div className="translation">
      <div className="translation-head">
        <Languages size={14} />
        <span>Translated to</span>
        <select
          value={to ?? ''}
          disabled={!languages?.length}
          onChange={(e) => {
            setTo(e.target.value)
            usePrefs.getState().set({ translateTo: e.target.value })
          }}
        >
          {(languages ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button className="icon-btn small" title="Hide the translation" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="translation-text">
        {error ? (
          <span className="translation-error">{error}</span>
        ) : (
          (result ?? <span className="translation-wait">Translating…</span>)
        )}
      </div>
    </div>
  )
}
