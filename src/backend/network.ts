// Network settings → native clients: the optional proxy, the manga-site base
// (the Referer of its image requests), the doujin content host, and the
// optional SNI-bypass tunnel for the manga site (설정 › 네트워크 › 우회).
import type { Settings } from '../shared/types'
import { MM } from './native'
import { setDoujinContentHost, doujinSiteOrigin } from './lib/doujin'

export async function applyNetwork(s: Settings): Promise<void> {
  setDoujinContentHost(s.doujinBaseUrl ?? '')
  await MM.setImageCache({ mb: Math.max(0, Math.round((s.imageCacheGB ?? 0.5) * 1024)) })
  await MM.setNetwork({
    proxy: s.proxyServer ?? '',
    comicBase: s.comicBaseUrl ?? '',
    doujinSite: doujinSiteOrigin(),
    tunnel: s.bypassTunnel === true
  })
}
