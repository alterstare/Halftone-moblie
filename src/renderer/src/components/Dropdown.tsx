import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import Caret from './Caret'

// Custom select styled like the home category chips: a button showing the
// current label + a ▾ triangle that flips to ▴ while open. Used where a native
// <select> arrow looks out of place.
export default function Dropdown<T extends string>({
  value,
  options,
  onChange,
  className = '',
  chip = false,
  mini = false,
  icon,
  title,
  align = 'right'
}: {
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (v: T) => void
  className?: string
  // Render the button as a toolbar chip (like 작품 분류 ▾) instead of a field.
  chip?: boolean
  // Render the button as a small .mini button (reader sidebar), panel opens leftward.
  mini?: boolean
  // Icon-only button (e.g. the sort icon at the end of the search box); the
  // panel opens leftward, the current choice is marked in the list.
  icon?: ReactNode
  title?: string
  // Icon trigger: which edge the panel is anchored to ('left' for a button at
  // the start of a row, opening rightward).
  align?: 'left' | 'right'
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const label = options.find(([v]) => v === value)?.[1] ?? value

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className={`dropdown ${icon ? `dd-icon-wrap align-${align}` : ''} ${className}`} ref={ref}>
      {icon ? (
        <button
          type="button"
          className={`dd-icon ${open ? 'on' : ''}`}
          title={title ? `${title}: ${label}` : label}
          onClick={() => setOpen((o) => !o)}
        >
          {icon}
        </button>
      ) : mini ? (
        <button type="button" className="mini dd-mini" onClick={() => setOpen((o) => !o)}>
          {label} <Caret up={open} sm />
        </button>
      ) : chip ? (
        <button type="button" className="chip" onClick={() => setOpen((o) => !o)}>
          {label} <Caret up={open} sm />
        </button>
      ) : (
        <button type="button" className="dropdown-btn" onClick={() => setOpen((o) => !o)}>
          <span className="dropdown-label">{label}</span>
          <span className="dropdown-arrow">
            <Caret up={open} />
          </span>
        </button>
      )}
      {open && (
        <div className="dropdown-panel">
          {options.map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={`dropdown-opt ${v === value ? 'sel' : ''}`}
              onClick={() => {
                onChange(v)
                setOpen(false)
              }}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
