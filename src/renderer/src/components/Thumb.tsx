import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { loadThumb, peekThumb, syncThumbNonce, onThumb } from '../thumbs'
import { useStore } from '../store'

// Thumbnail url of a local work: the cached ≤480px webp (generated once, then
// reused). Starts with the in-memory value when already known; otherwise waits
// until `enabled` and loads it, and picks up a later (re)generation. A thumb
// regen elsewhere (thumbNonce bump) refetches from disk.
export function useWorkThumb(workId: string | undefined, enabled = true): string | null {
  const [src, setSrc] = useState<string | null>(() => (workId ? peekThumb(workId) ?? null : null))
  const nonce = useStore((s) => s.thumbNonce)
  useEffect(() => {
    if (!workId) return setSrc(null)
    if (!enabled) return
    let alive = true
    syncThumbNonce(nonce)
    loadThumb(workId).then((c) => alive && setSrc(c))
    const off = onThumb(workId, (c) => alive && setSrc(c))
    return () => {
      alive = false
      off()
    }
  }, [workId, enabled, nonce])
  return src
}

// Local work thumbnail. Loading is deferred until the card is near the
// viewport (unless the thumb is already in memory).
export default function Thumb({ workId }: { workId: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => peekThumb(workId) !== undefined)
  const src = useWorkThumb(workId, visible)

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '400px' }
    )
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="thumb" ref={ref}>
      {src ? <img src={src} loading="lazy" alt="" /> : <div className="thumb-ph" />}
    </div>
  )
}
