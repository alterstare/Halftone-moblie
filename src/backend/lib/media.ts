// Image urls handed to the UI, and the on-disk thumbnail cache.
//
// Urls are same-origin paths served by the native interceptor
// (MMWebViewClient.java), segment = base64url of the target:
//   /_mm/img/<abs path>    local file
//   /_mm/web/<https url>   doujin image (DoH + Referer, disk-cached)
//   /_mm/comic/<https url>  general-manga online image (comic WebView cookies)
import * as fs from '../node/fs'
import { join } from '../node/path'
import { b64url } from '../node/bytes'
import { paths } from '../context'

export const encodeImg = (path: string): string => '/_mm/img/' + b64url(path)
export const encodeWeb = (url: string): string => '/_mm/web/' + b64url(url)
export const encodeComic = (url: string): string => '/_mm/comic/' + b64url(url)

// Reverse of the encoders (for a url the UI hands back, e.g. a picked image).
export function decodeMM(url: string): { kind: string; target: string } | null {
  const m = url.match(/\/_mm\/(img|web|comic)\/([A-Za-z0-9_-]+)/)
  if (!m) return null
  const b64 = m[2].replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return { kind: m[1], target: new TextDecoder().decode(bytes) }
}

// --- thumbnail cache (<files>/thumbs) ---

const thumbDir = (): string => join(paths.data, 'thumbs')

export async function initThumbDir(): Promise<void> {
  await fs.mkdir(thumbDir(), { recursive: true })
}

// Any char outside [A-Za-z0-9._-] becomes "_" (ids carry a "h:"/"u:" prefix).
// The ".v2" suffix versions the format (bump it to invalidate every thumb).
export function thumbFile(workId: string): string {
  return join(thumbDir(), `${workId.replace(/[^A-Za-z0-9._-]/g, '_')}.v2.webp`)
}

// Is this thumb a raw, full-size cover (online cover regen saves the source image
// as-is) rather than our ≤480px webp? Raw thumbs make every scroll re-decode
// megapixel images, so getThumb flags them and the UI shrinks them once. A raw
// write leaves a "<thumb>.raw" marker; saving a shrunk thumb removes it.
export const rawMarker = (file: string): string => file + '.raw'

export async function isRawThumb(file: string): Promise<boolean> {
  return fs.exists(rawMarker(file))
}

// Write a raw (unshrunk) cover image as a work's thumb.
export async function writeRawThumb(workId: string, write: (file: string) => Promise<void>): Promise<void> {
  const file = thumbFile(workId)
  await write(file)
  await fs.writeFile(rawMarker(file), '')
}
