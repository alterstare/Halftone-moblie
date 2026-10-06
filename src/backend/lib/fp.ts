// Fingerprint of a lower-cased string: 64-bit FNV-1a → 16 hex chars.
// Names the app must recognise (but never spells out in source) are stored as
// fingerprints and compared against what it sees (user input, file names, keys).
export function fp(s: string): string {
  let h = 0xcbf29ce484222325n
  for (const c of new TextEncoder().encode(s.toLowerCase())) {
    h ^= BigInt(c)
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}

// The doujin site's domain and its name (the domain's first label).
export const DOUJIN_SITE_FP = '9085fef84c60598a'
export const DOUJIN_NAME_FP = '7d5b585ace152e8d'
// The comic site's old short name (pre-0.5.5 setting keys / values).
export const COMIC_NAME_FP = '2ff1f3ef38ae953c'
