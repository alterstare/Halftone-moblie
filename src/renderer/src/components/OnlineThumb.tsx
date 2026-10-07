import type { JSX, ReactNode } from 'react'
import { useWorkThumb } from './Thumb'

// Online-card thumbnail. `children` (e.g. the download progress bar) render
// over the thumbnail.
export default function OnlineThumb({
  thumbUrl,
  children,
  className = 'gcard-thumb',
  localWorkId
}: {
  thumbUrl: string | null
  children?: ReactNode
  className?: string
  // Already in the local library → show its local cover (instant, offline)
  // instead of the remote thumbUrl.
  localWorkId?: string
}): JSX.Element {
  const localSrc = useWorkThumb(localWorkId)
  const shown = localSrc ?? thumbUrl
  return (
    <div className={className}>
      {shown ? <img src={shown} loading="lazy" alt="" /> : <div className="thumb-ph" />}
      {children}
    </div>
  )
}
