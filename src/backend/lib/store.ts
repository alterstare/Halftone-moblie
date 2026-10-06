import { sha1 } from '@noble/hashes/legacy.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import * as fs from '../node/fs'
import { join } from '../node/path'
import { utf8 } from '../node/bytes'
import type { Work, Settings, SessionState, OnlineFav, ReadProgress, OnlineHistoryEntry } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { isUnder } from './favorites'

// Plain-JSON persistence. Metadata for a few thousand works fits comfortably in
// memory; searching/sorting happens in JS. Files live in the app's private
// files dir (set by init).

// Stable id for a work. Coded works key on the globally-unique hitomi id.
// Uncoded works hash a basis string: callers pass `uniqueKey` (the full path)
// for general manga, because chapter folder names repeat across series
// ("0001 1 - - 1화", "1화") and a name-only hash collides → one chapter silently
// overwrites another. Hitomi uncoded works pass no uniqueKey so they keep the
// folder-name hash (gallery names are unique, and the id survives a move).
export function deriveId(folderName: string, code: string | null, uniqueKey?: string): string {
  if (code) return `h:${code}`
  const h = bytesToHex(sha1(utf8((uniqueKey ?? folderName).toLowerCase()))).slice(0, 16)
  return `u:${h}`
}

const PROGRESS_MAX = 5000
const HISTORY_MAX = 3000

interface PersistShape {
  works: Work[]
}

export class Store {
  private dir = ''
  private worksFile = ''
  private settingsFile = ''
  private sessionFile = ''
  private onlineFile = ''
  private progressFile = ''
  private historyFile = ''

  works = new Map<string, Work>()
  settings: Settings = { ...DEFAULT_SETTINGS }
  session: SessionState = { tabs: [], activeTabId: null }
  onlineFavs = new Map<string, OnlineFav>()
  // General-manga chapters (local work id or manga-site chapter url) → when last
  // opened. Drives 이어보기 and the "read up to here" mark.
  readProgress: Record<string, ReadProgress> = {}
  private progressTimer: ReturnType<typeof setTimeout> | null = null
  // 기록: online works opened in the reader, by key (doujin code / series url).
  onlineHistory: Record<string, OnlineHistoryEntry> = {}

  private saveTimer: ReturnType<typeof setTimeout> | null = null

  // Point the store at its data dir (must run before load()).
  init(dir: string): void {
    this.dir = dir
    this.worksFile = join(this.dir, 'works.json')
    this.settingsFile = join(this.dir, 'settings.json')
    this.sessionFile = join(this.dir, 'session.json')
    this.onlineFile = join(this.dir, 'online.json')
    this.progressFile = join(this.dir, 'progress.json')
    this.historyFile = join(this.dir, 'history.json')
  }

