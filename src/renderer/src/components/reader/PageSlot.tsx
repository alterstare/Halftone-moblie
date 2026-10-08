import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

// Wraps one rendered page and reports its measured height to the reader.
// Until its image has loaded it holds the estimated height (`estH`) so the
// strip doesn't collapse and jump; only real (loaded) heights are reported.
// Memoized: the page list re-renders only when a page's own props change —
// not on every page-index step (slider drags stay smooth with every page
// mounted).
function PageSlot({
  index,
  onMeasure,
  estH,
  children
}: {
  index: number
  onMeasure: (i: number, h: number) => void
  estH?: number
  children: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const img = el.querySelector('img')
    if (img?.complete && img.naturalWidth > 0) setLoaded(true)
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !loaded) return
    const report = (): void => onMeasure(index, el.offsetHeight)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [index, onMeasure, loaded])
  return (
    <div
      ref={ref}
      className="page-slot"
      style={!loaded && estH ? { minHeight: estH } : undefined}
      onLoadCapture={() => setLoaded(true)}
      onErrorCapture={() => setLoaded(true)}
    >
      {children}
    </div>
  )
}

export default memo(PageSlot)
