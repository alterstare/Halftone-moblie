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

// Re-applies the anchor for a few frames while the list settles, then again
// whenever the list's content changes size (cards filling in late — tag rows
// measured, online summaries arriving — grew the content above the anchor
// after the frames ended and the list came back several cards too high).
// Stops at the first touch / wheel, after 8s, once `wanted()` turns false
// during the frames, or at a scroll it didn't make afterwards (something else
// moved the list — jump to top, page change). `done` runs once the frame
// phase ends (saving resumes; a later re-apply is saved too).
export function restoreAnchor(el: HTMLElement, a: ListAnchor, wanted: () => boolean, done: () => void): () => void {
  let raf = 0
  let frames = 0
  let stable = 0
  let settled = false
  let stopped = false
  let mine = -1 // scrollTop of the last re-apply after settling
  const onScroll = (): void => {
    if (settled && Math.abs(el.scrollTop - mine) > 1) stop()
  }
  const ro = new ResizeObserver(() => {
    if (settled && !stopped) apply()
  })
  const settle = (): void => {
    if (settled) return
    settled = true
    cancelAnimationFrame(raf)
    done()
  }
  const stop = (): void => {
    if (stopped) return
    stopped = true
    settle()
    ro.disconnect()
    clearTimeout(timer)
    el.removeEventListener('touchstart', stop)
    el.removeEventListener('wheel', stop)
    el.removeEventListener('scroll', onScroll)
  }
  const timer = window.setTimeout(stop, 8000)
  const apply = (): void => {
    if (!settled && !wanted()) return stop()
    const before = el.scrollTop
    const card = a.id ? el.querySelector<HTMLElement>(`[data-sel="${CSS.escape(a.id)}"]`) : null
    if (card) {
      const off = card.getBoundingClientRect().top - el.getBoundingClientRect().top
      el.scrollTop += off - a.offset
    } else {
      el.scrollTop = a.top
    }
    if (settled) {
      mine = el.scrollTop
      return
    }
    stable = Math.abs(el.scrollTop - before) < 1 ? stable + 1 : 0
    // ~0.5s of no change (or 2s at most) → settled.
    if (stable >= 30 || ++frames > 120) {
      mine = el.scrollTop
      return settle()
    }
    raf = requestAnimationFrame(apply)
  }
  el.addEventListener('touchstart', stop, { passive: true })
  el.addEventListener('wheel', stop, { passive: true })
  el.addEventListener('scroll', onScroll, { passive: true })
  for (const c of el.children) ro.observe(c)
  apply()
  return stop
}
