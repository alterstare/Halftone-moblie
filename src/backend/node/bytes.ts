// Byte helpers replacing the node Buffer APIs the desktop code used.

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

const enc = new TextEncoder()
const dec = new TextDecoder()
export const utf8 = (s: string): Uint8Array => enc.encode(s)
export const fromUtf8 = (b: Uint8Array): string => dec.decode(b)

// base64url (no padding) of a UTF-8 string — the /_mm/ url path segment.
export function b64url(s: string): string {
  return bytesToB64(utf8(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)

// Big-endian int32s (doujin .nozomi files / search-index posting lists).
export function int32sBE(b: Uint8Array, from = 0, count = Math.floor((b.length - from) / 4)): number[] {
  const v = view(b)
  const out: number[] = []
  for (let i = 0; i < count && from + i * 4 + 3 < b.length; i++) out.push(v.getInt32(from + i * 4))
  return out
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}
