// node:fs/promises-shaped wrapper over the native plugin — just the calls the
// ported desktop code makes. Missing files raise an ENOENT-like error so the
// callers' try/catch logic carries over unchanged.
import { MM } from '../native'
import { b64ToBytes, bytesToB64 } from './bytes'

export interface Dirent {
  name: string
  isFile(): boolean
  isDirectory(): boolean
}

export interface Stats {
  size: number
  mtimeMs: number
  isFile(): boolean
  isDirectory(): boolean
}

function enoent(path: string): Error & { code: string } {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' })
}

export async function readFile(path: string): Promise<Uint8Array>
export async function readFile(path: string, enc: 'utf-8' | 'utf8'): Promise<string>
export async function readFile(path: string, enc?: string): Promise<string | Uint8Array> {
  try {
    if (enc) return (await MM.fsRead({ path, encoding: 'utf8' })).data
    return b64ToBytes((await MM.fsRead({ path, encoding: 'base64' })).data)
  } catch {
    throw enoent(path)
  }
}

export async function writeFile(path: string, data: string | Uint8Array, _enc?: string): Promise<void> {
  if (typeof data === 'string') await MM.fsWrite({ path, data, encoding: 'utf8' })
  else await MM.fsWrite({ path, data: bytesToB64(data), encoding: 'base64' })
}

export async function writeFileB64(path: string, base64: string): Promise<void> {
  await MM.fsWrite({ path, data: base64, encoding: 'base64' })
}

export async function stat(path: string): Promise<Stats> {
  const s = await MM.fsStat({ path })
  if (!s.exists) throw enoent(path)
  return { size: s.size, mtimeMs: s.mtime, isFile: () => s.isFile, isDirectory: () => s.isDir }
}

export async function access(path: string): Promise<void> {
  const s = await MM.fsStat({ path })
  if (!s.exists) throw enoent(path)
}

export async function exists(path: string): Promise<boolean> {
  return (await MM.fsStat({ path })).exists
}

export async function readdir(path: string): Promise<string[]>
export async function readdir(path: string, o: { withFileTypes: true }): Promise<Dirent[]>
export async function readdir(path: string, o?: { withFileTypes: true }): Promise<string[] | Dirent[]> {
  let entries
  try {
    entries = (await MM.fsReaddir({ path })).entries
  } catch (e: any) {
    // NAS errors (login, network) carry their own message; keep it.
    if (path.startsWith('/nas/') && !/ENOENT/.test(String(e?.message ?? ''))) throw e
    throw enoent(path)
  }
  if (!o?.withFileTypes) return entries.map((e) => e.name)
  return entries.map((e) => ({ name: e.name, isFile: () => e.isFile, isDirectory: () => e.isDir }))
}

export async function mkdir(path: string, _o?: { recursive?: boolean }): Promise<void> {
  await MM.fsMkdir({ path })
}

export async function rm(path: string, o?: { recursive?: boolean; force?: boolean }): Promise<void> {
  try {
    await MM.fsRm({ path, recursive: !!o?.recursive })
  } catch (e) {
    if (!o?.force) throw e
  }
}

export async function rmdir(path: string): Promise<void> {
  await MM.fsRm({ path })
}

// Cross-volume moves are handled natively (copy + delete).
export async function rename(from: string, to: string): Promise<void> {
  await MM.fsRename({ from, to })
}
