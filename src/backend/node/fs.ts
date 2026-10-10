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

// Big files cross the native bridge in pieces: one multi-MB string (a 7000-
// entry favorites summary file is ~5MB) ran the Java side out of memory while
// Capacitor serialized it — the app crashed opening the favorites.
const BIG = 1024 * 1024
const PIECE = 512 * 1024
const writing = new Map<string, Promise<void>>()

export async function readFile(path: string): Promise<Uint8Array>
export async function readFile(path: string, enc: 'utf-8' | 'utf8'): Promise<string>
export async function readFile(path: string, enc?: string): Promise<string | Uint8Array> {
  try {
    const st = await MM.fsStat({ path })
    if (st.exists && st.isFile && st.size > BIG) {
      const out = new Uint8Array(st.size)
      for (let off = 0; off < st.size; off += PIECE) {
        const part = b64ToBytes((await MM.fsRead({ path, encoding: 'base64', offset: off, length: PIECE })).data)
        out.set(part, off)
      }
      return enc ? new TextDecoder().decode(out) : out
    }
    if (enc) return (await MM.fsRead({ path, encoding: 'utf8' })).data
    return b64ToBytes((await MM.fsRead({ path, encoding: 'base64' })).data)
  } catch {
    throw enoent(path)
  }
}

export async function writeFile(path: string, data: string | Uint8Array, _enc?: string): Promise<void> {
  const big = typeof data === 'string' ? data.length > BIG / 3 : data.length > BIG
  if (big && !path.startsWith('/nas/')) {
    // One piecewise write per file at a time (two would mix their pieces).
    const run = (writing.get(path) ?? Promise.resolve()).then(async () => {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
      for (let off = 0; off < bytes.length; off += PIECE) {
        const chunk = bytesToB64(bytes.subarray(off, off + PIECE))
        await MM.fsWrite({ path, data: chunk, encoding: 'base64', part: off === 0 ? 'new' : 'append' })
      }
      await MM.fsWrite({ path, data: '', commit: true })
    })
    const settled = run.catch(() => {})
    writing.set(path, settled)
    void settled.then(() => writing.get(path) === settled && writing.delete(path))
    return run
  }
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
