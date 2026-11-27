import { useEffect, useRef, useState } from 'react'
import { Pipette } from 'lucide-react'

// A row of color swatches with a last one for any other color: it opens the system color picker,
// and a hex field next to it takes a color pasted from elsewhere.

const HEX = /^#?([0-9a-f]{6})$/i

interface Props {
  colors: string[]
  value: string
  onChange: (color: string) => void
}

export function ColorPicker({ colors, value, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const current = value.toLowerCase()
  const custom = !colors.some((c) => c.toLowerCase() === current)
  const [draft, setDraft] = useState(current)
  // The field follows a color picked another way
  useEffect(() => setDraft(current), [current])

  return (
    <div className="color-row">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          className={`color-swatch${c.toLowerCase() === current ? ' selected' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c.toLowerCase())}
          aria-label={c}
        />
      ))}
      <button
        type="button"
        className={`color-swatch color-custom${custom ? ' selected' : ''}`}
        style={custom ? { background: current } : undefined}
        title="Another color…"
        aria-label="Another color"
        onClick={() => input.current?.click()}
      >
        {!custom && <Pipette size={14} />}
      </button>
      <input
        ref={input}
        type="color"
        className="color-native"
        tabIndex={-1}
        aria-hidden
        value={HEX.test(current) ? current : '#000000'}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
      />
      {custom && (
        <input
          className="input color-hex"
          value={draft}
          spellCheck={false}
          maxLength={7}
          aria-label="Color as hex"
          onChange={(e) => {
            setDraft(e.target.value)
            const m = HEX.exec(e.target.value.trim())
            if (m) onChange(`#${m[1].toLowerCase()}`)
          }}
          onBlur={() => setDraft(current)}
        />
      )}
    </div>
  )
}
