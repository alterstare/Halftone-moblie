// The favorites model (doujin library).
//
// ONE source of truth per work:
//   • works with a doujin gallery code → the favorites list (store.onlineFavs,
//     keyed by code). Work.favorite of every local copy mirrors that entry, so
//     a heart set online, in the library, or by import is the same state.
//   • works without a code → Work.favorite itself (they can't be in the list).
// (General manga keeps its own in-app lists: settings.normalFavSeries /
// normalFavChapters, linked to online comic favorites by title in the renderer.)
//
// The favorites FOLDER is a side effect, not the truth: with
// settings.favoriteMoveToFolder, hearting moves the work folder into
// favoritesDir (remembering homePath) and unhearting moves it back. On scan, a
// work that newly appears inside favoritesDir is added to the favorites
// (manual drag-in still works), but leaving the folder never removes a heart.
import type { OnlineFav, Work } from '../../shared/types'
import type { GallerySummary } from '../../shared/ipc'
import { ensureSummaries } from './summaries'
import { store } from '../context'
import { moveToFavorites, moveFromFavorites, isUnder } from './favorites'

// A numeric doujin gallery code (comic favorites are keyed by url instead).
export const isGalleryCode = (code: string | null | undefined): code is string => !!code && /^\d+$/.test(code)

// Does the work belong in the favorites list (doujin work with a gallery code)?
export const listKeyOf = (w: Work): string | null =>
  (w.library ?? 'doujin') === 'doujin' && isGalleryCode(w.code) ? w.code : null

const metaOf = (w: Work): Partial<OnlineFav> => ({
  title: w.title,
  artist: w.artist,
  language: w.language,
  pageCount: w.pageCount
})

// Title / thumb / artist from the cached gallery summary (a heart set where
// only the number is known — a list, a file import, a re-heart — still shows
// the real card at once instead of waiting for a fetch).
const sumMeta = (g: GallerySummary): Partial<OnlineFav> => ({
  title: g.title,
  artist: g.artists[0] ?? null,
  language: g.language,
  pageCount: g.pageCount,
  thumbUrl: g.thumbUrl ?? undefined
})
async function cachedMeta(code: string): Promise<Partial<OnlineFav> | undefined> {
  const g = (await ensureSummaries([]))[code]
  return g ? sumMeta(g) : undefined
}

// Startup: favorites saved with just their number (imported / re-hearted before
// their summary was known) get title / thumb from the cache. One save.
export async function backfillFavMeta(): Promise<void> {
  const sums = await ensureSummaries([])
  let n = 0
  for (const f of store.onlineFavs.values()) {
    const g = sums[f.code]
    if (!g || (f.title && f.title !== f.code && f.thumbUrl)) continue
    store.setOnlineFav(f.code, {}, {
      ...sumMeta(g),
      title: f.title && f.title !== f.code ? f.title : g.title,
      thumbUrl: f.thumbUrl ?? g.thumbUrl ?? undefined
    })
    n++
  }
  if (n) await store.saveOnline()
}

// Apply a heart to one local work: flag + timestamp, and the folder move when
// enabled. Never touches the favorites list (callers do).
async function applyToWork(w: Work, fav: boolean): Promise<Work> {
  const s = store.settings
  const stamp = { favorite: fav, favoritedAt: fav ? (w.favoritedAt ?? Date.now()) : undefined }
  let patch: Partial<Work> = {}
  if ((w.library ?? 'doujin') === 'doujin' && s.favoriteMoveToFolder !== false && s.favoritesDir) {
    try {
      if (fav && !isUnder(w.path, s.favoritesDir)) patch = await moveToFavorites(w, s.favoritesDir, s.groups)
      else if (!fav && w.homePath) patch = await moveFromFavorites(w)
    } catch {
      /* folder busy/missing — the heart still changes, the folder stays put */
    }
  }
  return store.update(w.id, { ...patch, ...stamp })
}

// Heart / unheart a gallery by code: the list entry plus every local copy.
export async function setFavoriteByCode(
  code: string,
  fav: boolean,
  meta?: Partial<OnlineFav>
): Promise<{ fav: OnlineFav; works: Work[] }> {
  const locals = [...store.works.values()].filter((w) => listKeyOf(w) === code)
  const entry = store.setOnlineFav(
    code,
    { favorite: fav },
    meta ?? (locals[0] ? metaOf(locals[0]) : fav ? await cachedMeta(code) : undefined)
  )
  const works: Work[] = []
  for (const w of locals) works.push(w.favorite === fav ? w : await applyToWork(w, fav))
  await store.flushWorks()
  return { fav: entry, works }
}

