// 갤러리에서 숨기기 (settings.hideFromGallery, default on): a `.nomedia` file in
// each download folder keeps the phone's gallery / MediaStore from indexing the
// downloaded pages. Turning it off removes the file. Either way the folder is
// rescanned so the gallery updates right away. NAS folders are skipped.
import type { Settings } from '../shared/types'
import * as fs from './node/fs'
import { join } from './node/path'
import { MM } from './native'

export async function applyGalleryHide(s: Settings): Promise<void> {
  const hide = s.hideFromGallery !== false
  const dirs = [...new Set([s.downloadDir, s.normalDownloadDir])].filter(
    (d): d is string => !!d && !d.startsWith('/nas/')
  )
  const changed: string[] = []
  for (const d of dirs) {
    const f = join(d, '.nomedia')
    try {
      const has = await fs.exists(f)
      if (hide && !has) {
        await fs.mkdir(d, { recursive: true })
        await fs.writeFile(f, '')
        changed.push(d)
      } else if (!hide && has) {
        await fs.rm(f, { force: true })
        changed.push(d)
      }
    } catch {
      /* no storage permission yet — retried on the next download / settings save */
    }
  }
  if (changed.length) await MM.mediaScan({ paths: changed }).catch(() => undefined)
}
