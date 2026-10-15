// Coming back to a list (library home): put the card that was at the top of
// the screen back at the same spot. A bare scrollTop wasn't enough — at
// remount the list isn't fully laid out yet, so the restore got clamped to a
// shorter page and that clamped value was saved over the real one (the card
// you had opened ended up far below the screen).
//
// Saved: the first card (data-sel) whose bottom is below the list's top edge
// and its offset from that edge, plus scrollTop as a fallback.
export interface ListAnchor {
  top: number
  id: string | null
  offset: number
}

export function captureAnchor(el: HTMLElement): ListAnchor {
  const box = el.getBoundingClientRect().top
  for (const c of el.querySelectorAll<HTMLElement>('[data-sel]')) {
    const r = c.getBoundingClientRect()
    if (r.bottom > box + 1) return { top: el.scrollTop, id: c.getAttribute('data-sel'), offset: r.top - box }
  }
  return { top: el.scrollTop, id: null, offset: 0 }
}

// Re-applies the anchor for a few frames while the list settles; stops at the
// first touch / wheel, or once `wanted()` turns false (something else moved
// the list — jump to top, page change). `done` runs once it stops.
export function restoreAnchor(el: HTMLElement, a: ListAnchor, wanted: () => boolean, done: () => void): () => void {
  let raf = 0
  let frames = 0
  let stable = 0
  let stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(raf)
    el.removeEventListener('touchstart', stop)
    el.removeEventListener('wheel', stop)
    done()
  }
  const apply = (): void => {
    if (!wanted()) return stop()
    const before = el.scrollTop
    const card = a.id ? el.querySelector<HTMLElement>(`[data-sel="${CSS.escape(a.id)}"]`) : null
    if (card) {
      const off = card.getBoundingClientRect().top - el.getBoundingClientRect().top
      el.scrollTop += off - a.offset
    } else {
      el.scrollTop = a.top
    }
    stable = Math.abs(el.scrollTop - before) < 1 ? stable + 1 : 0
    // ~0.5s of no change (or 2s at most) → settled.
    if (stable >= 30 || ++frames > 120) return stop()
    raf = requestAnimationFrame(apply)
  }
  el.addEventListener('touchstart', stop, { passive: true })
  el.addEventListener('wheel', stop, { passive: true })
  apply()
  return stop
}
