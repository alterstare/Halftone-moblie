// Network settings → native clients: the optional proxy, the manga-site base
// (the Referer of its image requests), the doujin content host, and the
// optional SNI-bypass tunnel for the manga site (설정 › 네트워크 › 우회).
import type { Settings } from '../shared/types'
import { MM } from './native'
import { setHitomiContentHost } from './lib/hitomi'

export async function applyNetwork(s: Settings): Promise<void> {
  setHitomiContentHost(s.hitomiBaseUrl ?? '')
  await MM.setNetwork({ proxy: s.proxyServer ?? '', tokiBase: s.tokiBaseUrl ?? '', tunnel: s.bypassTunnel === true })
}
