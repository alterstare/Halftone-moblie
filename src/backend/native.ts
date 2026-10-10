import type { NasConn } from '../shared/ipc'
// Binding to the native Capacitor plugin (android/…/MMPlugin.java). Every path
// is an absolute file-system path.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface FsEntry {
  name: string
  exists: boolean
  isDir: boolean
  isFile: boolean
  size: number
  mtime: number
}

export type NetKind = 'doujin' | 'comic' | 'plain'

export interface MMPlugin {
  // NAS connections (passwords stay native).
  nasList(): Promise<{ conns: NasConn[] }>
  nasTest(o: { conn: NasConn; password: string | null }): Promise<{ count: number }>
  nasSave(o: { conn: NasConn; password: string | null }): Promise<{ id: string }>
  nasRemove(o: { id: string }): Promise<void>
  // Installed app version (versionName).
  appInfo(): Promise<{ version: string; code: number }>
  // Hand a downloaded APK to the system installer (asks for "unknown apps"
  // permission first when needed).
  installApk(o: { path: string }): Promise<{ needPermission?: boolean }>
  getPaths(): Promise<{ files: string; cache: string; external: string; download: string; sdk: number }>
  storageStatus(): Promise<{ granted: boolean }>
  requestStorage(): Promise<{ granted: boolean }>

  // offset/length: read a byte range (big files go through in pieces).
  fsRead(o: { path: string; encoding?: 'utf8' | 'base64'; offset?: number; length?: number }): Promise<{ data: string }>
  // part: 'new' / 'append' write <path>.part; commit renames it over <path>.
  fsWrite(o: {
    path: string
    data: string
    encoding?: 'utf8' | 'base64'
    append?: boolean
    part?: 'new' | 'append'
    commit?: boolean
  }): Promise<void>
  fsStat(o: { path: string }): Promise<Omit<FsEntry, 'name'>>
  fsReaddir(o: { path: string }): Promise<{ entries: FsEntry[] }>
  fsMkdir(o: { path: string }): Promise<void>
  fsRm(o: { path: string; recursive?: boolean }): Promise<void>
  fsRename(o: { from: string; to: string }): Promise<void>

  httpGet(o: {
    url: string
    kind?: NetKind
    headers?: Record<string, string>
    responseType?: 'text' | 'base64'
  }): Promise<{ status: number; headers: Record<string, string>; data: string }>
  httpDownload(o: {
    url: string
    kind?: NetKind
    headers?: Record<string, string>
    path: string
  }): Promise<{ size: number }>
  imageToFile(o: { url: string; kind: NetKind; path: string }): Promise<void>
  // Copy a reader image (/_mm/… url) into the public Download folder.
  saveImageToDownloads(o: { src: string; name?: string }): Promise<{ name: string }>
  doh(o: { name: string; type: string }): Promise<{ answers: { type: number; data: string }[] }>
  // tunnel = SNI-bypass proxy (Tunnel.java) for the manga-site traffic.
  setNetwork(o: { proxy: string; comicBase: string; doujinSite: string; tunnel: boolean }): Promise<{ tunnelPort: number }>
  netReset(): Promise<void>
  clipboardRead(): Promise<{ text: string }>
  clipboardWrite(o: { text: string }): Promise<void>
  clearImageCache(): Promise<void>
  mediaScan(o: { paths: string[] }): Promise<void>
  setTheme(o: { dark: boolean }): Promise<void>
  setImageCache(o: { mb: number }): Promise<void>
  imageCacheInfo(): Promise<{ bytes: number; files: number }>

  pickFolder(): Promise<{ path: string | null }>
  pickFiles(o: { mime?: string; multiple?: boolean; as?: 'text' | 'file' }): Promise<{
    files: { name: string; text?: string; path?: string }[]
  }>
  saveTextFile(o: { name: string; text: string; mime?: string }): Promise<{ ok: boolean; name?: string }>

  comicLoad(o: { url: string }): Promise<{ nav: number }>
  comicState(): Promise<{
    nav: number
    committed: boolean
    errorCode: number
    errorDesc: string
    url: string
    visible: boolean
  }>
  comicEval(o: { script: string }): Promise<{ json: string }>
  comicShow(o: { title?: string }): Promise<void>
  comicHide(): Promise<void>
  comicCookie(o: { url: string }): Promise<{ cookie: string | null }>

  // Background downloads: active = keep the foreground service + progress
  // notification up (DownloadService.java); false = stop it.
  // keepOnExit: 뒤로가기 / 종료 only backgrounds the app while downloads run.
  downloadService(o: {
    active: boolean
    keepOnExit?: boolean
    pip?: boolean
    title?: string
    text?: string
    done?: number
    total?: number
  }): Promise<void>

  toast(o: { text: string }): Promise<void>
  exitApp(o?: { keepDownloads?: boolean }): Promise<void>
  restartApp(): Promise<void>

  addListener(event: 'back', cb: () => void): Promise<PluginListenerHandle>
  addListener(event: 'comicVisible', cb: (e: { visible: boolean }) => void): Promise<PluginListenerHandle>
}

export const MM = registerPlugin<MMPlugin>('MM')
