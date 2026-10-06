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
      <img src={src} style={style} onClick={onClick} alt="" decoding="async" />
    </span>
  )
}
