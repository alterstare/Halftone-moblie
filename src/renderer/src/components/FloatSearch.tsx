import { useEffect, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'
import { ArrowDownIcon, SearchIcon } from './icons'

// The search that follows the page (Sorta 관리 › 캐릭터's list search, same
// as Halftone desktop): once the screen's own search row has scrolled up out
// of sight, a small round button stays stuck at the top of the scroll area.
// Tapped, it opens into a search box on the same query; the keyboard's search
// key or the next scroll folds it again. Put it near the top of the scroll
// area (`scroller`), before the content; `anchor` = the search row. `off`
// hides it (e.g. while selecting).
export default function FloatSearch({
  scroller,
  anchor,
  value,
  onChange,
  onEnter,
  placeholder,
  off
}: {
  scroller: RefObject<HTMLElement | null>
  anchor: RefObject<HTMLElement | null>
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
  placeholder?: string
  off?: boolean
}): JSX.Element {
  const [shown, setShown] = useState(false)
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const openedAt = useRef(0)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let isShown = false
    const check = (): void => {
      const a = anchor.current
      // how far the row's bottom has gone up past the area's top; two
      // thresholds: no show / hide flicker around one line
      const past = a && el.clientHeight ? el.getBoundingClientRect().top - a.getBoundingClientRect().bottom : -1e9
      const next = isShown ? past > -8 : past > 8
      if (next === isShown) return
      isShown = next
      setShown(next)
      if (!next) setOpen(false)
    }
    const onScroll = (): void => {
      check()
      if (Math.abs(el.scrollTop - openedAt.current) > 24) setOpen(false)
    }
    check()
    el.addEventListener('scroll', onScroll, { passive: true })
    // a hidden screen (display: none) or a resize moves the row too
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [scroller, anchor])
  useEffect(() => {
    if (!open) return
    const el = input.current
    el?.focus({ preventScroll: true })
    return () => {
      if (document.activeElement === el) el?.blur() // folded: keyboard away
    }
  }, [open])
  const folded = !open
  return (
    <div className={`float-search ${shown && !off ? 'shown' : ''} ${folded ? 'folded' : ''}`}>
      <div
        className="float-search-box"
        onClick={() => {
          if (!folded) return
          openedAt.current = scroller.current?.scrollTop ?? 0
          setOpen(true)
        }}
      >
        {folded ? <ArrowDownIcon /> : <SearchIcon />}
        <input
          ref={input}
          tabIndex={folded ? -1 : 0}
          value={value}
          placeholder={placeholder}
          enterKeyHint="search"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            onEnter?.()
            setOpen(false)
          }}
        />
      </div>
    </div>
  )
}
