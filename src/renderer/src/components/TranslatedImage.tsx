import type { JSX } from 'react'

// Plain reader page image. (The in-place OCR/LLM translation overlay was removed
// for the mobile build; this now just renders the image.)
export default function TranslatedImage({
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
