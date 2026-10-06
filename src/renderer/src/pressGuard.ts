// Whole-card press feedback (the card dims / brightens while held) should only
// show for a press on the card itself. A press on one of its controls — a tag,
// the "+N" chip, a star, a button — marks the card `no-press` for the duration
// of that touch, so only the control reacts. (CSS `:has(:active)` alone isn't
// reliable for touch in the WebView.)
const CARD = '.gtile, .gcard, .lib-item, .work-card, .chapter-row'
const CONTROL =
  'button, input, a, .tag, .artist-link, .code, .copyable, .gcard-artist, .chip-mini, .star, .stars, .seg > *, .more-clamp-btn, .tile-more, .grp-btn, .seg-heart, .seg-dl, .card-more'

let marked: Element | null = null
const clear = (): void => {
  marked?.classList.remove('no-press')
  marked = null
}
window.addEventListener(
  'pointerdown',
  (e) => {
    clear()
    const t = e.target as Element | null
    const card = t?.closest(CARD)
    const ctrl = t?.closest(CONTROL)
    if (card && ctrl && card.contains(ctrl)) {
      card.classList.add('no-press')
      marked = card
    }
  },
  { capture: true, passive: true }
)
for (const ev of ['pointerup', 'pointercancel'])
  window.addEventListener(ev, () => setTimeout(clear, 150), { capture: true, passive: true })
