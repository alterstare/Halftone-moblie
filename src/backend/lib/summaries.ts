// On-disk cache of doujin gallery summaries (title, thumb, tags…) keyed by
// gallery code — <data>/onlineSummaries.json. Online favorite lists and the
// unified favorites view render from it, so a list seen once shows instantly
// instead of re-fetching every gallery.
import { join } from '../node/path'
import * as fs from '../node/fs'
import { paths } from '../context'
import type { GallerySummary } from '../../shared/ipc'
import { summary } from './doujin'
import { encodeWeb } from './media'

const FILE = (): string => join(paths.data, 'onlineSummaries.json')
const CONCURRENCY = 6

let cache: Record<string, GallerySummary> | null = null

async function load(): Promise<Record<string, GallerySummary>> {
  if (cache) return cache
  try {
    cache = JSON.parse(await fs.readFile(FILE(), 'utf-8'))
  } catch {
    cache = {}
  }
  return cache!
}

// Galleries the site answered 404 for (deleted) — <data>/deadGalleries.json.
// Not fetched again; 설정 › 삭제된 작품 정리 can drop them from the favorites.
const DEAD_FILE = (): string => join(paths.data, 'deadGalleries.json')
let dead: Set<string> | null = null
async function loadDead(): Promise<Set<string>> {
  if (dead) return dead
  try {
    dead = new Set(JSON.parse(await fs.readFile(DEAD_FILE(), 'utf-8')) as string[])
  } catch {
    dead = new Set()
  }
  return dead
}
export async function deadCodes(): Promise<Set<string>> {
  return new Set(await loadDead())
}
const saveDead = (): Promise<void> => fs.writeFile(DEAD_FILE(), JSON.stringify([...(dead ?? [])])).catch(() => {})

// Codes being fetched right now (by any caller) — a second request for the
// same code waits for that fetch instead of downloading it again (the import
// job and the favorites screen ask for the same thousands of codes).
const inflight = new Map<string, Promise<void>>()
let dirty = 0

const persist = (c: Record<string, GallerySummary>): Promise<void> =>
  fs.writeFile(FILE(), JSON.stringify(c)).catch(() => {})

// Make sure every code in `codes` is cached (fetching only the missing ones,
// CONCURRENCY at a time), persist, and return the whole cache map. Unreachable
// galleries are skipped silently. Saved every 100 new entries too, so a long
// run (a 7000-entry list) keeps what it got if the app is closed midway.
export async function ensureSummaries(
  codes: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, GallerySummary>> {
  const c = await load()
  const gone = await loadDead()
  const missing = [...new Set(codes)].filter((code) => code && !c[code] && !gone.has(code))
  if (!missing.length) return c
  let newDead = 0
  const fetchOne = (code: string): Promise<void> => {
    let p = inflight.get(code)
    if (!p) {
      p = (async () => {
        try {
          const s = await summary(code)
          c[code] = { ...s, thumbUrl: s.thumbUrl ? encodeWeb(s.thumbUrl) : null }
          if (++dirty >= 100) {
            dirty = 0
            await persist(c)
          }
        } catch (e: any) {
          // 404 = deleted from the site (other errors: maybe temporary → retry later)
          if (/->\s*404\b/.test(String(e?.message ?? e))) {
            gone.add(code)
            newDead++
          }
        }
      })().finally(() => inflight.delete(code))
      inflight.set(code, p)
    }
    return p
  }
  const queue = [...missing]
  let done = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const code = queue.shift()
      if (!code) return
      await fetchOne(code)
      onProgress?.(++done, missing.length)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  dirty = 0
  await persist(c)
  if (newDead) await saveDead()
  return c
}
