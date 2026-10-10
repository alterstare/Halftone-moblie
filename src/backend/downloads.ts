// Shared runner for every online download (doujin gallery, comic series, backup
// site chapters): concurrency gate, user stop, and progress/error reporting on
// the renderer's doujinProgress channel.
//
// Lifecycle of one download, as the renderer sees it (phase):
//   queued → fetching → downloading … → done
//                    ↘ stopped (user pressed stop, while queued or running)
//                    ↘ error   (message = the failure)
import type { DoujinProgress } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import { store, sendToRenderer, paths } from './context'
import { MM } from './native'
import * as fs from './node/fs'
import { join } from './node/path'

// Rejection message for a user-stopped download. The renderer recognizes it, so
// a stop isn't shown as a failure.
export const STOP_MSG = 'DOWNLOAD_STOPPED'

// Abort handles of queued/running downloads, keyed by progress code (doujin
// code / comic seriesUrl / "backup:<title>").
const controllers = new Map<string, AbortController>()

// Background keep-alive: while any download is queued / running, the native
// foreground service (DownloadService.java) keeps the process alive and shows
// the progress as a notification. Updates are throttled to one per second.
const live = new Map<string, { title: string; done: number; total: number; running: boolean }>()
let noteTimer: ReturnType<typeof setTimeout> | null = null
let noteAt = 0
let serviceOn = false

function pushNote(): void {
  noteTimer = null
  noteAt = Date.now()
  if (!live.size) {
    if (serviceOn) void MM.downloadService({ active: false }).catch(() => {})
    serviceOn = false
    return
  }
  const all = [...live.values()]
  const cur = all.find((d) => d.running && d.total > 0) ?? all.find((d) => d.running) ?? all[0]
  const waiting = all.length - 1
  const text = (cur.total > 0 ? `${cur.done} / ${cur.total}` : '준비 중') + (waiting > 0 ? ` · 대기 ${waiting}` : '')
  serviceOn = true
  void MM.downloadService({
    active: true,
    keepOnExit: !!store.settings.keepDownloadsOnExit,
    // 일반 만화 (seriesUrl / backup:) in the list → PIP on home, if allowed.
    pip: store.settings.comicDownloadPip === true && [...live.keys()].some((c) => !/^\d+$/.test(c)),
    title: cur.title || '다운로드 중',
    text,
    done: cur.done,
    total: cur.total
  }).catch(() => {})
}

function noteChanged(urgent = false): void {
  if (urgent) {
    if (noteTimer) clearTimeout(noteTimer)
    pushNote()
    return
  }
  if (noteTimer) return
  noteTimer = setTimeout(pushNote, Math.max(0, 1000 - (Date.now() - noteAt)))
}

// Concurrency gate (settings · 동시 다운로드). The limit is read on every acquire,
// so a changed setting applies to downloads not yet started. 0 = unlimited.
// Waiters are released FIFO as slots free up.
let active = 0
const waiters: (() => void)[] = []

async function acquireSlot(signal: AbortSignal): Promise<() => void> {
  const limit = store.settings.maxConcurrentDownloads ?? 0
  if (limit > 0) {
    while (active >= limit) {
      if (signal.aborted) throw new Error(STOP_MSG)
      // Wake on either a freed slot or an abort, whichever comes first.
      await new Promise<void>((resolve) => {
        const wake = (): void => {
          signal.removeEventListener('abort', wake)
          resolve()
        }
        waiters.push(wake)
        signal.addEventListener('abort', wake, { once: true })
      })
      if (signal.aborted) throw new Error(STOP_MSG)
    }
  }
  active++
  let released = false
  return () => {
    if (released) return
    released = true
    active--
    waiters.shift()?.()
  }
}

// Report progress for this download. `label` is used as the title when the
// download has none yet (e.g. doujin learns the title only once fetching).
export type Report = (
  phase: DoujinProgress['phase'],
  done?: number,
  total?: number,
  label?: string
) => void

// Run `task` as download `code`: waits for a slot, wires the stop button to
// `signal`, reports queued/fetching/stopped/error automatically. The task
// reports its own 'downloading' / 'done' progress via `report`.
export async function runDownload<T>(
  code: string,
  title: string,
  task: (signal: AbortSignal, report: Report) => Promise<T>
): Promise<T> {
  const send = (p: Omit<DoujinProgress, 'code'>): void =>
    sendToRenderer(IPC.doujinProgress, { code, ...p } satisfies DoujinProgress)
  const report: Report = (phase, done = 0, total = 0, label = '') => {
    send({ title: title || label, done, total, phase })
    const d = live.get(code)
    if (d) {
      d.title = title || label || d.title
      d.done = done
      d.total = total
      d.running = phase === 'fetching' || phase === 'downloading'
      noteChanged()
    }
  }

  const controller = new AbortController()
  controllers.set(code, controller)
  // First download → start the service right away (it must start while the
  // app is still in the foreground).
  live.set(code, { title, done: 0, total: 0, running: false })
  noteChanged(live.size === 1 && !serviceOn)
  report('queued')
  try {
    const release = await acquireSlot(controller.signal)
    report('fetching')
    try {
      return await task(controller.signal, report)
    } finally {
      release()
    }
  } catch (err: any) {
    if (controller.signal.aborted || err?.message === STOP_MSG) {
      report('stopped')
      throw new Error(STOP_MSG)
    }
    send({ title, done: 0, total: 0, phase: 'error', message: String(err?.message ?? err) })
    throw err
  } finally {
    controllers.delete(code)
    live.delete(code)
    void clearChapterRecord(code)
    noteChanged(!live.size)
  }
}

// Chapters of a 일반 만화 download already saved in full, by progress code
// (<data>/dlChapters.json). A download resumed after the app was closed /
// killed skips them instead of scraping every chapter's page list again. A
// chapter goes in only once every image is on disk (a chapter cut off midway,
// or with an image that failed, is fetched again — files already there are
// skipped). The record lives only while the download is unfinished: any end
// (done, stopped, error) clears it, so a later fresh download never trusts it.
export interface ChapterRecord {
  has(url: string): boolean
  done(url: string): Promise<void>
}
type ChapterMap = Record<string, string[]>
const CH_FILE = (): string => join(paths.data, 'dlChapters.json')
async function readChapters(): Promise<ChapterMap> {
  try {
    const j = JSON.parse(await fs.readFile(CH_FILE(), 'utf-8'))
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}
// Read-modify-write one at a time; fn returns null = nothing to write.
let chChain: Promise<unknown> = Promise.resolve()
function editChapters(fn: (m: ChapterMap) => ChapterMap | null): Promise<void> {
  const run = chChain.then(async () => {
    const next = fn(await readChapters())
    if (next) await fs.writeFile(CH_FILE(), JSON.stringify(next)).catch(() => {})
  })
  chChain = run.catch(() => {})
  return run
}
export async function chapterRecord(code: string): Promise<ChapterRecord> {
  await chChain
  const set = new Set((await readChapters())[code] ?? [])
  return {
    has: (url) => set.has(url),
    done: (url) => {
      set.add(url)
      return editChapters((m) => ({ ...m, [code]: [...set] }))
    }
  }
}
const clearChapterRecord = (code: string): Promise<void> =>
  editChapters((m) => {
    if (!(code in m)) return null
    delete m[code]
    return m
  })

// Stop everything queued / running (app reset).
export function stopAllDownloads(): void {
  for (const c of controllers.values()) c.abort()
}

// Stop a queued/running download. Returns false if nothing was running.
export function stopDownload(code: string): boolean {
  const c = controllers.get(code)
  if (!c) return false
  c.abort()
  return true
}
