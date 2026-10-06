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

export type NetKind = 'hitomi' | 'toki' | 'plain'

export interface MMPlugin {
  // Installed app version (versionName).
  appInfo(): Promise<{ version: string; code: number }>
  // Hand a downloaded APK to the system installer (asks for "unknown apps"
  // permission first when needed).
  installApk(o: { path: string }): Promise<{ needPermission?: boolean }>
  getPaths(): Promise<{ files: string; cache: string; external: string; download: string; sdk: number }>
  storageStatus(): Promise<{ granted: boolean }>
  requestStorage(): Promise<{ granted: boolean }>

  fsRead(o: { path: string; encoding?: 'utf8' | 'base64' }): Promise<{ data: string }>
  fsWrite(o: { path: string; data: string; encoding?: 'utf8' | 'base64'; append?: boolean }): Promise<void>
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
  setNetwork(o: { proxy: string; tokiBase: string; tunnel: boolean }): Promise<{ tunnelPort: number }>
  netReset(): Promise<void>
  clipboardRead(): Promise<{ text: string }>
  clipboardWrite(o: { text: string }): Promise<void>
  clearImageCache(): Promise<void>

  pickFolder(): Promise<{ path: string | null }>
  pickFiles(o: { mime?: string; multiple?: boolean; as?: 'text' | 'file' }): Promise<{
    files: { name: string; text?: string; path?: string }[]
  }>
  saveTextFile(o: { name: string; text: string; mime?: string }): Promise<{ ok: boolean; name?: string }>

  tokiLoad(o: { url: string }): Promise<{ nav: number }>
  tokiState(): Promise<{
    nav: number
    committed: boolean
    errorCode: number
    errorDesc: string
    url: string
    visible: boolean
  }>
  tokiEval(o: { script: string }): Promise<{ json: string }>
  tokiShow(o: { title?: string }): Promise<void>
  tokiHide(): Promise<void>
  tokiCookie(o: { url: string }): Promise<{ cookie: string | null }>

  toast(o: { text: string }): Promise<void>
  exitApp(): Promise<void>
  restartApp(): Promise<void>

  addListener(event: 'back', cb: () => void): Promise<PluginListenerHandle>
  addListener(event: 'tokiVisible', cb: (e: { visible: boolean }) => void): Promise<PluginListenerHandle>
}

export const MM = registerPlugin<MMPlugin>('MM')
