import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent } from 'react'

// Tag chips for a card, always showing WHOLE tags (never cut mid-tag): the ones
// that don't fit hide behind a "+N" chip (click to expand, "접기" to collapse).
// Favorite tags sort first; manual tags get an × when onRemove is given.
//
// Two layouts:
//   line (default) — list cards: one line, +N / + 태그 pinned at its end
//   lines={n}      — grid cards: up to n rows, sized to the parent box (which
//                    may shrink, e.g. when a long artist list takes rows); the
//                    buttons are budgeted into the last row. `fluid`: the
//                    card grows with its content, so up to n rows are used
//                    regardless of the parent box's current height.
// Both measure real chip widths (hidden ones are briefly laid out with a
// "measuring" class) and re-measure on resize.
interface Props {
  tags: string[]
  favoriteTags?: string[]
  manualTags?: string[]
  onTagClick?: (t: string) => void
  onTagContext?: (t: string, e: MouseEvent) => void
  onRemove?: (t: string) => void
  onAddClick?: () => void // shows "+ 태그"
  lines?: number
  fluid?: boolean
}

// Raw (unadjusted) position of the last pointer press, for the hit check above.
let lastDown: { x: number; y: number; t: number } | null = null
window.addEventListener(
  'pointerdown',
  (e) => {
    lastDown = { x: e.clientX, y: e.clientY, t: Date.now() }
  },
  { capture: true, passive: true }
)
function downOn(el: HTMLElement): boolean {
  if (!lastDown || Date.now() - lastDown.t > 1500) return true // keyboard etc.
  const r = el.getBoundingClientRect()
  const m = 2 // px of slack
  return lastDown.x >= r.left - m && lastDown.x <= r.right + m && lastDown.y >= r.top - m && lastDown.y <= r.bottom + m
}

const ROW_H = 24 // grid tag height (px), see .taglist-grid .mtag
const GRID_GAP = 4
const LINE_GAP = 6

