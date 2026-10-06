// API: the local library — settings, scanning, works (favorite / rank / groups /
// tags / views), folder operations, session, thumbnails and the exit/reset
// flow. Mobile port of the desktop main/ipc/library.ts.
import type { Settings, SessionState, Work } from '../../shared/types'
import type { Api, CloseDecision, NasConn } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import * as fs from '../node/fs'
import { join, resolve, sep, basename, dirname } from '../node/path'
import { MM } from '../native'
import { store, paths, sendToRenderer } from '../context'
import { scanLibrary, scanRoot, listImages, normalRoots } from '../lib/scanner'
import { parseName } from '../lib/parser'
import { setGroupFolder, mergeSeries, moveWorkToFolder, renameGroupFolders, safeName } from '../lib/favorites'
import { setWorkFavorite } from '../lib/favoriteSync'
import { organizeByLanguage } from '../lib/organize'
import { applyNetwork } from '../network'
import { encodeImg, thumbFile, isRawThumb, rawMarker } from '../lib/media'
import { ensureStorage } from '../storage'

const allWorks = (): Work[] => [...store.works.values()]

// Move non-Korean works into their configured language folders.
async function runOrganize(): Promise<Work[]> {
  const moved = await organizeByLanguage(allWorks(), store.settings, (n, title) =>
    sendToRenderer(IPC.organizeProgress, { moved: n, current: title, done: false })
  )
  for (const m of moved) store.update(m.id, { path: m.path })
  await store.flushWorks()
  sendToRenderer(IPC.organizeProgress, { moved: moved.length, current: '', done: true })
  return allWorks()
}

