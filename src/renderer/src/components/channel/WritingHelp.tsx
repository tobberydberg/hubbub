import { useEffect, useState } from 'react'
import { Languages, MessageSquareQuote, Wand2 } from 'lucide-react'
import { usePrefs } from '@renderer/store/prefs'
import {
  aiTaskTypes,
  canTranslate,
  preferredTarget,
  REWRITES,
  rewriteTones,
  translationTargets,
  type Language
} from '@renderer/sync/ai'
import { anchorFrom, Menu, MenuItem, MenuSeparator, MenuTitle, type Anchor } from '../common/Menu'

// Writing help in the message box, by the server's AI: rephrase, simplify or make the draft more
// formal, change its tone, or translate it. Shown only when the server's AI can do one of these.

export type WritingJob =
  | {
      kind: 'rewrite'
      type: string
      /** What it says while working ("Rephrasing") and after ("Rephrased") */
      busy: string
      done: string
      /** More input for the task, such as the tone */
      extra?: Record<string, unknown>
    }
  | { kind: 'translate'; to: Language }

export function WritingHelp({
  accountId,
  disabled,
  onRun
}: {
  accountId: string
  disabled: boolean
  onRun: (job: WritingJob) => void
}) {
  const [rewrites, setRewrites] = useState<typeof REWRITES>([])
  const [languages, setLanguages] = useState<Language[]>([])
  const [tones, setTones] = useState<{ name: string; value: string }[]>([])
  const [menu, setMenu] = useState<Anchor | null>(null)
  const [pick, setPick] = useState<'language' | 'tone' | null>(null)
  const chosen = usePrefs((s) => s.translateTo)

  useEffect(() => {
    let current = true
    void aiTaskTypes(accountId).then(
      (types) => current && setRewrites(REWRITES.filter((r) => r.type in types))
    )
    void rewriteTones(accountId).then((t) => current && setTones(t))
    if (canTranslate(accountId)) {
      void translationTargets(accountId)
        .then((l) => current && setLanguages(l))
        .catch(() => undefined)
    }
    return () => {
      current = false
    }
  }, [accountId])

  if (!rewrites.length && !tones.length && !languages.length) return null
  const preferred = languages.find((l) => l.id === preferredTarget(languages, chosen))
  const close = (): void => {
    setMenu(null)
    setPick(null)
  }

  return (
    <>
      <button
        className={`icon-btn small${menu ? ' active' : ''}`}
        title={disabled ? 'Write something first' : 'Writing help (AI)'}
        disabled={disabled}
        onClick={(e) => setMenu(anchorFrom(e.currentTarget))}
      >
        <Wand2 size={16} />
      </button>
      {menu && (
        <Menu anchor={menu} onClose={close}>
          {pick === 'tone' ? (
            <>
              <MenuTitle>Change the tone</MenuTitle>
              {tones.map((t) => (
                <MenuItem
                  key={t.value}
                  label={t.name}
                  onClick={() => {
                    close()
                    const how = t.name.toLowerCase()
                    onRun({
                      kind: 'rewrite',
                      type: 'core:text2text:changetone',
                      busy: `Rewriting it ${how}`,
                      done: `Rewritten ${how}`,
                      extra: { tone: t.value }
                    })
                  }}
                />
              ))}
            </>
          ) : pick === 'language' ? (
            <>
              <MenuTitle>Translate to</MenuTitle>
              {languages.map((l) => (
                <MenuItem
                  key={l.id}
                  label={l.name}
                  checked={l.id === preferred?.id}
                  onClick={() => {
                    close()
                    usePrefs.getState().set({ translateTo: l.id })
                    onRun({ kind: 'translate', to: l })
                  }}
                />
              ))}
            </>
          ) : (
            <>
              <MenuTitle>Writing help</MenuTitle>
              {rewrites.map((r) => (
                <MenuItem
                  key={r.type}
                  icon={<Wand2 size={18} />}
                  label={r.label}
                  onClick={() => {
                    close()
                    onRun({ kind: 'rewrite', type: r.type, busy: r.busy, done: r.done })
                  }}
                />
              ))}
              {tones.length > 0 && (
                <MenuItem
                  icon={<MessageSquareQuote size={18} />}
                  label="Change the tone…"
                  onClick={() => setPick('tone')}
                />
              )}
              {languages.length > 0 && (
                <>
                  {(rewrites.length > 0 || tones.length > 0) && <MenuSeparator />}
                  {preferred && (
                    <MenuItem
                      icon={<Languages size={18} />}
                      label={`Translate to ${preferred.name}`}
                      onClick={() => {
                        close()
                        onRun({ kind: 'translate', to: preferred })
                      }}
                    />
                  )}
                  <MenuItem
                    icon={<Languages size={18} />}
                    label="Translate to…"
                    onClick={() => setPick('language')}
                  />
                </>
              )}
            </>
          )}
        </Menu>
      )}
    </>
  )
}