export default function TagList({
  tags,
  favoriteTags = [],
  manualTags = [],
  onTagClick,
  onTagContext,
  onRemove,
  onAddClick,
  lines,
  fluid
}: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [visible, setVisible] = useState(tags.length)
  const [width, setWidth] = useState(0)
  const [boxH, setBoxH] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const btnsRef = useRef<HTMLSpanElement>(null)
  const rowFit = !!lines

  // Favorite match ignores the namespace ("female:x" ≈ "x") and _ vs space.
  const norm = (s: string): string => s.toLowerCase().replace(/^[^:]+:/, '').replace(/_/g, ' ').trim()
  const favSet = new Set(favoriteTags.map(norm))
  const isFav = (t: string): boolean => favSet.has(norm(t))
  const ordered = [...tags].sort((a, b) => Number(isFav(b)) - Number(isFav(a))) // stable

  // Re-measure on width changes (and, for grids, on the parent box's height).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    const box = rowFit ? el.parentElement : null
    const ro2 = new ResizeObserver(() => box && setBoxH(box.clientHeight))
    if (box) ro2.observe(box)
    return () => {
      ro.disconnect()
      ro2.disconnect()
    }
  }, [rowFit])

  // Grid: simulate the wrap of tags (+ buttons) at their measured widths and keep
  // the largest prefix that fits in the rows available.
  useLayoutEffect(() => {
    if (!rowFit || expanded) return
    const el = ref.current
    if (!el) return
    el.classList.add('measuring')
    const cw = el.clientWidth
    const tagW = Array.from(el.querySelectorAll<HTMLElement>('.mtag')).map((x) => Math.min(x.offsetWidth, cw))
    const moreW = el.querySelector<HTMLElement>('.more-measure')?.offsetWidth ?? 0
    const addW = el.querySelector<HTMLElement>('.add-btn')?.offsetWidth ?? 0
    el.classList.remove('measuring')
    // Rows that fit the (possibly shrunk) parent box, capped at `lines`.
    let maxRows = lines ?? 1
    const box = fluid ? null : el.parentElement
    if (box) {
      const cs = getComputedStyle(box)
      const inner = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      maxRows = Math.max(0, Math.min(maxRows, Math.floor((inner + GRID_GAP) / (ROW_H + GRID_GAP))))
    }
    if (maxRows === 0) {
      setVisible(0)
      return
    }
    const fits = (n: number): boolean => {
      const items = tagW.slice(0, n)
      if (n < tagW.length) items.push(moreW) // "+N" needed
      if (addW) items.push(addW)
      let rows = 1
      let x = 0
      for (const w of items) {
        const nx = x === 0 ? w : x + GRID_GAP + w
        if (nx <= cw) x = nx
        else {
          rows++
          x = w
          if (rows > maxRows) return false
        }
      }
      return true
    }
    let n = tagW.length
    while (n > 0 && !fits(n)) n--
    setVisible(n)
  }, [tags, expanded, width, boxH, rowFit, lines, onAddClick, fluid])

  // Line: as many whole tags as fit before the buttons.
  useLayoutEffect(() => {
    if (rowFit || expanded) return
    const el = ref.current
    if (!el) return
    el.classList.add('measuring')
    const cw = el.clientWidth
    const btnsW = btnsRef.current?.offsetWidth ?? 0
    let used = 0
    let count = 0
    for (const t of Array.from(el.querySelectorAll<HTMLElement>('.mtag'))) {
      const add = t.offsetWidth + (count > 0 ? LINE_GAP : 0)
      if (used + add + LINE_GAP + btnsW > cw) break
      used += add
      count++
    }
    el.classList.remove('measuring')
    setVisible(count)
  }, [tags, expanded, width, rowFit])

  // Chromium's touch adjustment snaps a tap NEAR a chip onto the chip (its
  // click comes with adjusted coordinates), so a tap on the card's empty space
  // ran a tag search. Only a touch that really landed on the chip counts; a
  // near miss falls through to the card like a tap on empty space.
  const stop = (fn: () => void) => (e: MouseEvent): void => {
    if (!downOn(e.currentTarget as HTMLElement)) return
    e.stopPropagation()
    fn()
  }

  const tagSpan = (t: string, clip: boolean): JSX.Element => (
    <span
      key={t}
      className={`tag mtag ${isFav(t) ? 'fav-tag' : ''} ${manualTags.includes(t) ? 'manual' : ''} ${clip ? 'clipped' : ''}`}
      onClick={stop(() => onTagClick?.(t))}
      onContextMenu={
        onTagContext
          ? (e) => {
              // A long-press near (not on) the chip belongs to the card.
              if (!downOn(e.currentTarget as HTMLElement)) return
              e.preventDefault()
              e.stopPropagation()
              onTagContext(t, e)
            }
          : undefined
      }
    >
      {t}
      {onRemove && manualTags.includes(t) && (
        <span className="tag-x" onClick={stop(() => onRemove(t))}>
          ×
        </span>
      )}
    </span>
  )

  const hidden = ordered.length - visible
  // +N / 접기 / + 태그. The invisible "+00" chip is what the measurement
  // reserves for the +N button.
  const buttons = (
    <>
      {!expanded && hidden > 0 && (
        <span className="tag add-tag" onClick={stop(() => setExpanded(true))}>
          +{hidden}
        </span>
      )}
      <span className="tag add-tag more-measure" aria-hidden="true">
        +00
      </span>
      {expanded && (
        <span className="tag add-tag" onClick={stop(() => setExpanded(false))}>
          접기
        </span>
      )}
      {onAddClick && (
        <span className="tag add-tag add-btn" onClick={stop(onAddClick)}>
          + 태그
        </span>
      )}
    </>
  )
  const chips = ordered.map((t, i) => tagSpan(t, !expanded && i >= visible))

  return rowFit ? (
    <div ref={ref} className={`taglist-grid ${expanded ? 'expanded' : ''}`}>
      {chips}
      {buttons}
    </div>
  ) : (
    <div ref={ref} className={`taglist-line ${expanded ? 'expanded' : ''}`}>
      {chips}
      <span ref={btnsRef} className="taglist-btns">
        {buttons}
      </span>
    </div>
  )
}
