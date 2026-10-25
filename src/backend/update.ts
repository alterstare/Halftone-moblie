// Auto-update (sideloaded APK): on start, ask GitHub for the latest release of
// this app's repo; when its tag is newer than the installed version, show it in
// the activity bar (available). Nothing is downloaded until the user taps
// "업데이트" — a silent APK download at launch made Play Protect flag the app as
// harmful (dropper) — then the .apk goes to the app cache (downloading) and is
// handed to the system installer (the user confirms there).
import type { UpdateStatus } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import { MM } from './native'
import { join } from './node/path'
import { paths, sendToRenderer, store } from './context'

const REPO = 'alterstare/Halftone-moblie'
let pending: string | null = null // downloaded APK
let offer: { version: string; url: string } | null = null // found, not downloaded
let busy = false

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
  if (store.settings.autoUpdate === false) return // turned off in 설정 · 관리
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
    offer = { version: latest, url: asset.browser_download_url }
    status({ state: 'available', version: latest })
  } catch (e: any) {
    status({ state: 'error', error: String(e?.message ?? e) })
  }
}

// "업데이트" / "설치": download the offered APK on the first tap, then install.
export async function installUpdate(): Promise<void> {
  if (pending) return void MM.installApk({ path: pending })
  if (!offer || busy) return
  busy = true
  const { version, url } = offer
  try {
    status({ state: 'downloading', version, percent: 0 })
    const path = join(paths.cache, `Halftone-${version}.apk`)
    await MM.httpDownload({ url, kind: 'plain', path })
    pending = path
    status({ state: 'downloaded', version, percent: 100 })
    void MM.installApk({ path })
  } catch {
    status({ state: 'available', version }) // failed: keep the button for a retry
  } finally {
    busy = false
  }
}
