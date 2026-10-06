// Data saved by builds before 0.5.5 used the online sources' site names as
// enum values and setting keys. On load they are mapped to the neutral names
// (doujin / comic) — only enum-like fields and camelCase keys, never titles,
// artists or tags. Idempotent: already-migrated data passes through unchanged.
// The old names are matched by fingerprint (fp.ts), never spelled out.
import { fp, DOUJIN_NAME_FP, COMIC_NAME_FP } from './fp'

const NEW: Record<string, string> = { [DOUJIN_NAME_FP]: 'doujin', [COMIC_NAME_FP]: 'comic' }
const ENUM_KEYS = new Set(['library', 'source', 'mode', 'kind', 'libraryMode', 'startScreen'])
const seen = new Map<string, string | undefined>()
const neutral = (word: string): string | undefined => {
  if (!seen.has(word)) seen.set(word, NEW[fp(word)])
  return seen.get(word)
}

// 'xxx' / 'xxxBaseUrl' → 'doujin' / 'doujinBaseUrl' (lower-case head of a camelCase key).
function renameKey(k: string): string {
  const m = /^([a-z]+)(.*)$/.exec(k)
  if (!m || (m[2] && !/^[A-Z]/.test(m[2]))) return k
  const n = neutral(m[1])
  return n ? n + m[2] : k
}

// 'xxx' / 'xxx-home' (startScreen) → 'doujin' / 'doujin-home'.
function mapValue(v: string): string {
  const i = v.indexOf('-')
  const head = i < 0 ? v : v.slice(0, i)
  const n = /^[a-z]+$/.test(head) ? neutral(head) : undefined
  return n ? n + v.slice(head.length) : v
}

export function migrateNames<T>(data: T): T {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk)
    if (!x || typeof x !== 'object') return x
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      const nk = renameKey(k)
      out[nk] = ENUM_KEYS.has(nk) && typeof v === 'string' ? mapValue(v) : walk(v)
    }
    return out
  }
  return walk(data) as T
}
