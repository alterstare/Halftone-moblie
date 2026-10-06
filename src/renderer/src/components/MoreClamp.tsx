import { useLayoutEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

// A list (artists) clamped to `lines` lines. When items don't fit, a "+N" chip
// (N = items not fully shown, same look as the tag "+N") opens the rest and
// "접기" folds it back. Items are the `.artist-link` elements inside.
export default function MoreClamp({
  lines = 1,
  className,
  children
}: {
  lines?: number
  className?: string
  children: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(0)

  // Re-count on every render and on resize (the card width is fluid).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const count = (): void => {
      if (el.scrollHeight <= el.clientHeight + 1) return setHidden(0)
      const box = el.getBoundingClientRect()
      const items = Array.from(el.querySelectorAll<HTMLElement>('.artist-link'))
      // Not fully inside the visible box → hidden (a cut-off name counts too).
      const n = items.filter((it) => it.getBoundingClientRect().bottom > box.bottom + 1).length
      setHidden(Math.max(1, n))
    }
    count()
    const ro = new ResizeObserver(count)
    ro.observe(el)
    return () => ro.disconnect()
  })

  return (
    <div className={`more-clamp ${className ?? ''}`}>
      <div
        ref={ref}
        className="more-clamp-text"
        style={open ? undefined : { WebkitLineClamp: lines }}
        data-open={open ? '' : undefined}
      >
        {children}
      </div>
      {(hidden > 0 || open) && (
        <span
          className="tag add-tag more-clamp-btn"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          {open ? '접기' : `+${hidden}`}
        </span>
      )}
    </div>
  )
}
