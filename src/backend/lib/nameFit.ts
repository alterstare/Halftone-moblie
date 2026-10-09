// Folder-name length cap. A long title (gallery 4233483) overflowed the
// phone's 255-byte name limit (ext4: bytes, so CJK = 3 each) → "mkdir failed".
// The cap also keeps a whole library path under Windows' 260-char MAX_PATH
// when the folder is copied to a PC or a NAS share: base + group + work +
// image name stays well inside it.
export const NAME_MAX_CHARS = 80
export const NAME_MAX_BYTES = 180

const bytes = (s: string): number => new TextEncoder().encode(s).length

export function nameFits(s: string): boolean {
  return [...s].length <= NAME_MAX_CHARS && bytes(s) <= NAME_MAX_BYTES
}

// Cut to the cap on a code-point boundary, then drop a trailing '.' / space
// (Windows strips them silently, so the folder wouldn't match the saved path).
export function fitName(s: string): string {
  let cps = [...s]
  if (cps.length > NAME_MAX_CHARS) cps = cps.slice(0, NAME_MAX_CHARS)
  while (cps.length && bytes(cps.join('')) > NAME_MAX_BYTES) cps.pop()
  return cps.join('').replace(/[.\s]+$/, '').trim()
}

// Build a name from parts, shortening the `shrink` part(s) first (title, then
// artist…) so the rest (e.g. the gallery code) survives the cap intact.
export function fitBuilt(build: (parts: string[]) => string, parts: string[], shrinkOrder: number[]): string {
  const p = [...parts]
  for (const i of shrinkOrder) {
    if (nameFits(build(p))) break
    const cps = [...p[i]]
    while (cps.length && !nameFits(build(p.map((x, j) => (j === i ? cps.join('').trim() + '…' : x))))) cps.pop()
    p[i] = cps.length ? cps.join('').trim() + '…' : ''
  }
  return fitName(build(p))
}
