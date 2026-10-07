import type { JSX } from 'react'

// Rotating Keyboard Arrow (Material) for drawer / sort-direction / dropdown /
// fold indicators. Points down (or right with `side`); `up` / `open` turns it
// with a short rotate animation (CSS `.caret` — same feel as the 일반 만화
// "… 더보기" chevrons). `sm` = the smaller size that replaces the old ▾ triangle.
export default function Caret({
  up,
  side,
  open,
  sm,
  className
}: {
  up?: boolean // pointing down → up (dropdowns, sort direction)
  side?: boolean // points right; `open` turns it down (fold rows: ▸ / ▾)
  open?: boolean
  sm?: boolean
  className?: string
}): JSX.Element {
  const turned = side ? !!open : !!up
  return (
    <svg
      className={`caret ${side ? 'side' : ''} ${turned ? 'turned' : ''} ${sm ? 'sm' : ''} ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z" />
    </svg>
  )
}
