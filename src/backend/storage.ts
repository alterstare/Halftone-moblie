// Shared-storage access ("모든 파일에 접근" on Android 11+). The library and the
// downloads live in shared storage so they survive an uninstall and can be
// copied to/from a PC.
import { MM } from './native'

export const STORAGE_DENIED = '저장소 권한이 없습니다. 안드로이드 설정에서 "모든 파일에 접근"을 허용해 주세요.'

// Resolves once access is granted; asks the user (system settings page) if not.
export async function ensureStorage(): Promise<void> {
  if ((await MM.storageStatus()).granted) return
  const r = await MM.requestStorage()
  if (!r.granted) throw new Error(STORAGE_DENIED)
}
