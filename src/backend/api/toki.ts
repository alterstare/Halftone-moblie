// API: general-manga online (toki-family mirror + backup gnuboard sites) —
// lists, chapters, image urls, author/title/cover lookups and downloads into
// the general-manga library. Mobile port of the desktop main/ipc/toki.ts;
// scraping itself lives in lib/toki.ts.
import type { Work } from '../../shared/types'
import type { Api, TokiListSource, TokiChapter } from '../../shared/ipc'
import { store } from '../context'
import { scanRoot, normalRoots } from '../lib/scanner'
import {
  tokiList,
  tokiChapters,
  tokiReadUrls,
  tokiImageToFile,
  tokiDownloadSeries,
  tokiOpenSite,
  tokiCoverForTitle,
  tokiSeriesAuthor,
  tokiSeriesTitle,
  tokiAuthorForTitle,
  tokiScrapeList,
  downloadGenericChapters
} from '../lib/toki'
import { encodeToki, writeRawThumb } from '../lib/media'
import { runDownload } from '../downloads'
import { ensureStorage } from '../storage'

// Where general-manga downloads go — never the hitomi library.
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

// Download a toki series (all chapters, or only `chapterUrls`).
async function runTokiDownload(seriesUrl: string, title: string, chapterUrls?: string[]): Promise<Work[]> {
  const destRoot = normalDestRoot()
  await ensureStorage()
  return runDownload(seriesUrl, title, async (signal, report) => {
    // Grab the author from the series page so downloaded chapters carry it.
    const artist = await tokiSeriesAuthor(seriesUrl).catch(() => null)
    const dir = await tokiDownloadSeries(
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

export const tokiApi: Partial<Api> = {
  // ---------- browse ----------

  tokiList: async (source: TokiListSource, page: number) => {
    const r = await tokiList(store.settings.tokiBaseUrl, source, page)
    // Wrap card thumbs so they load through the interceptor with the site referer.
    return { ...r, items: r.items.map((it) => ({ ...it, thumb: it.thumb ? encodeToki(it.thumb) : null })) }
  },
  tokiChapters: (seriesUrl: string) => tokiChapters(seriesUrl),
  tokiReadUrls: async (chapterUrl: string) => (await tokiReadUrls(chapterUrl)).map(encodeToki),
  tokiSeriesAuthor: (seriesUrl: string) => tokiSeriesAuthor(seriesUrl),
  tokiSeriesTitle: (seriesUrl: string) => tokiSeriesTitle(seriesUrl),

  // Show the scraper page (Cloudflare check / backup site browsing by hand).
  tokiOpenSite: (url?: string) => tokiOpenSite(store.settings.tokiBaseUrl, url),
  // Backup site: read the chapter list of whatever page the user navigated to.
  tokiScrapeList: () => tokiScrapeList(),

  // ---------- downloads (progress on hitomiProgress, code = seriesUrl) ----------

  tokiDownload: (seriesUrl: string, title: string) => runTokiDownload(seriesUrl, title),
  tokiDownloadChapters: (seriesUrl: string, title: string, chapterUrls: string[]) =>
    runTokiDownload(seriesUrl, title, chapterUrls),

  // Backup site: download already-scraped chapters (progress code = "backup:<title>").
  tokiDownloadGeneric: async (title: string, chapters: TokiChapter[], only?: string[]) => {
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

  tokiFillArtist: async (workIds: string[], title: string) => {
    const artist = await tokiAuthorForTitle(store.settings.tokiBaseUrl, title).catch(() => null)
    if (!artist) return []
    const out = workIds.map((id) => store.update(id, { artist })).filter(Boolean) as Work[]
    await store.flushWorks()
    return out
  },

  // Regenerate a series' cover from the online source (search by title, first
  // result's cover) into every given chapter's thumb (saved raw).
  tokiRegenCover: async (workIds: string[], title: string) => {
    try {
      const cover = await tokiCoverForTitle(store.settings.tokiBaseUrl, title)
      if (!cover) return { ok: false }
      for (const id of workIds) await writeRawThumb(id, (file) => tokiImageToFile(cover, file)).catch(() => {})
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  }
}
