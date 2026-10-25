// Update notice (sideloaded APK): on start, ask GitHub for the latest release
// of this app's repo; when its tag is newer than the installed version, show
// it in the activity bar (available). "업데이트" opens the release page in the
// browser — the user downloads and installs the APK there. The app itself
// never downloads or installs APKs: doing that (REQUEST_INSTALL_PACKAGES + a
// silent download at launch) got it blocked by Play Protect as harmful.
import type { UpdateStatus } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import { MM } from './native'
import { sendToRenderer, store } from './context'

const REPO = 'alterstare/Halftone-moblie'
let page: string | null = null // release page of the version found

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
      html_url?: string
    }
    const latest = String(rel.tag_name ?? '').replace(/^v/i, '')
    if (!latest || rel.draft || !newer(latest, version)) return
    page = rel.html_url ?? `https://github.com/${REPO}/releases/latest`
    status({ state: 'available', version: latest })
  } catch (e: any) {
    status({ state: 'error', error: String(e?.message ?? e) })
  }
}

// "업데이트": the release page in the browser.
export function installUpdate(): void {
  if (page) void MM.openUrl({ url: page })
}
