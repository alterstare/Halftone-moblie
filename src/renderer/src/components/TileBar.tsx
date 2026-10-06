import type { JSX, ReactNode } from 'react'
import { ArrowDownIcon } from './icons'

// Bottom bar of a list card (phone layout): rating on the left, an optional
// 더보기 toggle in the middle (opens the card's preview panel), favorite and
// download (or group, for works already in the library) on the right, joined
// in one pill with a divider (the desktop .seg look, a bit roomier for
// touch). A press on a control (stars, buttons, their popups) stays in the
// bar; a press on the bar's empty space falls through to the card (opens the
// work), same as the card's own empty space.
export default function TileBar({
  fav,
  rating,
  action,
  more
}: {
  fav: ReactNode
  rating: ReactNode
  action?: ReactNode
  more?: { open: boolean; onToggle: () => void }
}): JSX.Element {
  return (
    <div
      className="tile-bar"
      onClick={(e) => {
        const t = e.target as HTMLElement
        // Portaled popups (outside the bar's DOM) and the controls themselves.
        if (!e.currentTarget.contains(t) || t.closest('.tile-rating .stars, .tile-seg > *, .tile-more')) e.stopPropagation()
      }}
    >
      <div className="tile-rating">{rating}</div>
      {more && (
        <button className={`tile-more ${more.open ? 'open' : ''}`} onClick={more.onToggle} title="더보기">
          <span>더보기</span>
          <ArrowDownIcon />
        </button>
      )}
      <span className="seg tile-seg">
        {fav}
        {action}
      </span>
    </div>
  )
}

// Bottom bar of a compact grid card: 즐겨찾기 | 다운로드(그룹) as two equal
// halves with a divider; the bar itself never opens the work.
export function CompactBar({ fav, action }: { fav: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="ctile-bar" onClick={(e) => e.stopPropagation()}>
      <span className="ctile-half">{fav}</span>
      {action && <span className="ctile-half">{action}</span>}
    </div>
  )
}
