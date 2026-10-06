// On-disk cache of hitomi gallery summaries (title, thumb, tags…) keyed by
// gallery code — <data>/onlineSummaries.json. Online favorite lists and the
// unified favorites view render from it, so a list seen once shows instantly
// instead of re-fetching every gallery.
import { join } from '../node/path'
import * as fs from '../node/fs'
import { paths } from '../context'
import type { GallerySummary } from '../../shared/ipc'
import { summary } from './hitomi'
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

// Make sure every code in `codes` is cached (fetching only the missing ones,
// CONCURRENCY at a time), persist, and return the whole cache map. Unreachable
// galleries are skipped silently.
export async function ensureSummaries(
  codes: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, GallerySummary>> {
  const c = await load()
  const missing = [...new Set(codes)].filter((code) => code && !c[code])
  if (!missing.length) return c
  const queue = [...missing]
  let done = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const code = queue.shift()
      if (!code) return
      try {
        const s = await summary(code)
        c[code] = { ...s, thumbUrl: s.thumbUrl ? encodeWeb(s.thumbUrl) : null }
      } catch {
        /* skip unreachable */
      }
      onProgress?.(++done, missing.length)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  await fs.writeFile(FILE(), JSON.stringify(c)).catch(() => {})
  return c
}
