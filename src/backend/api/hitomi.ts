// API: hitomi online — browsing/search, gallery metadata (enrich local works),
// image urls, cover regeneration, downloads, and the deleted-gallery sweep.
// Mobile port of the desktop main/ipc/hitomi.ts.
import type { Work } from '../../shared/types'
import type { Api, HitomiProgress, HitomiListSource, GallerySummary } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import { store, sendToRenderer, delay } from '../context'
import { scanOne } from '../lib/scanner'
import { moveWorkToFolder } from '../lib/favorites'
import {
  fetchMeta,
  writeSidecar,
  downloadGallery,
  extractCode,
  fetchNozomiExcluding,
  findEditions,
  searchNozomi,
  summary,
  readImageUrls,
  hitomiImageToFile,
  pingHitomi,
  popularRanks,
  findKorean,
  hitomiExists
} from '../lib/hitomi'
import { suggestTokens, recordSeen } from '../lib/suggest'
import { encodeWeb, writeRawThumb } from '../lib/media'
import { runDownload, stopDownload } from '../downloads'
import { placeIfFavorite } from '../lib/favoriteSync'
import { ensureStorage } from '../storage'

// Summary with its thumb wrapped for the image interceptor.
const withWebThumb = (s: GallerySummary): GallerySummary => ({
  ...s,
  thumbUrl: s.thumbUrl ? encodeWeb(s.thumbUrl) : null
})

// Append the user's auto-exclude tags as negative (-) tokens to a search query,
// reusing the query's own separator so tokenization stays consistent.
function withExcludes(query: string, exclude: string[]): string {
  const toks = exclude.filter(Boolean).map((t) => (t.startsWith('-') ? t : `-${t}`))
  if (!toks.length) return query
  const sep = query.includes(',') ? ' , ' : ' '
  return query.trim() + sep + toks.join(sep)
}

// Fill a local work's tags/language/artist from hitomi using its code (also
// writes the metadata sidecar into the work folder).
async function enrichOne(workId: string): Promise<Work> {
  const w = store.get(workId)
  if (!w) throw new Error('no work')
  if (!w.code) throw new Error('이 작품에는 작품 코드가 없습니다')
  const meta = await fetchMeta(w.code)
  await writeSidecar(w.path, meta)
  return store.update(workId, {
    tags: [...new Set([...w.tags, ...meta.tags])],
    language: meta.language,
    artist: w.artist ?? (meta.artists.length ? meta.artists.join(', ') : null)
  })
}

// 랜덤 (sidebar sort): a random page of the latest index, shuffled. Every call
// (page change / refresh) rolls a new one; the total stays the index size so
// the pager keeps working.
async function randomIndexPage(
  language: string | null,
  pageSize: number,
  exclude: string[]
): Promise<{ ids: number[]; total: number }> {
  const first = await fetchNozomiExcluding({ kind: 'index', language }, 0, pageSize, exclude)
  const pages = Math.max(1, Math.ceil(first.total / pageSize))
  const p = Math.floor(Math.random() * pages)
  const pick = p === 0 ? first : await fetchNozomiExcluding({ kind: 'index', language }, p, pageSize, exclude)
  const ids = [...pick.ids]
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  return { ids, total: first.total }
}

// Bulk enrich state: one run at a time, cancellable from the UI.
let enrichRunning = false
let enrichCancel = false

