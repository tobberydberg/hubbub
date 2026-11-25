import { useEffect, useState } from 'react'
import { Languages, Wand2 } from 'lucide-react'
import { usePrefs } from '@renderer/store/prefs'
import {
  aiTaskTypes,
  canTranslate,
  preferredTarget,
  REWRITES,
  translationTargets,
  type Language
} from '@renderer/sync/ai'
import { anchorFrom, Menu, MenuItem, MenuSeparator, MenuTitle, type Anchor } from '../common/Menu'

// Writing help in the message box, by the server's AI: rephrase, simplify or make the draft more
// formal, or translate it. Shown only when the server's AI can do at least one of these.

export type WritingJob =
  { kind: 'rewrite'; type: string; label: string } | { kind: 'translate'; to: Language }

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
  const [menu, setMenu] = useState<Anchor | null>(null)
  const [pickLanguage, setPickLanguage] = useState(false)
  const chosen = usePrefs((s) => s.translateTo)

  useEffect(() => {
    let current = true
    void aiTaskTypes(accountId).then(
      (types) => current && setRewrites(REWRITES.filter((r) => r.type in types))
    )
    if (canTranslate(accountId)) {
      void translationTargets(accountId)
        .then((l) => current && setLanguages(l))
        .catch(() => undefined)
    }
    return () => {
      current = false
    }
  }, [accountId])

  if (!rewrites.length && !languages.length) return null
  const preferred = languages.find((l) => l.id === preferredTarget(languages, chosen))
  const close = (): void => {
    setMenu(null)
    setPickLanguage(false)
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
          {pickLanguage ? (
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
                    onRun({ kind: 'rewrite', type: r.type, label: r.label })
                  }}
                />
              ))}
              {languages.length > 0 && (
                <>
                  {rewrites.length > 0 && <MenuSeparator />}
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
                    onClick={() => setPickLanguage(true)}
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
