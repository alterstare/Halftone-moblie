import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { isTouch } from '../mobile'
import Caret from './Caret'

export interface MenuItem {
  label: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  color?: string // optional swatch shown before the label
  children?: MenuItem[] // submenu (flyout)
}

function Row({ item, onClose, inline }: { item: MenuItem; onClose: () => void; inline?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  if (item.children) {
    // Touch (centered popup): the submenu expands in place under its row.
    if (inline) {
      return (
        <>
          <button className={`ctx-item has-sub ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
            <span className="ctx-label">{item.label}</span>
            <span className="ctx-arrow">
              <Caret up={open} sm />
            </span>
          </button>
          {open && (
            <div className="ctx-inline-sub">
              {item.children.map((c, i) => (
                <Row key={i} item={c} onClose={onClose} inline />
              ))}
            </div>
          )}
        </>
      )
    }
    return (
      <div
        className="ctx-item has-sub"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <span className="ctx-label">{item.label}</span>
        <span className="ctx-arrow">
          <Caret side sm />
        </span>
        {open && (
          <div className="ctx-submenu">
            {item.children.map((c, i) => (
              <Row key={i} item={c} onClose={onClose} />
            ))}
          </div>
        )}
      </div>
    )
  }
  return (
    <button
      className={`ctx-item ${item.danger ? 'danger' : ''}`}
      disabled={item.disabled}
      onClick={() => {
        onClose()
        item.onClick?.()
      }}
    >
      {item.color && <span className="ctx-swatch" style={{ background: item.color }} />}
      {item.label}
    </button>
  )
}

// A right-click menu rendered at the cursor, with optional one-or-more-level
// submenus. Closes on outside click, Esc, scroll, resize, or after a leaf click.
// On a touch screen (long-press) it is a centered popup over a dimmed backdrop
// instead: rows divided by lines, submenus expand in place, and any touch
// outside the popup closes it.
export default function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const centered = isTouch()
  const downOut = useRef(false) // the current touch started on the backdrop
  const [closing, setClosing] = useState(false)
  const fadeClose = (): void => {
    if (closing) return
    setClosing(true)
    window.setTimeout(onClose, 260)
  }

  useEffect(() => {
    if (centered) {
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') onClose()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({
        x: Math.min(x, window.innerWidth - r.width - 8),
        y: Math.min(y, window.innerHeight - r.height - 8)
      })
    }
    const close = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [x, y, onClose, centered])

  if (centered)
    return createPortal(
      <div
        className={`ctx-overlay ${closing ? 'closing' : ''}`}
        // An outside touch (tap or drag) closes it when it ENDS, and the
        // backdrop fades out but keeps catching input a moment longer: the
        // tap's synthesized click comes after the touch ends and would
        // otherwise land on whatever is underneath (e.g. the page slider).
        onPointerDown={(e) => {
          downOut.current = e.target === e.currentTarget
        }}
        onPointerUp={() => downOut.current && fadeClose()}
        onPointerCancel={() => downOut.current && fadeClose()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div ref={ref} className="ctx-menu centered">
          {items.map((it, i) => (
            <Row key={i} item={it} onClose={onClose} inline />
          ))}
        </div>
      </div>,
      document.body
    )

  // Portal to <body> so a card's `content-visibility`/`contain` (which makes the
  // card a containing block for position:fixed) can't trap or clip the menu.
  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((it, i) => (
        <Row key={i} item={it} onClose={onClose} />
      ))}
    </div>,
    document.body
  )
}