export const hitomiApi: Partial<Api> = {
  hitomiPing: () => pingHitomi(),
  hitomiPopularRanks: (codes: string[]) => popularRanks(codes),
  hitomiFetchMeta: (code: string) => fetchMeta(code),
  hitomiSuggest: (query: string) => suggestTokens(query),

  // ---------- browse / search ----------

  hitomiList: async (source: HitomiListSource, page: number) => {
    const pageSize = store.settings.pageSize || 50
    // A bare gallery number or a hitomi link → look that gallery up directly.
    if (source.kind === 'search') {
      const q = source.query.trim()
      const code = /^\d{5,}$/.test(q) || /^https?:\/\//i.test(q) ? extractCode(q) : null
      if (code) {
        try {
          return { items: [withWebThumb(await summary(code))], total: 1, page: 0, pageSize }
        } catch {
          return { items: [], total: 0, page: 0, pageSize }
        }
      }
    }
    const { ids, total } =
      source.kind === 'search'
        ? await searchNozomi(
            withExcludes(source.query, store.settings.onlineExcludeTags ?? []),
            source.language,
            page,
            pageSize,
            source.sort ?? 'date'
          )
        : source.sort === 'random'
          ? await randomIndexPage(source.language, pageSize, store.settings.onlineExcludeTags ?? [])
          : // Browse (latest / popular) also honors 설정 › 검색 제외 태그.
            await fetchNozomiExcluding(source, page, pageSize, store.settings.onlineExcludeTags ?? [])
    // Fetch summaries 6 at a time; unreachable galleries are dropped.
    const items: GallerySummary[] = []
    for (let i = 0; i < ids.length; i += 6) {
      const results = await Promise.allSettled(ids.slice(i, i + 6).map((id) => summary(String(id))))
      for (const r of results) if (r.status === 'fulfilled') items.push(withWebThumb(r.value))
    }
    void recordSeen(items)
    return { items, total, page, pageSize }
  },

  hitomiFindKorean: async (payload: { code: string | null; artist: string | null; title: string }) =>
    (await findKorean(payload)).map(withWebThumb),

  // 한국어 / 일본어 / 영어 editions of a work (다른 언어 panel).
  hitomiFindEditions: async (payload: { code: string | null; artist: string | null; title: string; language?: string | null }) => {
    const r = await findEditions({ ...payload, pageSize: store.settings.pageSize || 50 })
    return { korean: r.korean.map(withWebThumb), japanese: r.japanese.map(withWebThumb), english: r.english.map(withWebThumb) }
  },

  hitomiReadUrls: async (code: string) => (await readImageUrls(code)).map(encodeWeb),

  // ---------- metadata (enrich local works) ----------

  hitomiEnrich: (workId: string) => enrichOne(workId),

  hitomiCancelEnrich: async () => {
    enrichCancel = true
  },

  // Enrich every coded work missing language OR artist. Progress rides the
  // hitomiProgress channel with an empty code.
  hitomiEnrichAll: async () => {
    if (enrichRunning) return []
    enrichRunning = true
    enrichCancel = false
    const targets = [...store.works.values()].filter((w) => w.code && (!w.language || !w.artist))
    const updated: Work[] = []
    const emit = (done: number, title: string, phase: HitomiProgress['phase']): void =>
      sendToRenderer(IPC.hitomiProgress, { code: '', title, done, total: targets.length, phase } satisfies HitomiProgress)
    for (let i = 0; i < targets.length; i++) {
      if (enrichCancel) break
      try {
        updated.push(await enrichOne(targets[i].id))
      } catch {
        /* skip failures, keep going */
      }
      emit(i + 1, targets[i].title, 'enriching')
      await delay(200) // be gentle with hitomi
    }
    await store.flushWorks()
    enrichRunning = false
    emit(updated.length, '', 'done')
    return updated
  },

  // Sweep hitomi-coded works that 404 on hitomi into deletedDir. Network-
  // uncertain results are never moved.
  classifyDeleted: async () => {
    const dir = store.settings.deletedDir
    if (!dir) throw new Error('삭제된 작품 폴더가 설정되지 않았습니다. 설정에서 폴더를 지정하세요.')
    const targets = [...store.works.values()].filter(
      (w) => (w.library ?? 'hitomi') === 'hitomi' && w.code && /^\d{4,}$/.test(w.code)
    )
    let moved = 0
    let uncertain = 0
    const emit = (done: number, current: string, finished = false): void =>
      sendToRenderer(IPC.classifyProgress, { done, total: targets.length, moved, current, finished })
    for (let i = 0; i < targets.length; i++) {
      const w = targets[i]
      emit(i, w.title)
      const exists = await hitomiExists(w.code as string)
      if (exists === false) {
        try {
          store.update(w.id, await moveWorkToFolder(w, dir))
          moved++
        } catch {
          uncertain++
        }
      } else if (exists === null) {
        uncertain++
      }
    }
    await store.flushWorks()
    emit(targets.length, '', true)
    return { moved, checked: targets.length, uncertain, works: [...store.works.values()] }
  },

  // ---------- covers / downloads ----------

  // Regenerate a work's thumbnail from the gallery's first online image (saved
  // raw; the UI shrinks it on load).
  hitomiRegenCover: async (workId: string, code: string) => {
    try {
      const urls = await readImageUrls(code)
      if (!urls.length) return { ok: false }
      await writeRawThumb(workId, (file) => hitomiImageToFile(urls[0], file))
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  },

  // Download a gallery (code or url) into the download dir, then register it.
  hitomiDownload: async (input: string) => {
    const code = extractCode(input)
    if (!code) throw new Error('코드를 찾을 수 없습니다')
    const destRoot = store.settings.downloadDir ?? store.settings.libraryRoots[0]
    if (!destRoot) throw new Error('다운로드 폴더 또는 라이브러리 폴더를 먼저 설정하세요')
    await ensureStorage()
    return runDownload(code, '', async (signal, report) => {
      const { dir, meta } = await downloadGallery(
        code,
        destRoot,
        (done, total, title) => report('downloading', done, total, title),
        store.settings.downloadImageFormat ?? 'avif',
        store.settings.hitomiNamePatterns?.[store.settings.hitomiDownloadPatternIdx ?? 0],
        signal
      )
      const scanned = await scanOne(dir, store.settings)
      if (!scanned) throw new Error('다운로드 후 폴더를 읽지 못했습니다')
      store.mergeScanPartial([scanned])
      const work = await placeIfFavorite(store.get(scanned.id)!)
      await store.flushWorks()
      report('done', meta.pageCount, meta.pageCount, meta.title)
      return work
    })
  },

  downloadStop: async (code: string) => stopDownload(code)
}
