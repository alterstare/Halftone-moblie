// F5 (새로고침): reload the window to re-read data, but come back to the same
// screen — tabs, active tab, mode, list/online position, search and filters.
// The state rides across the reload in sessionStorage (cleared on read).
// The same snapshot is written to localStorage whenever the app goes to the
// background: Android may kill it there, and the next start then comes back
// to that screen instead of the start screen (restoreBackground).
import { useStore } from './store'
import { useLock, decoyHiddenTabs, restoreLockState } from './lock'

const KEY = 'mm-soft-reload'

const KEEP = [
  'view',
  'activeTabId',
  'libraryMode',
  'manageMode',
  'homeScroll',
  'homeAnchor',
  'homePage',
  'tabs',
  'tabGroups',
  'search',
  'sort',
  'sortDir',
  'favSort',
  'filter',
  'randomSeed',
  'showCoded',
  'showUncoded',
  'langFilter',
  'groupFilter',
  'showUngrouped',
  'rootFilter',
  'listCollapsed',
  'readerMode',
  'homeLayout',
  'browseSource',
  'browsePage',
  'onlineProgress',
  'sideState',
  'navStack',
  'navPos'
] as const

function snapshot(): Record<string, unknown> {
  const st = useStore.getState() as unknown as Record<string, unknown>
  const snap: Record<string, unknown> = Object.fromEntries(KEEP.map((k) => [k, st[k]]))
  // Tabs the decoy library is hiding are still real tabs.
  snap.tabs = [...(st.tabs as unknown[]), ...decoyHiddenTabs()]
  return snap
}

export function softReload(): void {
  try {
    const snap = snapshot()
    const lock = useLock.getState()
    snap.__lock = { unlocked: lock.unlocked, decoy: lock.decoy }
    sessionStorage.setItem(KEY, JSON.stringify(snap))
  } catch {
    /* storage unavailable → plain reload */
  }
  window.location.reload()
}

const BG_KEY = 'mm-bg-resume'

// Gone to the background: write where the user is (no lock state — a start
// after a kill asks for the PIN again, the guard replays the screen after it).
export function saveBackground(): void {
  try {
    localStorage.setItem(BG_KEY, JSON.stringify(snapshot()))
  } catch {
    /* storage unavailable → a killed app starts fresh */
  }
}

// Back on screen without a restart, or closed on purpose (exit): nothing to
// come back to.
export function dropBackground(): void {
  try {
    localStorage.removeItem(BG_KEY)
  } catch {
    /* nothing saved */
  }
}

// Boot: the app was killed while in the background → its last screen.
export function restoreBackground(): boolean {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(BG_KEY)
    localStorage.removeItem(BG_KEY)
  } catch {
    return false
  }
  if (!raw) return false
  try {
    useStore.setState(JSON.parse(raw) as never)
    return true
  } catch {
    return false
  }
}

// Boot: re-apply the pre-reload screen (after settings, works and the saved
// session are loaded). Returns true when there was one.
export function restoreSoftReload(): boolean {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
  } catch {
    return false
  }
  if (!raw) return false
  try {
    const { __lock, ...snap } = JSON.parse(raw) as Record<string, unknown> & {
      __lock?: { unlocked: boolean; decoy: boolean }
    }
    // A reload doesn't re-lock an already unlocked doujin session.
    if (__lock?.unlocked) restoreLockState(__lock.decoy)
    useStore.setState(snap as never)
    if (__lock?.decoy) restoreLockState(true) // hide again what the state just brought back
    return true
  } catch {
    return false
  }
}
