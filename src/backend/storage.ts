// Shared-storage access ("모든 파일에 접근" on Android 11+). The library and the
// downloads live in shared storage so they survive an uninstall and can be
// copied to/from a PC.
import { MM } from './native'

export const STORAGE_DENIED = '저장소 권한이 없습니다. 안드로이드 설정에서 "모든 파일에 접근"을 허용해 주세요.'

// NAS folders (/nas/<id>/…) go through the network, not shared storage.
export const isNasPath = (p: string | null | undefined): boolean => !!p && p.startsWith('/nas/')

// Resolves once access is granted; asks the user (system settings page) if not.
// With `paths` given, only asks when one of them is on this device.
export async function ensureStorage(paths?: (string | null | undefined)[]): Promise<void> {
  if (paths && paths.every((p) => !p || isNasPath(p))) return
  if ((await MM.storageStatus()).granted) return
  const r = await MM.requestStorage()
  if (!r.granted) throw new Error(STORAGE_DENIED)
}