// Many codes at once (favorites file import): same as setFavoriteByCode per
// code, but the local copies are looked up once and works.json is written once
// — per-code writes made a 7000-entry Pupil backup take many minutes (it looked
// like the import did nothing). Returns how many codes have a local copy.
export async function setFavoritesByCodes(codes: string[], fav: boolean, ranks: Record<string, number> = {}): Promise<number> {
  const byKey = new Map<string, Work[]>()
  for (const w of store.works.values()) {
    const k = listKeyOf(w)
    if (!k) continue
    const arr = byKey.get(k)
    if (arr) arr.push(w)
    else byKey.set(k, [w])
  }
  const sums = fav ? await ensureSummaries([]) : {}
  let matched = 0
  for (const code of codes) {
    const locals = byKey.get(code) ?? []
    const r = ranks[code] ?? 0
    store.setOnlineFav(
      code,
      r > 0 ? { favorite: fav, rank: r } : { favorite: fav },
      locals[0] ? metaOf(locals[0]) : fav ? sums[code] && sumMeta(sums[code]) : undefined
    )
    if (locals.length) matched++
    for (const w of locals) if (w.favorite !== fav) await applyToWork(w, fav)
  }
  await store.flushWorks()
  return matched
}

// 즐겨찾기 초기화: every doujin heart off — list entries (rank kept) and the
// local works (folders move back home like a normal unheart). One write.
export async function clearAllFavorites(): Promise<number> {
  const codes = [...store.onlineFavs.values()].filter((f) => f.favorite && isGalleryCode(f.code)).map((f) => f.code)
  for (const code of codes) store.setOnlineFav(code, { favorite: false })
  let n = codes.length
  for (const w of [...store.works.values()]) {
    if ((w.library ?? 'doujin') !== 'doujin' || !w.favorite) continue
    if (!listKeyOf(w)) n++
    await applyToWork(w, false)
  }
  await store.flushWorks()
  return n
}

// Heart / unheart a local work (routes coded works through the list).
export async function setWorkFavorite(workId: string, fav: boolean): Promise<Work> {
  const w = store.get(workId)
  if (!w) throw new Error('no work')
  const key = listKeyOf(w)
  if (key) {
    const r = await setFavoriteByCode(key, fav, metaOf(w))
    return r.works.find((x) => x.id === workId) ?? store.get(workId)!
  }
  const updated = await applyToWork(w, fav)
  await store.flushWorks()
  return updated
}

// A freshly downloaded / registered work that is already a favorite gets the
// same folder placement a heart would give it.
export async function placeIfFavorite(w: Work): Promise<Work> {
  return w.favorite ? applyToWork({ ...w, favorite: false }, true) : w
}

// Favorite state of a scanned work, given its stored predecessor. Installed as
// Store.favoriteRule. `inFavDir` = the scan found it inside favoritesDir.
export function scannedFavorite(w: Work, prev: Work | undefined, inFavDir: boolean): boolean {
  const key = listKeyOf(w)
  const enteredFavDir = inFavDir && (!prev || !isUnder(prev.path, store.settings.favoritesDir))
  if (key) {
    const listed = !!store.onlineFavs.get(key)?.favorite
    if (!listed && enteredFavDir) store.setOnlineFav(key, { favorite: true }, metaOf(w))
    return listed || enteredFavDir
  }
  return (prev?.favorite ?? false) || enteredFavDir
}

// One-time migration to this model (settings.favoritesUnified):
//  • local hearts of coded works → favorites list (keeping when they were added),
//    and list hearts → local copies (flag only, no folder moves);
//  • favlist:<name> tags → favorite lists of codes;
//  • the removed general-manga favorites-folder setting is dropped.
export async function migrateFavorites(): Promise<void> {
  const s = store.settings as typeof store.settings & { favLists?: string[]; normalFavoritesDir?: string | null }
  if (s.favoritesUnified) return
  const lists = new Map((s.onlineFavLists ?? []).map((l) => [l.name, new Set(l.codes)]))
  for (const w of store.works.values()) {
    const key = listKeyOf(w)
    if (key && w.favorite && !store.onlineFavs.get(key)?.favorite) {
      store.setOnlineFav(key, { favorite: true, addedAt: w.favoritedAt ?? w.addedAt ?? Date.now() }, metaOf(w))
    } else if (key && !w.favorite && store.onlineFavs.get(key)?.favorite) {
      store.update(w.id, { favorite: true, favoritedAt: store.onlineFavs.get(key)!.addedAt })
    }
    const tags = (w.manualTags ?? []).filter((t) => t.startsWith('favlist:'))
    if (!tags.length) continue
    for (const t of tags) {
      const name = t.slice('favlist:'.length)
      if (key) (lists.get(name) ?? lists.set(name, new Set()).get(name)!).add(key)
    }
    store.update(w.id, { manualTags: w.manualTags.filter((t) => !t.startsWith('favlist:')) })
  }
  const next = { ...s, favoritesUnified: true }
  delete next.favLists
  delete next.normalFavoritesDir
  next.onlineFavLists = [...lists].map(([name, codes]) => ({ name, codes: [...codes] }))
  await store.flushWorks()
  await store.saveOnline()
  await store.saveSettings(next)
}
