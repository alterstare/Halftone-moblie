// API: general-manga online (comic-family mirror + backup gnuboard sites) —
// lists, chapters, image urls, author/title/cover lookups and downloads into
// the general-manga library. Mobile port of the desktop main/ipc/comic.ts;
// scraping itself lives in lib/comic.ts.
import type { Work } from '../../shared/types'
import type { Api, ComicListSource, ComicChapter } from '../../shared/ipc'
import { store } from '../context'
import { scanRoot, normalRoots } from '../lib/scanner'
import {
  comicList,
  comicChapters,
  comicReadUrls,
  comicImageToFile,
  comicDownloadSeries,
  comicOpenSite,
  comicCoverForTitle,
  comicSeriesAuthor,
  comicSeriesTitle,
  comicAuthorForTitle,
  comicScrapeList,
  downloadGenericChapters
} from '../lib/comic'
import { encodeComic, writeRawThumb } from '../lib/media'
import { runDownload } from '../downloads'
import { ensureStorage } from '../storage'

// Where general-manga downloads go — never the doujin library.
function normalDestRoot(): string {
  const s = store.settings
  const dest = s.normalDownloadDir ?? normalRoots(s)[0]
  if (!dest) throw new Error('일반 만화 다운로드 폴더(설정 · 일반 만화)를 먼저 지정하세요')
  return dest
}

// Register a freshly downloaded series folder as general-manga works.
async function importDownloaded(dir: string, artist?: string | null): Promise<Work[]> {
  const scanned = await scanRoot(dir, store.settings, 'normal')
  const merged = store.mergeScanPartial(scanned)
  // The artist belongs to THIS series only (mergeScanPartial returns the whole
  // library — stamping its result overwrote every work's artist).
  if (artist) for (const w of scanned) store.update(w.id, { artist })
  await store.flushWorks()
  return artist ? [...store.works.values()] : merged
}

// Download a comic series (all chapters, or only `chapterUrls`).
async function runComicDownload(seriesUrl: string, title: string, chapterUrls?: string[]): Promise<Work[]> {
  const destRoot = normalDestRoot()
  await ensureStorage([destRoot])
  return runDownload(seriesUrl, title, async (signal, report) => {
    // Grab the author from the series page so downloaded chapters carry it.
    const artist = await comicSeriesAuthor(seriesUrl).catch(() => null)
    const dir = await comicDownloadSeries(
      seriesUrl,
      title,
      destRoot,
      (done, total, label) => report('downloading', done, total, label),
      chapterUrls,
      signal
    )
    const merged = await importDownloaded(dir, artist)
    report('done', merged.length, merged.length)
    return merged
  })
}

export const comicApi: Partial<Api> = {
  // ---------- browse ----------

  comicList: async (source: ComicListSource, page: number) => {
    const r = await comicList(store.settings.comicBaseUrl, source, page)
    // Wrap card thumbs so they load through the interceptor with the site referer.
    return { ...r, items: r.items.map((it) => ({ ...it, thumb: it.thumb ? encodeComic(it.thumb) : null })) }
  },
  comicChapters: (seriesUrl: string) => comicChapters(seriesUrl),
  comicReadUrls: async (chapterUrl: string) => (await comicReadUrls(chapterUrl)).map(encodeComic),
  comicSeriesAuthor: (seriesUrl: string) => comicSeriesAuthor(seriesUrl),
  comicSeriesTitle: (seriesUrl: string) => comicSeriesTitle(seriesUrl),

  // Show the scraper page (Cloudflare check / backup site browsing by hand).
  comicOpenSite: (url?: string) => comicOpenSite(store.settings.comicBaseUrl, url),
  // Backup site: read the chapter list of whatever page the user navigated to.
  comicScrapeList: () => comicScrapeList(),

  // ---------- downloads (progress on doujinProgress, code = seriesUrl) ----------

  comicDownload: (seriesUrl: string, title: string) => runComicDownload(seriesUrl, title),
  comicDownloadChapters: (seriesUrl: string, title: string, chapterUrls: string[]) =>
    runComicDownload(seriesUrl, title, chapterUrls),

  // Backup site: download already-scraped chapters (progress code = "backup:<title>").
  comicDownloadGeneric: async (title: string, chapters: ComicChapter[], only?: string[]) => {
    const destRoot = normalDestRoot()
    await ensureStorage()
    return runDownload('backup:' + title, title, async (signal, report) => {
      const dir = await downloadGenericChapters(
        chapters,
        title,
        destRoot,
        (done, total, label) => report('downloading', done, total, label),
        only,
        signal
      )
      const merged = await importDownloaded(dir)
      report('done', merged.length, merged.length)
      return merged
    })
  },

  // ---------- metadata for local works ----------

  comicFillArtist: async (workIds: string[], title: string) => {
    const artist = await comicAuthorForTitle(store.settings.comicBaseUrl, title).catch(() => null)
    if (!artist) return []
    const out = workIds.map((id) => store.update(id, { artist })).filter(Boolean) as Work[]
    await store.flushWorks()
    return out
  },

  // Regenerate a series' cover from the online source (search by title, first
  // result's cover) into every given chapter's thumb (saved raw).
  comicRegenCover: async (workIds: string[], title: string) => {
    try {
      const cover = await comicCoverForTitle(store.settings.comicBaseUrl, title)
      if (!cover) return { ok: false }
      for (const id of workIds) await writeRawThumb(id, (file) => comicImageToFile(cover, file)).catch(() => {})
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  }
}
