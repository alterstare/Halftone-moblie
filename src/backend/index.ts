// Backend entry: boots the store and exposes `window.api` (the same Api the
// desktop preload exposed), implemented in-process on top of the native
// plugin. Mobile counterpart of the desktop main/index.ts + preload.
import type { Api, HitomiProgress, UpdateStatus } from '../shared/ipc'
import type { ScanProgress } from '../shared/types'
import { IPC } from '../shared/ipc'
import { MM } from './native'
import { join } from './node/path'
import { store, paths, on, sendToRenderer } from './context'
import { moveFromFavorites } from './lib/favorites'
import { scannedFavorite, migrateFavorites } from './lib/favoriteSync'
import { setTokiChallengeHandler, setTokiStatusHandler } from './lib/toki'
import { initThumbDir } from './lib/media'
import { applyNetwork } from './network'
import { libraryApi } from './api/library'
import { favoritesApi } from './api/favorites'
import { hitomiApi } from './api/hitomi'
import { tokiApi } from './api/toki'
import { checkForUpdate, installUpdate } from './update'

// Events with no mobile source (desktop-only: OS close button, mouse forward
// button, auto-updater) — the UI subscribes, nothing ever fires.
const never = (): (() => void) => () => {}

// One-time migration to the in-app general-manga favorites (see desktop main).
async function migrateNormalFavorites(): Promise<void> {
  if (store.settings.normalFavMigrated) return
  const normals = [...store.works.values()].filter((w) => (w.library ?? 'hitomi') === 'normal')
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
  await store.saveSettings({ ...s, downloadDir: join(base, 'hitomi'), normalDownloadDir: join(base, 'manga') })
}

const events: Partial<Api> = {
  onScanProgress: (cb) => on<ScanProgress>(IPC.scanProgress, cb),
  onOrganizeProgress: (cb) => on(IPC.organizeProgress, cb),
  onOnlineFavPreload: (cb) => on(IPC.onlineFavPreloadProgress, cb),
  onClassifyProgress: (cb) => on(IPC.classifyProgress, cb),
  onHitomiProgress: (cb) => on<HitomiProgress>(IPC.hitomiProgress, cb),
  onTokiChallenge: (cb) => on<boolean>(IPC.tokiChallenge, cb),
  onTokiStatus: (cb) => on<string | null>(IPC.tokiStatus, cb),
  onNavBack: (cb) => on(IPC.navBack, cb),
  onRequestClose: (cb) => on(IPC.requestClose, cb),
  onNavForward: never,
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => on<UpdateStatus>(IPC.updateStatus, cb),
  installUpdate: () => installUpdate(),
  hitomiCancelEnrich: hitomiApi.hitomiCancelEnrich
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
  await migrateNormalFavorites()
  await migrateFavorites()
  await initThumbDir()

  // Cloudflare check shown/cleared → "인증 필요" banner in the UI.
  setTokiChallengeHandler((active) => sendToRenderer(IPC.tokiChallenge, active))
  setTokiStatusHandler((msg) => sendToRenderer(IPC.tokiStatus, msg))
  // Android back button → the UI's history back (it decides when to exit).
  await MM.addListener('back', () => sendToRenderer(IPC.navBack))

  window.api = { ...libraryApi, ...favoritesApi, ...hitomiApi, ...tokiApi, ...events } as Api
  // Look for a newer release once the UI has settled.
  setTimeout(() => void checkForUpdate(), 5000)
}
