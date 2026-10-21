import { getCover } from './images'
import { hasExclusions } from './exclude'

// Thumbnail pipeline: each work gets a small webp generated once (Chromium
// decodes webp/avif via canvas) and saved to disk by main. Afterwards the
// <img> just points at the cached file — no re-decode on tab switches.

const mem = new Map<string, string | null>() // workId -> thumb url (null = no cover)
const pending = new Map<string, Promise<string | null>>()

// Two queues: thumbs a mounted card asks for go first, newest first (the card
// that just scrolled into view), before the background warm-up of the whole
// library (oldest first). A card asking for a thumb still waiting in the
// background queue moves it over.
const MAX_CONCURRENT = 4
let active = 0
interface Job {
  run: () => void
  key?: string
}
const urgentQ: Job[] = []
const bgQ: Job[] = []
const waitingBg = new Map<string, Job>()

function pump(): void {
  while (active < MAX_CONCURRENT && (urgentQ.length || bgQ.length)) {
    const j = urgentQ.pop() ?? bgQ.shift()!
    if (j.key) waitingBg.delete(j.key)
    active++
    j.run()
  }
}

function schedule<T>(fn: () => Promise<T>, urgent = true, key?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: Job = {
      key: urgent ? undefined : key,
      run: () => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            pump()
          })
      }
    }
    if (urgent) urgentQ.push(job)
    else {
      bgQ.push(job)
      if (key) waitingBg.set(key, job)
    }
    pump()
  })
}

function promote(key: string): void {
  const j = waitingBg.get(key)
  if (!j) return
  waitingBg.delete(key)
  const i = bgQ.indexOf(j)
  if (i >= 0) bgQ.splice(i, 1)
  urgentQ.push(j)
  pump()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // needed so canvas export isn't tainted
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

// Made natively (window.api.makeThumb: subsampled decode + webp in Java, the
// page read straight from disk / the NAS). With page exclusions on, the UI
// picks the cover page itself. A page Java can't decode goes through the
// canvas path below.
async function generate(workId: string): Promise<string | null> {
  const picked = hasExclusions() ? await getCover(workId) : undefined
  if (picked === null) return null
  const r = await window.api.makeThumb(workId, picked).catch(() => null)
  if (r?.url) return r.url
  if (r && !r.src) return null // no image
  const src = r?.src ?? picked ?? (await getCover(workId))
  return src ? encodeFrom(workId, src, true) : null
}

// Downscale `src` to the ≤480px webp thumb and save it for `workId`.
async function encodeFrom(workId: string, src: string, cropTall = false): Promise<string | null> {
  let img: HTMLImageElement
  try {
    img = await loadImage(src)
  } catch {
    return null
  }
  const sw = img.naturalWidth || img.width
  const sh = img.naturalHeight || img.height
  if (!sw || !sh) return null // decode failed (e.g. oversized webtoon strip)
  // Webtoon chapters are one very tall strip; squishing the whole height into the
  // thumbnail yields a blank-looking sliver. For tall images use only the TOP
  // (square-ish) region as the cover, like every other reader does.
  const srcH = cropTall && sh / sw > 1.6 ? Math.round(sw * 1.4) : sh
  const MAX = 480
  const scale = Math.min(1, MAX / Math.max(sw, srcH))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(img, 0, 0, sw, srcH, 0, 0, w, h)
  let dataUrl: string
  try {
    dataUrl = canvas.toDataURL('image/webp', 0.72)
  } catch {
    return null
  }
  return window.api.saveThumb(workId, dataUrl)
}

async function resolve(workId: string, urgent: boolean): Promise<string | null> {
  const existing = await window.api.getThumb(workId)
  // Raw full-size cover (online cover regen) → shrink once; keep it if that fails.
  if (existing?.endsWith('#raw')) {
    const url = existing.slice(0, -4)
    return schedule(() => encodeFrom(workId, url), urgent, workId).then((u) => u ?? url, () => url)
  }
  if (existing) return existing
  return schedule(() => generate(workId), urgent, workId)
}

// Mounted <Thumb>s listen for their work's thumb resolving later (e.g. a download
// finished after the card first found no cover) and swap it in.
const listeners = new Map<string, Set<(url: string | null) => void>>()
export function onThumb(workId: string, fn: (url: string | null) => void): () => void {
  let set = listeners.get(workId)
  if (!set) listeners.set(workId, (set = new Set()))
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (!set!.size) listeners.delete(workId)
  }
}

// `urgent` = a card on screen wants it (false = background warm-up).
export async function loadThumb(workId: string, urgent = true): Promise<string | null> {
  if (mem.has(workId)) return mem.get(workId)!
  let p = pending.get(workId)
  if (p && urgent) promote(workId)
  if (!p) {
    p = resolve(workId, urgent).then((url) => {
      mem.set(workId, url)
      pending.delete(workId)
      listeners.get(workId)?.forEach((fn) => fn(url))
      return url
    })
    pending.set(workId, p)
  }
  return p
}

// Pre-generate thumbnails for the whole library after a scan, in the background.
export async function warmThumbs(
  workIds: string[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  let done = 0
  const total = workIds.length
  await Promise.all(
    workIds.map((id) =>
      // One failing thumb must not reject the whole batch (which would leave the
      // job stuck), so swallow per-work errors and still count progress.
      loadThumb(id, false)
        .catch(() => null)
        .then(() => {
          done++
          if (done % 10 === 0 || done === total) onProgress?.(done, total)
        })
    )
  )
}

// Already-resolved thumb url (sync), or undefined if not loaded yet — lets a
// remounted card paint its cover immediately instead of flashing blank.
export function peekThumb(workId: string): string | null | undefined {
  return mem.get(workId)
}

// Thumb-nonce bump (bulk regen) → drop the memory cache ONCE per bump. Previously
// every newly mounted <Thumb> invalidated itself whenever nonce > 0, so after any
// regen each scroll/page change refetched every cover.
let memNonce = 0
export function syncThumbNonce(n: number): void {
  if (n <= memNonce) return
  memNonce = n
  mem.clear()
  pending.clear()
}

export function invalidateThumb(workId: string): void {
  mem.delete(workId)
  pending.delete(workId)
}

// Force-regenerate a work's thumbnail from its local first page, overwriting any
// existing (or online-sourced) cover. Used as a fallback when the online cover
// search fails — the raw first page is better than a blank tile.
export async function regenLocalThumb(workId: string): Promise<string | null> {
  const url = await schedule(() => generate(workId))
  mem.set(workId, url)
  pending.delete(workId)
  return url
}