export const libraryApi: Partial<Api> = {
  // ---------- pickers / settings ----------

  pickFolder: async () => (await MM.pickFolder()).path,

  pickImage: async () => {
    const r = await MM.pickFiles({ mime: 'image/*', as: 'file' })
    const f = r.files[0]
    return f?.path ? encodeImg(f.path) : null
  },

  getSettings: async () => store.settings,

  saveSettings: async (s: Settings) => {
    const saved = await store.saveSettings(s)
    await applyNetwork(saved)
    return saved
  },

  parseName: async (name: string) => parseName(name, store.settings.doujinNamePatterns),

  // ---------- scanning / organizing ----------

  scanLibrary: async () => {
    const s = store.settings
    await ensureStorage([...s.libraryRoots, ...normalRoots(s), s.downloadDir, s.normalDownloadDir])
    const scanned = await scanLibrary(store.settings, {
      onProgress: (n, current) => sendToRenderer(IPC.scanProgress, { scanned: n, total: 0, current, done: false })
    })
    const merged = store.mergeScan(scanned)
    await store.flushWorks()
    sendToRenderer(IPC.scanProgress, { scanned: merged.length, total: merged.length, current: '', done: true })
    if (store.settings.autoOrganizeOnScan) await runOrganize()
    return allWorks()
  },

  // Rescan just one folder (favorites / a library root / download dir).
  scanFolder: async (root: string) => {
    await ensureStorage([root])
    const merged = store.mergeScanPartial(await scanRoot(root, store.settings))
    await store.flushWorks()
    return merged
  },

  organizeLanguages: () => runOrganize(),

  // Move works into a genre rule's destination folder based on their tags
  // (first matching rule wins).
  organizeByGenre: async () => {
    const rules = store.settings.genreRules.filter((r) => r.genre && r.moveDir)
    let moved = 0
    for (const w of allWorks()) {
      const tags = [...(w.tags ?? []), ...(w.manualTags ?? [])]
      const rule = rules.find((r) => tags.includes(r.genre))
      if (!rule || dirname(w.path) === rule.moveDir) continue
      try {
        store.update(w.id, await moveWorkToFolder(w, rule.moveDir as string))
        moved++
      } catch {
        /* skip this work */
      }
    }
    await store.flushWorks()
    return { works: allWorks(), moved }
  },

  // ---------- works ----------

  getWorks: async () => allWorks(),

  getWorkImages: async (workId: string) => {
    const w = store.get(workId)
    if (!w) return []
    let files: string[]
    if (w.sources?.length) {
      // Collection work: concatenate each source folder's images, then trim.
      files = []
      for (const s of w.sources) files.push(...(await listImages(s)))
      files = files.slice(store.settings.excludeLeadingPages)
    } else {
      files = await listImages(w.path, store.settings.excludeLeadingPages)
    }
    return files.map(encodeImg)
  },

  setFavorite: (workId: string, fav: boolean) => setWorkFavorite(workId, fav),

  // General-manga in-app favorites: toggle a series (by key) or a single chapter
  // (by work id), stamping normalFavAt for ordering.
  setNormalFav: async (kind: 'series' | 'chapter', key: string, fav: boolean) => {
    const field = kind === 'series' ? 'normalFavSeries' : 'normalFavChapters'
    const cur = store.settings[field] ?? []
    const next = fav ? [...new Set([...cur, key])] : cur.filter((x) => x !== key)
    const at = { ...(store.settings.normalFavAt ?? {}) }
    if (fav) at[key] = at[key] ?? Date.now()
    else delete at[key]
    return store.saveSettings({ ...store.settings, [field]: next, normalFavAt: at })
  },

  setRank: async (workId: string, rank: number) => store.update(workId, { rank: Math.max(0, Math.min(5, rank)) }),

  setCoverHash: async (workId: string, hash: string, w?: number, h?: number) =>
    store.update(workId, { coverHash: hash, coverW: w, coverH: h }),

  // Single group membership; also moves the work folder into/out of the group folder.
  setWorkGroups: async (workId: string, groupIds: string[]) => {
    const w = store.get(workId)
    if (!w) throw new Error('no work')
    const updated = store.update(workId, await setGroupFolder(w, groupIds, store.settings.groups))
    await store.flushWorks()
    return updated
  },

  // Rename a group: rename its folders on disk (see renameGroupFolders), move
  // every stored path under them, then save the new name.
  renameGroup: async (groupId: string, name: string) => {
    const g = store.settings.groups.find((x) => x.id === groupId)
    if (!g) throw new Error('그룹을 찾을 수 없습니다')
    const n = name.trim()
    if (!n) throw new Error('그룹 이름을 입력하세요')
    const mode = g.mode ?? 'doujin'
    const key = safeName(n).toLowerCase()
    if (
      store.settings.groups.some(
        (x) => x.id !== groupId && (x.mode ?? 'doujin') === mode && safeName(x.name).toLowerCase() === key
      )
    )
      throw new Error('같은 이름의 그룹이 이미 있습니다')
    const members = allWorks().filter((w) => (w.groups ?? []).includes(groupId))
    const moved = await renameGroupFolders(members, g.name, n)
    if (moved.size) {
      const remap = (p: string | null | undefined): string | null | undefined => {
        if (!p) return p
        for (const [from, to] of moved) {
          if (p === from) return to
          if (p.startsWith(from + sep)) return to + p.slice(from.length)
        }
        return p
      }
      for (const w of allWorks()) {
        const path = remap(w.path) as string
        const homePath = remap(w.homePath) ?? null
        if (path !== w.path || homePath !== w.homePath) store.update(w.id, { path, homePath })
      }
    }
    const settings = await store.saveSettings({
      ...store.settings,
      groups: store.settings.groups.map((x) => (x.id === groupId ? { ...x, name: n } : x))
    })
    await store.flushWorks()
    return { settings, works: allWorks() }
  },

  deleteGroup: async (groupId: string) => {
    for (const w of allWorks()) {
      if (!(w.groups ?? []).includes(groupId)) continue
      try {
        store.update(w.id, await setGroupFolder(w, [], store.settings.groups))
      } catch {
        store.update(w.id, { groups: (w.groups ?? []).filter((g) => g !== groupId) })
      }
    }
    const settings = await store.saveSettings({
      ...store.settings,
      groups: store.settings.groups.filter((g) => g.id !== groupId)
    })
    await store.flushWorks()
    return { settings, works: allWorks() }
  },

  // Manual tags. "language:" / "artist:" prefixes set that field instead.
  addManualTag: async (workId: string, tag: string) => {
    const w = store.get(workId)!
    const raw = tag.trim()
    if (!raw) return w
    const low = raw.toLowerCase()
    if (low.startsWith('language:')) return store.update(workId, { language: raw.slice(9).trim() || null })
    if (low.startsWith('artist:')) return store.update(workId, { artist: raw.slice(7).trim() || null })
    return store.update(workId, { manualTags: [...new Set([...w.manualTags, low])] })
  },

  removeManualTag: async (workId: string, tag: string) => {
    const w = store.get(workId)!
    return store.update(workId, { manualTags: w.manualTags.filter((t) => t !== tag) })
  },

  incrementView: async (workId: string) => {
    const w = store.get(workId)!
    return store.update(workId, { viewCount: w.viewCount + 1, lastViewedAt: Date.now() })
  },

  // ---------- clipboard (텍스트 필드 붙여넣기 / 복사 메뉴) ----------

  // ---------- NAS (WebDAV / SMB) ----------

  nasList: async () => (await MM.nasList()).conns,
  nasTest: async (conn: NasConn, password: string | null) => {
    try {
      const r = await MM.nasTest({ conn, password })
      return { ok: true, count: r.count }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  },
  nasSave: async (conn: NasConn, password: string | null) => (await MM.nasSave({ conn, password })).id,
  nasRemove: async (id: string) => {
    await MM.nasRemove({ id })
  },
  imageCacheInfo: () => MM.imageCacheInfo(),
  clearImageCache: () => MM.clearImageCache(),
  // Sub-folders of a folder (NAS browser).
  listDirs: async (path: string) => {
    const entries = await fs.readdir(path, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('@') && !e.name.startsWith('#'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
  },

  clipboardReadText: async () => (await MM.clipboardRead()).text ?? '',
  clipboardWriteText: async (text: string) => {
    await MM.clipboardWrite({ text: String(text ?? '') })
  },
  saveImageToDownloads: async (src: string, name?: string) => {
    try {
      const r = await MM.saveImageToDownloads({ src, name })
      await MM.toast({ text: `다운로드 폴더에 저장: ${r.name}` })
    } catch (e: any) {
      await MM.toast({ text: `이미지 저장 실패: ${String(e?.message ?? e)}` })
    }
  },

  // ---------- folders on disk ----------

  // No file manager hand-off on Android: show where the folder is.
  openInExplorer: async (workId: string) => {
    const w = store.get(workId)
    if (w) await MM.toast({ text: w.path })
  },

  openFolder: async (path: string) => {
    if (path) await MM.toast({ text: path })
  },

  deleteWork: async (workId: string) => {
    const w = store.get(workId)
    if (!w) return
    await fs.rm(w.path, { recursive: true, force: true })
    store.remove(workId)
  },

  // Merge general-manga works into one series folder under the deepest normal
  // root that contains the first work.
  mergeSeries: async (title: string, workIds: string[]) => {
    const works = workIds.map((id) => store.get(id)).filter(Boolean) as Work[]
    if (works.length < 2) return []
    const rp = resolve(works[0].path)
    let root = ''
    for (const r of normalRoots(store.settings)) {
      const rr = resolve(r)
      if ((rp === rr || rp.startsWith(rr + sep)) && rr.length > root.length) root = rr
    }
    if (!root) root = resolve(works[0].path, '..', '..')
    const patches = await mergeSeries(works, title, root)
    const updated = Object.entries(patches).map(([id, patch]) => store.update(id, patch))
    await store.flushWorks()
    return updated
  },

  // Rename general-manga chapter folders in place (names computed by the UI).
  renameNormalChapters: async (items: { id: string; name: string }[]) => {
    const clean = (s: string): string =>
      s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled'
    const updated: Work[] = []
    for (const it of items) {
      const w = store.get(it.id)
      if (!w || !w.path || (w.sources && w.sources.length)) continue
      const parent = dirname(w.path)
      const target = clean(it.name)
      if (!target || basename(w.path) === target) continue
      let dest = join(parent, target)
      let i = 2
      while (dest !== w.path && (await fs.exists(dest))) dest = join(parent, `${target} (${i++})`)
      try {
        await fs.rename(w.path, dest)
        updated.push(store.update(it.id, { path: dest }))
      } catch {
        /* skip a folder that can't be renamed */
      }
    }
    await store.flushWorks()
    return updated
  },

  // avif→webp conversion: list a work's avif files (with a loadable url)…
  listAvifPaths: async (workId: string) => {
    const w = store.works.get(workId)
    if (!w) return []
    const names = (await fs.readdir(w.path)).filter((f) => /\.avif$/i.test(f)).sort()
    return names.map((n) => {
      const p = join(w.path, n)
      return { path: p, url: encodeImg(p) }
    })
  },
  // …then write each UI-encoded webp next to its avif and delete the avif.
  replaceAvifWithWebp: async (avifPath: string, webpBase64: string) => {
    const webpPath = avifPath.replace(/\.avif$/i, '.webp')
    await fs.writeFileB64(webpPath, webpBase64)
    if (webpPath.toLowerCase() !== avifPath.toLowerCase()) await fs.rm(avifPath).catch(() => {})
  },

  // ---------- thumbnails ----------

  // Save a UI-generated thumb (data: URL) and return its loadable url.
  saveThumb: async (workId: string, dataUrl: string) => {
    const file = thumbFile(workId)
    await fs.writeFileB64(file, dataUrl.slice(dataUrl.indexOf(',') + 1))
    await fs.rm(rawMarker(file), { force: true })
    return encodeImg(file) + '?v=' + Date.now()
  },

  // Url of a work's cached thumb, or null. Versioned by mtime (?v=…); "#raw"
  // asks the UI to shrink a full-size cover.
  getThumb: async (workId: string) => {
    const file = thumbFile(workId)
    try {
      const st = await fs.stat(file)
      const raw = await isRawThumb(file).catch(() => false)
      return encodeImg(file) + '?v=' + Math.floor(st.mtimeMs) + (raw ? '#raw' : '')
    } catch {
      return null
    }
  },

  // ---------- session / exit / reset ----------

  getSession: async () => store.session,
  saveSession: (s: SessionState) => store.saveSession(s),

  // Exit modal decision: keep (persist tabs for next launch) / clear / cancel.
  closeWindow: async (decision: CloseDecision, sess?: SessionState) => {
    if (decision === 'cancel') return
    if (decision === 'keep') {
      if (sess) await store.saveSession(sess)
    } else {
      await store.saveSession({ tabs: [], activeTabId: null })
    }
    await store.flushWorks()
    await store.flushProgress()
    await MM.exitApp()
  },

  // Full reset: wipe app data (and optionally every work folder), then reload.
  resetApp: async (deleteWorkFolders: boolean) => {
    if (deleteWorkFolders) {
      for (const w of store.works.values()) await fs.rm(w.path, { recursive: true, force: true }).catch(() => {})
    }
    for (const f of ['works.json', 'settings.json', 'session.json', 'online.json', 'progress.json', 'history.json', 'doujin-suggest-seen.json', 'onlineSummaries.json']) {
      await fs.rm(join(paths.data, f), { force: true }).catch(() => {})
    }
    await fs.rm(join(paths.data, 'thumbs'), { recursive: true, force: true }).catch(() => {})
    await MM.restartApp()
  }
}
