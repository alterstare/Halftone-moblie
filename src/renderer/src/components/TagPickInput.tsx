import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

// Single-value text input with an app-styled tag autocomplete (like the search
// box, but picking replaces the whole value instead of the last word). Used for
// the genre-rule name field and the favorite / exclude tag lists.
export default function TagPickInput({
  value,
  onChange,
  tokens,
  fetchTokens,
  placeholder,
  className,
  onEnter
}: {
  value: string
  onChange: (v: string) => void
  tokens: string[]
  // Extra suggestions fetched async (doujin: the site's tag index), so tags no
  // local work carries yet (e.g. male:…) are offered too.
  fetchTokens?: (query: string) => Promise<string[]>
  placeholder?: string
  className?: string
  // Fires when Enter is pressed WITHOUT an active autocomplete highlight — used by
  // list inputs (favorite/exclude tags) to commit the typed value.
  onEnter?: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const [remote, setRemote] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  const q = value.trim().toLowerCase()
  // Debounced, latest-wins.
  useEffect(() => {
    if (!fetchTokens || !q) {
      setRemote([])
      return
    }
    const id = ++seq.current
    const timer = setTimeout(() => {
      fetchTokens(q)
        .then((r) => id === seq.current && setRemote(r))
        .catch(() => id === seq.current && setRemote([]))
    }, 140)
    return () => clearTimeout(timer)
  }, [fetchTokens, q])

  const local = q ? tokens.filter((t) => t.toLowerCase().includes(q) && t.toLowerCase() !== q) : []
  const matches = [...new Set([...local, ...remote])].filter((t) => t.toLowerCase() !== q).slice(0, 12)
  const show = open && matches.length > 0

  const pick = (tok: string): void => {
    onChange(tok)
    setOpen(false)
    setHi(-1)
    inputRef.current?.focus()
  }

  return (
    <div className="search-ac">
      {/* A form: the phone keyboard's action key (shown as 완료 via
          enterKeyHint) submits it — without one, a following field turned it
          into "다음", which only moved the focus and never added the tag. */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!onEnter) return
          setOpen(false)
          onEnter()
        }}
      >
        <input
          ref={inputRef}
          type="text"
          className={className}
          value={value}
          placeholder={placeholder}
          enterKeyHint={onEnter ? 'done' : undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
            setHi(-1)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (show && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              setHi((h) => {
                const n = matches.length
                return e.key === 'ArrowDown' ? (h + 1) % n : (h - 1 + n) % n
              })
              return
            }
            if (e.key === 'Escape') {
              setOpen(false)
              setHi(-1)
              return
            }
            if (e.key === 'Enter' && show && hi >= 0) {
              e.preventDefault()
              pick(matches[hi])
            }
            // Otherwise Enter submits the form → onEnter.
          }}
        />
      </form>
      {show && (
        <ul className="search-ac-list">
          {matches.map((t, i) => (
            <li
              key={t}
              className={i === hi ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(t)
              }}
              onMouseEnter={() => setHi(i)}
            >
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
