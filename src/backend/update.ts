// Auto-update (sideloaded APK): on start, ask GitHub for the latest release of
// this app's repo; when its tag is newer than the installed version, download
// the release's .apk into the app cache and report progress to the activity
// bar (available → downloading → downloaded). "설치" hands the APK to the
// system installer (the user confirms there).
import type { UpdateStatus } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import { MM } from './native'
import { join } from './node/path'
import { paths, sendToRenderer } from './context'

const REPO = 'alterstare/Halftone-moblie'
let pending: string | null = null

const status = (s: UpdateStatus): void => sendToRenderer(IPC.updateStatus, s)

// "1.2.10" > "1.2.9" (numeric per part; missing parts = 0).
function newer(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0
  }
  return false
}

export async function checkForUpdate(): Promise<void> {
  try {
    const { version } = await MM.appInfo()
    const r = await MM.httpGet({
      url: `https://api.github.com/repos/${REPO}/releases/latest`,
      kind: 'plain',
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (r.status !== 200) return
    const rel = JSON.parse(r.data) as {
      tag_name?: string
      draft?: boolean
      assets?: { name: string; browser_download_url: string }[]
    }
    const latest = String(rel.tag_name ?? '').replace(/^v/i, '')
    if (!latest || rel.draft || !newer(latest, version)) return
    const asset = rel.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'))
    if (!asset) return
    status({ state: 'available', version: latest })
    status({ state: 'downloading', version: latest, percent: 0 })
    const path = join(paths.cache, `Halftone-${latest}.apk`)
    await MM.httpDownload({ url: asset.browser_download_url, kind: 'plain', path })
    pending = path
    status({ state: 'downloaded', version: latest, percent: 100 })
  } catch (e: any) {
    status({ state: 'error', error: String(e?.message ?? e) })
  }
}

export function installUpdate(): void {
  if (pending) void MM.installApk({ path: pending })
}
