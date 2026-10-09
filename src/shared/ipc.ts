// IPC channel names + the shape of the API exposed to the renderer via preload.
import type { Work, Settings, SessionState, ParsedName, DoujinMeta, OnlineFav, ScanProgress, ReadProgress, OnlineHistoryEntry } from './types'

export type OnlineSort = 'date' | 'today' | 'week' | 'month' | 'year' | 'random'

// Ordering for search results. 'date' = nozomi order (newest first);
// 'popular' = reorder by site popularity (year).
export type SearchSort = 'date' | 'popular'

export type DoujinListSource =
  | { kind: 'index'; language: string | null; sort?: OnlineSort }
  | { kind: 'search'; query: string; language: string | null; sort?: SearchSort }

// --- General-manga online (manga-site-family mirror) ---
export type ComicSort = 'date' | 'new' | 'bookmark' | 'view' | 'rating' | 'chapter'
export type ComicType = 'manga' | 'webtoon'
export interface ComicListSource {
  genre: string // '전체' = no filter; otherwise a genre chip label (dynamic per site)
  sort: ComicSort
  type: ComicType
  query?: string // free-text search; overrides genre/sort when present
  field?: 'title' | 'author' // which field `query` searches (default title)
  // Webtoon list only: weekday ('월'…'일', none = all) and platform id (site's
  // numeric id, none = all).
  day?: string
  // Webtoon 분류: 'all' | 'bl' | 'adult' (none = the site default, 일반웹툰).
  cat?: string
  plat?: string
}
// One series card on a manga-site list page.
export interface ComicSummary {
  url: string // series page url (unique id)
  title: string
  thumb: string | null // wrapped mangaimg://comic url
  artist: string | null // author — only known once the series page is scraped
  genre: string | null // genre label shown on the list card
  chapter: string | null // latest chapter label, when shown
}
// One chapter within a series.
export interface ComicChapter {
  url: string // chapter viewer url (unique id)
  title: string
  num: number // detected chapter number (for ordering)
}
export interface ComicListResult {
  items: ComicSummary[]
  page: number
  hasNext: boolean
  genres: string[] // genre chips scraped from the live page (for the filter UI)
  platforms?: { id: string; name: string }[] // webtoon platform chips (live page)
}

