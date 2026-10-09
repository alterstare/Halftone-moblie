import { hasExclusions, filterExcluded, getExcluded } from './exclude'
import { isComicCode } from './util'

// Caches the per-work image url list so thumbnails and the reader share one
// readdir round-trip. Cleared entries reload on demand.
const cache = new Map<string, Promise<string[]>>()
// Reverse index (page src → its work and position), filled as lists load, so
// translation can find a page's previous page and its work's character notes.
const pageIndex = new Map<string, { workId: string; idx: number; srcs: string[] }>()

export function getImages(workId: string): Promise<string[]> {
  let p = cache.get(workId)
  if (!p) {
    p = window.api.getWorkImages(workId).then((srcs) => {
      srcs.forEach((s, idx) => pageIndex.set(s, { workId, idx, srcs }))
      return srcs
    })
    cache.set(workId, p)
  }
  return p
}

export function pageOf(src: string): { workId: string; idx: number; srcs: string[] } | undefined {
  return pageIndex.get(src)
}

export function invalidate(workId: string): void {
  cache.delete(workId)
}

export async function getCover(workId: string): Promise<string | null> {
  const imgs = await getImages(workId)
  if (!imgs.length) return null
  if (!hasExclusions()) return imgs[0]
  // Use the first page that isn't a registered/excluded image.
  const kept = await filterExcluded(imgs.slice(0, 6), getExcluded())
  return kept[0] ?? imgs[0]
}

// Online (streamed) gallery image urls, keyed by doujin code.
const onlineCache = new Map<string, Promise<string[]>>()

// A manga-site chapter's list arrives in steps (comicPages events: the first
// pages at once, the rest while the hidden page is scrolled). The cache keeps
// the latest list; a list cut short ('cut') is dropped so reopening refetches.
const pageListeners = new Map<string, Set<(urls: string[], more: boolean) => void>>()
// Chapters whose list is still being collected.
const collecting = new Set<string>()
export const pagesCollecting = (code: string): boolean => collecting.has(code)
let pagesHooked = false
function hookPages(): void {
  if (pagesHooked) return
  pagesHooked = true
  window.api.onComicPages(({ code, urls, state }) => {
    if (state === 'cut') onlineCache.delete(code)
    else onlineCache.set(code, Promise.resolve(urls))
    if (state !== 'more') collecting.delete(code)
    pageListeners.get(code)?.forEach((cb) => cb(urls, state === 'more'))
  })
}
// Reader: follow a chapter's list as it grows. Returns the unsubscribe.
export function onOnlinePages(code: string, cb: (urls: string[], more: boolean) => void): () => void {
  hookPages()
  let set = pageListeners.get(code)
  if (!set) pageListeners.set(code, (set = new Set()))
  set.add(cb)
  return () => {
    set!.delete(cb)
    if (!set!.size) pageListeners.delete(code)
  }
}

export function getOnlineImages(code: string): Promise<string[]> {
  hookPages()
  let p = onlineCache.get(code)
  if (!p) {
    // A manga-site "code" is the chapter viewer URL (http…); a doujin code is numeric.
    if (isComicCode(code)) collecting.add(code)
    p = isComicCode(code) ? window.api.comicReadUrls(code) : window.api.doujinReadUrls(code)
    onlineCache.set(code, p)
    p.catch(() => collecting.delete(code))
  }
  return p
}

// 다시 불러오기: drop the cached list and fetch it again — a manga-site chapter
// reloads its viewer page (fresh) instead of reusing the open one.
export function reloadOnlineImages(code: string): Promise<string[]> {
  hookPages()
  if (isComicCode(code)) collecting.add(code)
  const p = isComicCode(code) ? window.api.comicReadUrls(code, true) : window.api.doujinReadUrls(code)
  onlineCache.set(code, p)
  p.catch(() => {
    onlineCache.delete(code)
    collecting.delete(code)
  })
  return p
}