  async load(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await readJson(this.settingsFile, {})) }
    this.session = await readJson(this.sessionFile, { tabs: [], activeTabId: null })
    const data = await readJson<PersistShape>(this.worksFile, { works: [] })
    this.works = new Map(data.works.map((w) => [w.id, w]))
    const ofavs = await readJson<{ favs: OnlineFav[] }>(this.onlineFile, { favs: [] })
    this.onlineFavs = new Map(ofavs.favs.map((f) => [f.code, f]))
    this.readProgress = await readJson<Record<string, ReadProgress>>(this.progressFile, {})
    this.onlineHistory = await readJson<Record<string, OnlineHistoryEntry>>(this.historyFile, {})
  }

  // Record an online view (newest wins; capped to the most recent HISTORY_MAX).
  async recordOnlineView(e: Omit<OnlineHistoryEntry, 'at'>): Promise<OnlineHistoryEntry> {
    const prev = this.onlineHistory[e.key]
    const next: OnlineHistoryEntry = {
      ...e,
      // Keep a known cover / page count when the new open didn't carry one.
      thumbUrl: e.thumbUrl ?? prev?.thumbUrl ?? null,
      pageCount: e.pageCount || prev?.pageCount || 0,
      at: Date.now()
    }
    this.onlineHistory[e.key] = next
    const keys = Object.keys(this.onlineHistory)
    if (keys.length > HISTORY_MAX) {
      keys
        .sort((a, b) => this.onlineHistory[a].at - this.onlineHistory[b].at)
        .slice(0, keys.length - HISTORY_MAX)
        .forEach((k) => delete this.onlineHistory[k])
    }
    await writeJson(this.historyFile, this.onlineHistory)
    return next
  }

  // Record that a chapter was opened. File write debounced; capped to the most
  // recent PROGRESS_MAX chapters.
  markRead(key: string): void {
    this.readProgress[key] = { at: Date.now() }
    if (this.progressTimer) clearTimeout(this.progressTimer)
    this.progressTimer = setTimeout(() => void this.flushProgress(), 1000)
  }

  async flushProgress(): Promise<void> {
    if (this.progressTimer) clearTimeout(this.progressTimer)
    this.progressTimer = null
    const keys = Object.keys(this.readProgress)
    if (keys.length > PROGRESS_MAX) {
      keys
        .sort((a, b) => this.readProgress[a].at - this.readProgress[b].at)
        .slice(0, keys.length - PROGRESS_MAX)
        .forEach((k) => delete this.readProgress[k])
    }
    await writeJson(this.progressFile, this.readProgress)
  }

  // How a scanned work's heart is decided (installed by favoriteSync at
  // startup): (scanned work, stored predecessor, found inside favoritesDir).
  favoriteRule: ((w: Work, prev: Work | undefined, inFavDir: boolean) => boolean) | null = null

  // Update favorite/rank for an online gallery (hitomi code or toki url); cache
  // its display meta on first touch. Un-favorited + unranked entries are dropped.
  // `addedAt` may be given to keep an original favorite time (migration).
  setOnlineFav(
    code: string,
    patch: { favorite?: boolean; rank?: number; addedAt?: number },
    meta?: Partial<OnlineFav>
  ): OnlineFav {
    const prev = this.onlineFavs.get(code)
    const next: OnlineFav = {
      code,
      favorite: prev?.favorite ?? false,
      rank: prev?.rank ?? 0,
      title: prev?.title ?? meta?.title ?? code,
      artist: prev?.artist ?? meta?.artist ?? null,
      language: prev?.language ?? meta?.language ?? null,
      pageCount: prev?.pageCount ?? meta?.pageCount ?? 0,
      thumbUrl: prev?.thumbUrl ?? meta?.thumbUrl ?? null,
      addedAt: prev?.addedAt ?? Date.now(),
      ...patch
    }
    // Refresh cached meta if newer info arrived.
    if (meta?.title) next.title = meta.title
    if (meta?.artist !== undefined) next.artist = meta.artist
    if (meta?.thumbUrl) next.thumbUrl = meta.thumbUrl
    if (meta?.language !== undefined) next.language = meta.language
    if (meta?.pageCount) next.pageCount = meta.pageCount

    if (!next.favorite && next.rank === 0) this.onlineFavs.delete(code)
    else this.onlineFavs.set(code, next)
    void this.saveOnline()
    return next
  }

  async saveOnline(): Promise<void> {
    await writeJson(this.onlineFile, { favs: [...this.onlineFavs.values()] })
  }

  // Reconcile a freshly-scanned work with the stored one. User state (rank,
  // counts, manual tags, favorite time) is preserved. The scanner marks works
  // found inside the favorites folder with favorite=true; favoriteRule turns
  // that into the real heart (the favorites list is the truth, a newly
  // dragged-in work is added). Group membership still follows the folder
  // location when a favorites dir is configured.
  private reconcile(w: Work, prev: Work | undefined): Work {
    const inFavDir = w.favorite
    const favorite = this.favoriteRule ? this.favoriteRule(w, prev, inFavDir) : (prev?.favorite ?? inFavDir)
    const favoritedAt = favorite ? (prev?.favoritedAt ?? Date.now()) : prev?.favoritedAt
    if (!prev) return { ...w, favorite, favoritedAt }
    const locAuth = (w.library ?? 'hitomi') === 'hitomi' && !!this.settings.favoritesDir
    return {
      ...w,
      tags: w.tags,
      manualTags: prev.manualTags,
      library: w.library ?? prev.library, // location-derived; prefer fresh scan
      favorite,
      favoritedAt,
      groups: locAuth ? w.groups : prev.groups,
      // Where to move back on unheart — only while it still sits in the folder.
      homePath: prev.homePath && isUnder(w.path, this.settings.favoritesDir) ? prev.homePath : null,
      rank: prev.rank,
      viewCount: prev.viewCount,
      lastViewedAt: prev.lastViewedAt,
      addedAt: prev.addedAt,
      coverHash: prev.coverHash,
      coverW: prev.coverW,
      coverH: prev.coverH
    }
  }

  // Full scan: replaces the set entirely (works no longer found are dropped).
  mergeScan(scanned: Work[]): Work[] {
    const next = new Map<string, Work>()
    for (const w of scanned) next.set(w.id, this.reconcile(w, this.works.get(w.id)))
    this.works = next
    this.scheduleSaveWorks()
    return [...this.works.values()]
  }

  // Partial scan (one folder): update/add the scanned works, keep the rest.
  mergeScanPartial(scanned: Work[]): Work[] {
    for (const w of scanned) this.works.set(w.id, this.reconcile(w, this.works.get(w.id)))
    this.scheduleSaveWorks()
    return [...this.works.values()]
  }

  get(id: string): Work | undefined {
    return this.works.get(id)
  }

  update(id: string, patch: Partial<Work>): Work {
    const w = this.works.get(id)
    if (!w) throw new Error(`work not found: ${id}`)
    const merged = { ...w, ...patch }
    this.works.set(id, merged)
    this.scheduleSaveWorks()
    return merged
  }

  remove(id: string): void {
    this.works.delete(id)
    this.scheduleSaveWorks()
  }

  async saveSettings(s: Settings): Promise<Settings> {
    this.settings = s
    await writeJson(this.settingsFile, s)
    return s
  }

  async saveSession(s: SessionState): Promise<void> {
    this.session = s
    await writeJson(this.sessionFile, s)
  }

  private scheduleSaveWorks(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flushWorks(), 400)
  }

  async flushWorks(): Promise<void> {
    const data: PersistShape = { works: [...this.works.values()] }
    await writeJson(this.worksFile, data)
  }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// Atomic (temp file + rename) on the native side.
async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.writeFile(file, JSON.stringify(data), 'utf-8')
}