export const IPC = {
  pickFolder: 'dialog:pickFolder',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  scanLibrary: 'library:scan',
  scanFolder: 'library:scanFolder', // rescan one folder, infer favorite/group from location
  scanProgress: 'library:scanProgress', // main -> renderer event
  organizeLanguages: 'library:organizeLanguages',
  organizeByGenre: 'library:organizeByGenre',
  organizeProgress: 'library:organizeProgress', // main -> renderer event
  getWorks: 'works:getAll',
  getWorkImages: 'works:getImages',
  imageUrl: 'works:imageUrl',
  setFavorite: 'works:setFavorite',
  setNormalFav: 'works:setNormalFav',
  setRank: 'works:setRank',
  setCoverHash: 'works:setCoverHash',
  setWorkGroups: 'works:setGroups',
  deleteGroup: 'works:deleteGroup',
  renameGroup: 'works:renameGroup',
  doujinFindKorean: 'doujin:findKorean',
  doujinFindEditions: 'doujin:findEditions',
  exportFavorites: 'fav:export',
  importFavorites: 'fav:import',
  importOnlineFavList: 'fav:importOnlineList',
  removeOnlineFavList: 'fav:removeOnlineList',
  doujinSummaries: 'doujin:summaries',
  preloadOnlineFavLists: 'fav:preloadOnline',
  onlineFavPreloadProgress: 'fav:preloadProgress',
  mergeFavorites: 'fav:merge',
  exportRatings: 'ratings:export',
  importRatings: 'ratings:import',
  mergeRatings: 'ratings:merge',
  getOnlineFavs: 'online:getFavs',
  getReadProgress: 'progress:get',
  markRead: 'progress:markRead',
  setOnlineFav: 'online:setFav',
  setFavoriteByCode: 'fav:setByCode',
  addManualTag: 'works:addManualTag',
  removeManualTag: 'works:removeManualTag',
  incrementView: 'works:incrementView',
  openInExplorer: 'works:openInExplorer',
  clipboardReadText: 'app:clipboardReadText',
  clipboardWriteText: 'app:clipboardWriteText',
  saveImageToDownloads: 'app:saveImageToDownloads',
  deleteWork: 'works:delete',
  mergeSeries: 'works:mergeSeries',
  renameNormalChapters: 'works:renameNormalChapters',
  classifyDeleted: 'works:classifyDeleted',
  classifyProgress: 'works:classifyProgress',
  getSession: 'session:get',
  saveSession: 'session:save',
  parseName: 'util:parseName',
  doujinFetchMeta: 'doujin:fetchMeta',
  doujinEnrich: 'doujin:enrich',
  doujinEnrichAll: 'doujin:enrichAll',
  doujinCancelEnrich: 'doujin:cancelEnrich',
  doujinDownload: 'doujin:download',
  doujinProgress: 'doujin:progress', // main -> renderer event
  downloadStop: 'download:stop', // abort a running/queued download by code
  doujinList: 'doujin:list',
  doujinSuggest: 'doujin:suggest', // online search autocomplete (artists + seen tags)
  listAvifPaths: 'convert:listAvif', // a work's .avif files (path + mangaimg url)
  replaceAvifWithWebp: 'convert:replaceWebp', // write .webp, delete the .avif
  doujinReadUrls: 'doujin:readUrls',
  doujinRegenCover: 'doujin:regenCover',
  comicList: 'comic:list',
  comicChapters: 'comic:chapters',
  comicReadUrls: 'comic:readUrls',
  comicDownload: 'comic:download',
  comicDownloadChapters: 'comic:downloadChapters',
  comicRegenCover: 'comic:regenCover',
  comicSeriesAuthor: 'comic:seriesAuthor',
  comicSeriesTitle: 'comic:seriesTitle',
  comicFillArtist: 'comic:fillArtist',
  comicScrapeList: 'comic:scrapeList',
  comicDownloadGeneric: 'comic:downloadGeneric',
  comicOpenSite: 'comic:openSite',
  comicChallenge: 'comic:challenge', // main -> renderer: Cloudflare auth window shown/cleared
  comicStatus: 'comic:status', // main -> renderer: what the manga-site scraper is doing (null = idle)
  saveThumb: 'thumb:save',
  getThumb: 'thumb:get',
  pickImage: 'dialog:pickImage',
  doujinPing: 'doujin:ping',
  doujinPopularRanks: 'doujin:popularRanks',
  openFolder: 'util:openFolder',
  closeWindow: 'app:closeWindow', // renderer -> main: exit decision
  navBack: 'app:navBack', // main -> renderer: mouse/back-command → go back
  updateStatus: 'update:status', // main -> renderer: auto-update progress/state
  installUpdate: 'update:install', // renderer -> main: quit and install the downloaded update
  resetApp: 'app:reset' // renderer -> main: wipe settings/library data (+ optionally work folders), relaunch
} as const

// A NAS connection (WebDAV or SMB). Its folders are paths /nas/<id>/<path>.
// The password never leaves the native side (hasPassword tells if one is set).
export interface NasConn {
  id: string // '' when new
  name: string
  type: 'webdav' | 'smb'
  url: string // WebDAV: http(s)://host:port/base
  host: string // SMB
  port: number // SMB (0 = 445)
  share: string // SMB share name
  domain: string // SMB (usually empty)
  user: string
  insecure: boolean // WebDAV https with a self-signed certificate
  hasPassword?: boolean
}

// Auto-update lifecycle surfaced in the activity bar.
export interface UpdateStatus {
  state: 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number // 0-100 while downloading
  error?: string
}

// User's choice in the exit modal.
export type CloseDecision = 'keep' | 'clear' | 'cancel'

export interface DoujinProgress {
  code: string
  title: string
  done: number
  total: number
  phase:
    | 'queued'
    | 'fetching'
    | 'downloading'
    | 'enriching'
    | 'converting'
    | 'done'
    | 'error'
    | 'stopped'
  message?: string
}

