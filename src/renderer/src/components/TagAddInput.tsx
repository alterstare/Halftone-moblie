import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'

// Inline "add a tag to this work" input (cards, series cards, chapter rows)
// with autocomplete: the tags of the current library's works, plus — in the
// doujin library — the site's tag index (so tags no local work has yet, e.g.
// male:…, are offered too). The list is portaled under the input so a card's
// overflow can't clip it. Commits on the keyboard's 완료 / Enter, a pick, or
// leaving the field (empty = cancel).
export default function TagAddInput({
  onCommit,
  placeholder = '태그…',
  className = 'tag-input'
}: {
  onCommit: (tag: string) => void
  placeholder?: string
  className?: string
}): JSX.Element {
  const [value, setValue] = useState('')
  const [hi, setHi] = useState(-1)
  const [remote, setRemote] = useState<string[]>([])
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const seq = useRef(0)
  const mode = useStore((s) => s.libraryMode)
  const works = useStore((s) => s.works)

  const local = useMemo(() => {
    const s = new Set<string>()
    for (const w of works) {
      if ((w.library ?? 'doujin') !== mode) continue
      w.tags.forEach((t) => s.add(t))
      w.manualTags.forEach((t) => s.add(t))
    }
    return [...s]
  }, [works, mode])

  const q = value.trim().toLowerCase()
  useEffect(() => {
    if (mode !== 'doujin' || !q) {
      setRemote([])
      return
    }
    const id = ++seq.current
    const timer = setTimeout(() => {
      window.api
        .doujinSuggest(q)
        .then((r) => id === seq.current && setRemote(r))
        .catch(() => id === seq.current && setRemote([]))
    }, 140)
    return () => clearTimeout(timer)
  }, [mode, q])

  // Works keep tags as "male:sole male" / "incest": an online suggestion
  // ("male:sole_male", "tag:incest") is stored that way.
  const norm = (t: string): string => t.trim().replace(/^tag:/i, '').replace(/_/g, ' ')
  const matches = useMemo(() => {
    if (!q) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const t of [...local.filter((t) => t.toLowerCase().includes(q)), ...remote]) {
      const n = norm(t)
      if (n.toLowerCase() === q || seen.has(n)) continue
      seen.add(n)
      out.push(n)
      if (out.length >= 10) break
    }
    return out
  }, [local, remote, q])

  // Place the list under the input (fixed: the page scrolls under it).
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el || !matches.length) return setBox(null)
    const r = el.getBoundingClientRect()
    const width = Math.max(r.width, 200)
    setBox({ left: Math.min(r.left, window.innerWidth - width - 8), top: r.bottom + 4, width })
  }, [matches.length, value])

  const commit = (t: string): void => {
    if (done.current) return
    done.current = true
    onCommit(norm(t))
  }

  return (
    <form
      className="tag-add-form"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        commit(hi >= 0 && matches[hi] ? matches[hi] : value)
      }}
    >
      <input
        ref={inputRef}
        autoFocus
        className={className}
        value={value}
        placeholder={placeholder}
        enterKeyHint="done"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value)
          setHi(-1)
        }}
        onBlur={() => commit(value)}
        onKeyDown={(e) => {
          if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            const n = matches.length
            setHi((h) => (e.key === 'ArrowDown' ? (h + 1) % n : (h - 1 + n) % n))
          } else if (e.key === 'Escape') {
            e.preventDefault()
            commit('')
          }
        }}
      />
      {box &&
        createPortal(
          <ul className="search-ac-list tag-add-list" style={{ position: 'fixed', left: box.left, top: box.top, width: box.width, right: 'auto' }}>
            {matches.map((t, i) => (
              <li
                key={t}
                className={i === hi ? 'active' : ''}
                // Keep the input focused (no blur-commit of the half-typed text).
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  commit(t)
                }}
              >
                {t}
              </li>
            ))}
          </ul>,
          document.body
        )}
    </form>
  )
}
