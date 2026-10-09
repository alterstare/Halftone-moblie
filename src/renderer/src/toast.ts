// Small snackbar at the bottom of the screen ("코드 복사 완료"). One at a time;
// a new message replaces the old one.
let el: HTMLDivElement | null = null
let timer = 0

export function showToast(text: string, ms = 1600): void {
  if (!el) {
    el = document.createElement('div')
    el.className = 'mm-toast'
    document.body.appendChild(el)
  }
  el.textContent = text
  el.classList.remove('show')
  void el.offsetWidth // restart the fade-in
  el.classList.add('show')
  window.clearTimeout(timer)
  timer = window.setTimeout(() => el?.classList.remove('show'), ms)
}
