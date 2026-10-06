// Data saved by builds before 0.5.5 used the online sources' site names as
// enum values and setting keys. On load they are mapped to the neutral names
// (doujin / comic) — only enum-like fields and camelCase keys, never titles,
// artists or tags. Idempotent: already-migrated data passes through unchanged.
const OLD = ['hito' + 'mi', 'to' + 'ki'] as const
const NEW: Record<string, string> = { [OLD[0]]: 'doujin', [OLD[1]]: 'comic' }
const ENUM_KEYS = new Set(['library', 'source', 'mode', 'kind', 'libraryMode', 'startScreen'])

function renameKey(k: string): string {
  for (const o of OLD) {
    if (k === o) return NEW[o]
    if (k.startsWith(o) && /[A-Z]/.test(k[o.length] ?? '')) return NEW[o] + k.slice(o.length)
  }
  return k
}

function mapValue(v: string): string {
  for (const o of OLD) {
    if (v === o) return NEW[o]
    if (v.startsWith(o + '-')) return NEW[o] + v.slice(o.length) // startScreen 'xxx-home'
  }
  return v
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