export interface GallerySummary {
  code: string
  title: string
  artists: string[]
  tags: string[]
  language: string | null
  type: string | null
  pageCount: number
  thumbUrl: string | null
}

export interface DoujinListResult {
  items: GallerySummary[]
  total: number
  page: number
  pageSize: number
}

export interface Api {
  pickFolder: () => Promise<string | null>
  getSettings: () => Promise<Settings>
  saveSettings: (s: Settings) => Promise<Settings>
  scanLibrary: () => Promise<Work[]>
  // Rescan a single folder; works get favorite/group inferred from their path.
  scanFolder: (root: string) => Promise<Work[]>
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void
  organizeLanguages: () => Promise<Work[]>
  organizeByGenre: () => Promise<{ works: Work[]; moved: number }>
  onOrganizeProgress: (cb: (p: { moved: number; current: string; done: boolean }) => void) => () => void
  getWorks: () => Promise<Work[]>
  getWorkImages: (workId: string) => Promise<string[]> // file:// urls in page order
  setFavorite: (workId: string, fav: boolean) => Promise<Work>
  // General-manga in-app favorite: toggle a series (by key) or a single chapter
  // (by work id). Returns the updated settings (holding the fav lists).
  setNormalFav: (kind: 'series' | 'chapter', key: string, fav: boolean) => Promise<Settings>
  setRank: (workId: string, rank: number) => Promise<Work>
  setCoverHash: (workId: string, hash: string, w?: number, h?: number) => Promise<Work>
  setWorkGroups: (workId: string, groupIds: string[]) => Promise<Work>
  // Delete a group: drops it from settings, moves its works out of the group
  // folder, and strips the group id from those works. Returns fresh state.
  deleteGroup: (groupId: string) => Promise<{ settings: Settings; works: Work[] }>
  renameGroup: (groupId: string, name: string) => Promise<{ settings: Settings; works: Work[] }>
  doujinFindKorean: (payload: {
    code: string | null
    artist: string | null
    title: string
  }) => Promise<GallerySummary[]>           // Korean editions of a work
  doujinFindEditions: (payload: {
    code: string | null
    artist: string | null
    title: string
    language?: string | null
  }) => Promise<Record<'korean' | 'japanese' | 'english', (GallerySummary & { similar?: boolean })[]>>
  // Favorites ⇄ Pupil-compatible JSON ({favorites, favorite_tags, ranks}).
  // Export = every favorited gallery code; import merges (hearts the codes,
  // syncing downloaded works) and returns how many were already downloaded.
  exportFavorites: () => Promise<{ ok: boolean; count: number; path?: string }>
  importFavorites: () => Promise<{ ok: boolean; matched: number; total: number }>
  // Favorite lists: import a file as a named list of codes, remove one, and
  // fetch gallery summaries for a set of codes (to render a list).
  importOnlineFavList: () => Promise<{ ok: boolean; name: string; total: number }>
  removeOnlineFavList: (name: string) => Promise<{ ok: boolean }>
  doujinSummaries: (codes: string[]) => Promise<GallerySummary[]>
  preloadOnlineFavLists: () => Promise<{ ok: boolean; total: number; cached: number }>
  onOnlineFavPreload: (cb: (p: { done: number; total: number }) => void) => () => void
  // Merge 2+ favorite files into one new file (union); no library change.
  mergeFavorites: () => Promise<{ ok: boolean; count: number; files: number; path?: string }>
  // Rating files, per library mode (동인지 / 일반 만화 kept separate).
  exportRatings: (lib: 'doujin' | 'normal') => Promise<{ ok: boolean; count: number; path?: string }>
  importRatings: (lib: 'doujin' | 'normal') => Promise<{ ok: boolean; applied: number; total: number }>
  mergeRatings: (lib: 'doujin' | 'normal') => Promise<{ ok: boolean; count: number; files: number; path?: string }>
  // Online (doujin) favorites + ranks, keyed by gallery code.
  getOnlineFavs: () => Promise<OnlineFav[]>
  getReadProgress: () => Promise<Record<string, ReadProgress>>
  // 기록: online works opened in the reader (local works use lastViewedAt).
  getOnlineHistory: () => Promise<Record<string, OnlineHistoryEntry>>
  recordOnlineView: (e: Omit<OnlineHistoryEntry, 'at'>) => Promise<OnlineHistoryEntry>
  markRead: (key: string) => Promise<void>
  setOnlineFav: (
    code: string,
    patch: { favorite?: boolean; rank?: number },
    meta?: Partial<OnlineFav>
  ) => Promise<OnlineFav>
  // Heart / unheart a doujin gallery by code: updates the favorites list and
  // every local work with that code (moving folders per favoriteMoveToFolder).
  setFavoriteByCode: (
    code: string,
    fav: boolean,
    meta?: Partial<OnlineFav>
  ) => Promise<{ fav: OnlineFav; works: Work[] }>
  addManualTag: (workId: string, tag: string) => Promise<Work>
  removeManualTag: (workId: string, tag: string) => Promise<Work>
  incrementView: (workId: string) => Promise<Work>
  openInExplorer: (workId: string) => Promise<void>
  // NAS (WebDAV / SMB) connections + folder browsing.
  nasList: () => Promise<NasConn[]>
  nasTest: (conn: NasConn, password: string | null) => Promise<{ ok: boolean; count?: number; error?: string }>
  nasSave: (conn: NasConn, password: string | null) => Promise<string>
  nasRemove: (id: string) => Promise<void>
  listDirs: (path: string) => Promise<string[]>
  appVersion: () => Promise<string> // installed versionName (설정 header)
  // Remember the theme natively → the WebView background at the next start.
  setNativeTheme?: (dark: boolean) => Promise<void>
  imageCacheInfo: () => Promise<{ bytes: number; files: number }>
  clearImageCache: () => Promise<void>
  clipboardReadText: () => Promise<string> // for the text-field 붙여넣기 menu
  clipboardWriteText: (text: string) => Promise<void> // 복사 menus (works even when the window isn't focused)
  // Reader 이미지 저장: copy a page image into the phone's Download folder
  // (shows a toast with the saved name).
  saveImageToDownloads: (src: string, name?: string) => Promise<void>
  deleteWork: (workId: string) => Promise<void>
  // Merge several general-manga works into one series folder (chapters become
  // subfolders of a single <root>/<title> folder). Returns the moved works.
  mergeSeries: (title: string, workIds: string[]) => Promise<Work[]>
  // Rename general-manga chapter folders in place to the given names (the caller
  // computes "<n>화 <subtitle>" per work). Returns the updated works.
  renameNormalChapters: (items: { id: string; name: string }[]) => Promise<Work[]>
  // Sweep doujin-coded works that 404 on doujin (deleted) into settings.deletedDir.
  // Returns a summary + the refreshed works. Progress via onClassifyProgress.
  classifyDeleted: () => Promise<{ moved: number; checked: number; uncertain: number; works: Work[] }>
  onClassifyProgress: (
    cb: (p: { done: number; total: number; moved: number; current: string; finished: boolean }) => void
  ) => () => void
  getSession: () => Promise<SessionState>
  saveSession: (s: SessionState) => Promise<void>
  parseName: (folderName: string) => Promise<ParsedName>
  doujinFetchMeta: (code: string) => Promise<DoujinMeta>
  doujinEnrich: (workId: string) => Promise<Work>
  doujinEnrichAll: () => Promise<Work[]>
  doujinCancelEnrich: () => Promise<void>
  doujinDownload: (input: string) => Promise<Work> // input = code or doujin url
  // Abort a running/queued download by its progress code (doujin code, manga-site
  // seriesUrl, or "backup:<title>"). No-op if that code isn't downloading.
  downloadStop: (code: string) => Promise<boolean>
  onDoujinProgress: (cb: (p: DoujinProgress) => void) => () => void
  doujinList: (source: DoujinListSource, page: number) => Promise<DoujinListResult>
  doujinSuggest: (query: string) => Promise<string[]>
  // avif→webp conversion (Pupil compatibility). List a work's avif files, then
  // replace each with a webp (encoded by the renderer's canvas).
  listAvifPaths: (workId: string) => Promise<{ path: string; url: string }[]>
  replaceAvifWithWebp: (avifPath: string, webpBase64: string) => Promise<void>
  doujinReadUrls: (code: string) => Promise<string[]>
  doujinRegenCover: (workId: string, code: string) => Promise<{ ok: boolean; error?: string }>
  // General-manga online (manga-site-family). Scraped via a hidden BrowserWindow.
  comicList: (source: ComicListSource, page: number) => Promise<ComicListResult>
  comicChapters: (seriesUrl: string) => Promise<ComicChapter[]>
  comicReadUrls: (chapterUrl: string, fresh?: boolean) => Promise<string[]> // wrapped image urls; fresh = reload the page
  // Download every chapter of a series into the general-manga library. Progress
  // is reported on the doujinProgress channel (code = seriesUrl). Returns the
  // newly scanned chapter works.
  comicDownload: (seriesUrl: string, title: string) => Promise<Work[]>
  // Download only the given chapter urls of a series (선택 화 / 이어서 다운로드).
  comicDownloadChapters: (seriesUrl: string, title: string, chapterUrls: string[]) => Promise<Work[]>
  // Regenerate the cover thumbnail for the given works from the online source,
  // searching by series title. Writes to each work's thumb file.
  comicRegenCover: (workIds: string[], title: string) => Promise<{ ok: boolean; error?: string }>
  // Scrape the author(s) of a series from its page (comma-joined, or null).
  comicSeriesAuthor: (seriesUrl: string) => Promise<string | null>
  comicSeriesTitle: (seriesUrl: string) => Promise<string | null>
  // Fill the artist field on the given works by searching the online source for
  // `title`, taking the first result's author. Returns the updated works.
  comicFillArtist: (workIds: string[], title: string) => Promise<Work[]>
  // Backup (gnuboard) sites: scrape the chapter list from the page currently
  // loaded in the site window (the user navigates there by hand).
  comicScrapeList: () => Promise<ComicChapter[]>
  // Download the given scraped chapters in the background (site window not
  // needed open). `only` limits to those chapter urls. Returns new works.
  comicDownloadGeneric: (
    title: string,
    chapters: ComicChapter[],
    only?: string[]
  ) => Promise<Work[]>
  // Open a site in a visible window so the user can clear Cloudflare / log in, or
  // navigate a backup site. Pass `url` to open a specific address.
  comicOpenSite: (url?: string) => Promise<void>
  saveThumb: (workId: string, dataUrl: string) => Promise<string>
  getThumb: (workId: string) => Promise<string | null>
  pickImage: () => Promise<string | null> // returns a mangaimg:// url for the chosen image
  doujinPing: () => Promise<{ dohIp: string | null; ltnOk: boolean; error: string | null }>
  doujinPopularRanks: (codes: string[]) => Promise<Record<string, number>>
  openFolder: (path: string) => Promise<void>
  // Main asks the renderer to show the styled exit modal.
  // Auto-update state pushed from main (available → downloading → downloaded).
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => () => void
  // User clicked "지금 재시작" on the downloaded-update row → quit + install.
  installUpdate: () => void
  // Wipe all app data (settings/library/session). deleteWorkFolders also removes
  // every scanned work's folder from disk. Relaunches the app. Never resolves.
  resetApp: (deleteWorkFolders: boolean) => Promise<void>
  // Cloudflare auth window shown (true) / cleared (false) — show a banner.
  onComicChallenge: (cb: (active: boolean) => void) => () => void
  onComicStatus: (cb: (msg: string | null) => void) => () => void
  // Mouse "back" side button / browser-backward app command → go back.
  onNavBack: (cb: () => void) => () => void
  // Mouse "forward" side button / browser-forward app command → go forward.
  // Renderer reports the exit decision. For 'keep', pass the live tab session.
  closeWindow: (decision: CloseDecision, session?: SessionState) => Promise<void>
}

declare global {
  interface Window {
    api: Api
  }
}
