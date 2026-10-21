// Heart / group changes move the work's folder (favorites folder, group
// folder) — slow on a NAS. The UI flips at once and the moves run here in the
// background, one at a time. The backend's answer is adopted when it lands,
// but only by the newest op on that work / code (quick re-taps don't flicker
// back); a failure puts the earlier state back with a toast. Ops slower than
// a moment show in the activity bar.
import type { OnlineFav, Work } from '../../shared/types'
import { useStore, applyFav } from './store'
import { invalidate } from './images'
import { showToast } from './toast'

let chain: Promise<void> = Promise.resolve()
const newest = new Map<string, number>()
let seq = 0

// Mark a new op on `keys`; the returned check says whether it is still the newest on a key.
function claim(keys: string[]): (key: string) => boolean {
  const id = ++seq
  for (const k of keys) newest.set(k, id)
  return (k) => newest.get(k) === id
}

function queue(title: string, run: () => Promise<void>, undo: () => void): void {
  chain = chain.then(async () => {
    const job = { id: '' }
    const timer = window.setTimeout(() => {
      const st = useStore.getState()
      job.id = st.startJob('organize', st.libraryMode, title)
    }, 600)
    try {
      await run()
      if (job.id) useStore.getState().endJob(job.id, { status: 'done' })
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      undo()
      if (job.id) useStore.getState().endJob(job.id, { status: 'error', error: msg })
      showToast(`${title} 실패: ${msg}`, 3000)
    } finally {
      window.clearTimeout(timer)
    }
  })
}

const setWorks = (fn: (w: Work) => Work): void => useStore.setState((s) => ({ works: s.works.map(fn) }))

// Take the backend's works. A moved folder drops the cached page urls; an op
// that is no longer the newest on a work only passes on the new path.
function adopt(works: Work[], isNewest: (key: string) => boolean): void {
  const byId = new Map(works.map((w) => [w.id, w]))
  setWorks((cur) => {
    const w = byId.get(cur.id)
    if (!w) return cur
    if (w.path !== cur.path) invalidate(w.id)
    return isNewest(w.id) ? w : { ...cur, path: w.path, homePath: w.homePath }
  })
}

// Unified doujin heart: the favorites list entry + every local copy.
export function favoriteByCode(code: string, fav: boolean, meta?: Partial<OnlineFav>): void {
  const st = useStore.getState()
  const locals = st.works.filter((w) => w.code === code)
  const isNewest = claim([code, ...locals.map((w) => w.id)])
  const prevFav = st.onlineFavs[code]
  const prevWorks = new Map(locals.map((w) => [w.id, w.favorite]))
  const optimistic: OnlineFav = prevFav ? { ...prevFav, favorite: fav } : {
    code,
    rank: 0,
    title: meta?.title ?? locals[0]?.title ?? '',
    artist: meta?.artist ?? null,
    language: meta?.language ?? null,
    pageCount: meta?.pageCount ?? 0,
    thumbUrl: meta?.thumbUrl ?? null,
    addedAt: Date.now(),
    favorite: fav
  }
  useStore.setState((s) => ({ onlineFavs: applyFav(s.onlineFavs, optimistic) }))
  setWorks((w) => (prevWorks.has(w.id) ? { ...w, favorite: fav } : w))
  queue(
    `즐겨찾기 · ${optimistic.title || code}`,
    async () => {
      const r = await window.api.setFavoriteByCode(code, fav, meta)
      if (isNewest(code)) useStore.setState((s) => ({ onlineFavs: applyFav(s.onlineFavs, r.fav) }))
      adopt(r.works, isNewest)
    },
    () => {
      if (isNewest(code))
        useStore.setState((s) => {
          const n = { ...s.onlineFavs }
          if (prevFav) n[code] = prevFav
          else delete n[code]
          return { onlineFavs: n }
        })
      setWorks((w) => (prevWorks.has(w.id) && isNewest(w.id) ? { ...w, favorite: prevWorks.get(w.id)! } : w))
    }
  )
}

// Heart of a work outside the favorites list (no gallery code).
export function favoriteWork(work: Work, fav: boolean): void {
  const isNewest = claim([work.id])
  const prev = useStore.getState().works.find((w) => w.id === work.id)?.favorite ?? work.favorite
  setWorks((w) => (w.id === work.id ? { ...w, favorite: fav } : w))
  queue(
    `즐겨찾기 · ${work.title}`,
    async () => adopt([await window.api.setFavorite(work.id, fav)], isNewest),
    () => setWorks((w) => (w.id === work.id && isNewest(w.id) ? { ...w, favorite: prev } : w))
  )
}

// Single group membership for `works` (each folder moves into / out of the group folder).
export function setWorkGroups(works: Work[], groupIds: string[]): void {
  if (!works.length) return
  const ids = groupIds.slice(0, 1)
  const isNewest = claim(works.map((w) => w.id))
  const cur = useStore.getState().works
  const prev = new Map(works.map((w) => [w.id, cur.find((x) => x.id === w.id)?.groups ?? w.groups ?? []]))
  setWorks((w) => (prev.has(w.id) ? { ...w, groups: ids } : w))
  const done = new Set<string>()
  queue(
    `그룹 이동 · ${works.length > 1 ? `작품 ${works.length}개` : works[0].title}`,
    async () => {
      for (const w of works) {
        adopt([await window.api.setWorkGroups(w.id, ids)], isNewest)
        done.add(w.id)
      }
    },
    () => setWorks((w) => (prev.has(w.id) && !done.has(w.id) && isNewest(w.id) ? { ...w, groups: prev.get(w.id)! } : w))
  )
}
