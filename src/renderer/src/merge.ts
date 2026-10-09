// 작품 통합: several local works read as ONE work while their folders stay
// as they are — a manual collection (settings.manualCollections; the scanner
// folds the folders into one Work whose `sources` = the folders, pages
// concatenated). 통합 해제 drops the entry; both rescan the library.
import type { Work } from '../../shared/types'
import { useStore } from './store'
import { showToast } from './toast'

const key = (p: string): string => p.replace(/[\/]+$/, '').toLowerCase()
const dirsOf = (w: Work): string[] => (w.sources?.length ? w.sources : [w.path])

async function saveAndRescan(manualCollections: ReturnType<typeof useStore.getState>['settings']['manualCollections']): Promise<void> {
  const st = useStore.getState()
  const s = { ...st.settings, manualCollections }
  await window.api.saveSettings(s)
  st.setSettings(s)
  await useStore.getState().scanLibraryJob()
}

// Can `works` be merged? Shows why not (toast) and returns false.
export function canMerge(works: Work[]): boolean {
  const dirs = new Set(works.flatMap(dirsOf))
  if (works.length < 2 || dirs.size < 2) {
    showToast('통합하려면 작품을 2개 이상 선택하세요')
    return false
  }
  const lib = works[0].library ?? 'doujin'
  if (works.some((w) => (w.library ?? 'doujin') !== lib)) {
    showToast('같은 라이브러리의 작품만 통합할 수 있습니다')
    return false
  }
  return true
}

// Merge `works` under `title` (the artist = the first one's). Works that are
// already merged bring their folders along (their old entry is replaced).
export async function mergeWorks(works: Work[], title: string): Promise<boolean> {
  if (!canMerge(works)) return false
  const dirs = [...new Set(works.flatMap(dirsOf))]
  const set = new Set(dirs.map(key))
  const keep = (useStore.getState().settings.manualCollections ?? []).filter((c) => !c.dirs.some((d) => set.has(key(d))))
  const first = works[0]
  const name = title.trim() || first.title
  await saveAndRescan([...keep, { title: name, artist: first.artist, library: first.library ?? 'doujin', dirs }])
  showToast(`작품 ${works.length}개 통합 완료`)
  return true
}

// The manual-collection entry behind a merged work (-1 = none / automatic).
export function mergedIndex(w: Work): number {
  if (!w.sources?.length) return -1
  const src = new Set(w.sources.map(key))
  return (useStore.getState().settings.manualCollections ?? []).findIndex(
    (c) => c.dirs.length > 0 && c.dirs.every((d) => src.has(key(d)))
  )
}

export async function unmergeWork(w: Work): Promise<void> {
  const i = mergedIndex(w)
  if (i < 0) return
  await saveAndRescan((useStore.getState().settings.manualCollections ?? []).filter((_, j) => j !== i))
  showToast('통합 해제 완료')
}
