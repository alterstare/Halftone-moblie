import type { JSX } from 'react'

// Reader page image, wrapped in a span so layout CSS (.timg) can size it.
export default function PageImage({
  src,
  style,
  onClick,
  className
}: {
  src: string
  style?: React.CSSProperties
  onClick?: (e: React.MouseEvent) => void
  className?: string
}): JSX.Element {
  return (
    <span className={className ? `timg ${className}` : 'timg'}>
      {/* No src yet (a page still on its way) → empty slot.
          decoding="sync": the browser drops the decoded pixels of pages far
          off screen; with "async" a page scrolled back into view was painted
          blank (black) until decoded again. Sync paints it only decoded. */}
      {src && <img src={src} style={style} onClick={onClick} alt="" decoding="sync" />}
    </span>
  )
}
