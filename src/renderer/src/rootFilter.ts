// 폴더 분류 (home 분류 popup + reader sidebar list): the library folders of a
// mode as the scanner reads them (backend scanner effectiveRoots / normalRoots).
// A work belongs to the deepest root holding it (download dir inside a library
// root → the download dir); a work under none always passes.
import { useMemo } from 'react'
import { useStore } from './store'
import { allFavoritesDirs, type Work } from '../../shared/types'

export function useLibraryRoots(mode: 'doujin' | 'normal'): {
  modeRoots: string[]
  rootOf: (w: Work) => string | null
} {
  const settings = useStore((s) => s.settings)
  const modeRoots = useMemo(() => {
    const set = new Set<string>()
    const add = (d: string | null | undefined): void => {
      if (d) set.add(d.replace(/\/+$/, ''))
    }
    if (mode === 'normal') {
      ;(settings.normalRoots ?? []).forEach(add)
      add(settings.normalDownloadDir)
    } else {
      settings.libraryRoots.forEach(add)
      allFavoritesDirs(settings).forEach(add)
      add(settings.downloadDir)
      add(settings.langDirs.english)
      add(settings.langDirs.japanese)
      add(settings.langDirs.other)
    }
    return [...set].sort((a, b) => b.length - a.length)
  }, [mode, settings])
  const rootOf = useMemo(() => {
    const m = new Map<string, string | null>()
    return (w: Work): string | null => {
      let r = m.get(w.path)
      if (r === undefined) {
        const p = w.sources?.[0] ?? w.path
        r = modeRoots.find((root) => p.startsWith(root + '/')) ?? null
        m.set(w.path, r)
      }
      return r
    }
  }, [modeRoots])
  return { modeRoots, rootOf }
}
