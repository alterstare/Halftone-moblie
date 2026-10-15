// After a search from a click (artist / tags), a translucent bar at the bottom
// offers the same search on the other side for ~2s: "온라인에서 검색  승인".
// Only 승인 is a button (purple); the rest of the bar lets touches through.
let el: HTMLDivElement | null = null
let labelEl: HTMLSpanElement | null = null
let btn: HTMLButtonElement | null = null
let timer = 0
let action: (() => void) | null = null
// A search that itself came from the other side (승인, the long-press menu)
// doesn't offer the way back.
let quietUntil = 0
export function suppressCross(ms = 1500): void {
  quietUntil = Date.now() + ms
}

function hide(): void {
  window.clearTimeout(timer)
  el?.classList.remove('show')
  action = null
}

export function showCrossSearch(label: string, onAccept: () => void, ms = 2200): void {
  if (Date.now() < quietUntil) return
  if (!el) {
    el = document.createElement('div')
    el.className = 'mm-cross'
    labelEl = document.createElement('span')
    btn = document.createElement('button')
    btn.className = 'mm-cross-ok'
    btn.textContent = '승인'
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const run = action
      hide()
      suppressCross()
      run?.()
    })
    el.append(labelEl, btn)
    document.body.appendChild(el)
  }
  labelEl!.textContent = label
  action = onAccept
  el.classList.remove('show')
  void el.offsetWidth // restart the fade-in
  el.classList.add('show')
  window.clearTimeout(timer)
  timer = window.setTimeout(hide, ms)
}

// A Browse (online) search query → the library search's token form:
// artist:"a b" → artist:a_b (quotes off, spaces as underscores).
export function toLocalQuery(q: string): string {
  return q
    .split(',')
    .map((t) => t.trim().replace(/"/g, '').replace(/\s+/g, '_'))
    .filter(Boolean)
    .join(', ')
}
