// Backend entry: boots the store and exposes `window.api` (the same Api the
// desktop preload exposed), implemented in-process on top of the native
// plugin. Mobile counterpart of the desktop main/index.ts + preload.
import type { Api, DoujinProgress, UpdateStatus } from '../shared/ipc'
import type { ScanProgress } from '../shared/types'
import { IPC } from '../shared/ipc'
import { MM } from './native'
import { join } from './node/path'
import { store, paths, on, sendToRenderer } from './context'
import { moveFromFavorites } from './lib/favorites'
import { scannedFavorite, migrateFavorites } from './lib/favoriteSync'
import { setComicChallengeHandler, setComicStatusHandler } from './lib/comic'
import { initThumbDir } from './lib/media'
import { applyNetwork } from './network'
import { libraryApi } from './api/library'
import { favoritesApi } from './api/favorites'
import { doujinApi } from './api/doujin'
import { comicApi } from './api/comic'
import { checkForUpdate, installUpdate } from './update'
import { applyGalleryHide } from './gallery'


// One-time migration to the in-app general-manga favorites (see desktop main).
async function migrateNormalFavorites(): Promise<void> {
  if (store.settings.normalFavMigrated) return
  const normals = [...store.works.values()].filter((w) => (w.library ?? 'doujin') === 'normal')
  for (const w of normals) {
    try {
      if (w.homePath) store.update(w.id, await moveFromFavorites(w))
      else if (w.favorite) store.update(w.id, { favorite: false })
    } catch {
      store.update(w.id, { favorite: false })
    }
  }
  await store.flushWorks()
  await store.saveSettings({ ...store.settings, normalFavSeries: [], normalFavChapters: [], normalFavMigrated: true })
}

// First run: put both download folders under Download/MangaManager so a
// download works out of the box (the user can change them in Settings).
async function firstRunFolders(): Promise<void> {
  const s = store.settings
  if (s.downloadDir || s.normalDownloadDir || s.libraryRoots.length || (s.normalRoots ?? []).length) return
  const base = join(paths.download, 'MangaManager')
  await store.saveSettings({ ...s, downloadDir: join(base, 'doujin'), normalDownloadDir: join(base, 'manga') })
}

const events: Partial<Api> = {
  onScanProgress: (cb) => on<ScanProgress>(IPC.scanProgress, cb),
  onOrganizeProgress: (cb) => on(IPC.organizeProgress, cb),
  onOnlineFavPreload: (cb) => on(IPC.onlineFavPreloadProgress, cb),
  onClassifyProgress: (cb) => on(IPC.classifyProgress, cb),
  onDoujinProgress: (cb) => on<DoujinProgress>(IPC.doujinProgress, cb),
  onComicChallenge: (cb) => on<boolean>(IPC.comicChallenge, cb),
  onComicStatus: (cb) => on<string | null>(IPC.comicStatus, cb),
  onNavBack: (cb) => on(IPC.navBack, cb),
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => on<UpdateStatus>(IPC.updateStatus, cb),
  installUpdate: () => installUpdate(),
  doujinCancelEnrich: doujinApi.doujinCancelEnrich
}

// Boot the backend and install window.api. Must finish before the UI mounts.
export async function installBackend(): Promise<void> {
  const p = await MM.getPaths()
  paths.data = p.files
  paths.cache = p.cache
  paths.external = p.external
  paths.download = p.download

  store.init(paths.data)
  await store.load()
  store.favoriteRule = scannedFavorite
  await firstRunFolders()
  await applyNetwork(store.settings)
  void applyGalleryHide(store.settings)
  await migrateNormalFavorites()
  await migrateFavorites()
  await initThumbDir()

  // Cloudflare check shown/cleared → "인증 필요" banner in the UI.
  setComicChallengeHandler((active) => sendToRenderer(IPC.comicChallenge, active))
  setComicStatusHandler((msg) => sendToRenderer(IPC.comicStatus, msg))
  // Android back button → the UI's history back (it decides when to exit).
  await MM.addListener('back', () => sendToRenderer(IPC.navBack))

  window.api = { ...libraryApi, ...favoritesApi, ...doujinApi, ...comicApi, ...events } as Api
  // Look for a newer release once the UI has settled.
  setTimeout(() => void checkForUpdate(), 5000)
}
