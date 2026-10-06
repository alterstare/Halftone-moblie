// POSIX path helpers (Android paths) — the subset of node:path the ported
// desktop code uses.
export const sep = '/'

export function normalize(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!abs) out.push('..')
      continue
    }
    out.push(seg)
  }
  const s = out.join('/')
  return abs ? '/' + s : s || '.'
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((x) => x !== '').join('/'))
}

export function resolve(...parts: string[]): string {
  let p = ''
  for (const x of parts) p = x.startsWith('/') ? x : p ? p + '/' + x : x
  return normalize(p.startsWith('/') ? p : '/' + p)
}

export function basename(p: string): string {
  const s = p.replace(/\/+$/, '')
  return s.slice(s.lastIndexOf('/') + 1)
}

export function dirname(p: string): string {
  const s = p.replace(/\/+$/, '')
  const i = s.lastIndexOf('/')
  if (i < 0) return '.'
  return i === 0 ? '/' : s.slice(0, i)
}

export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i)
}
