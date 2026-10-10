// Fetch title / thumb / tags for many doujin codes (after 즐겨찾기 불러오기 or a
// 즐겨찾기 목록 파일 추가) as a job in the activity bar, with progress.
import { useStore } from './store'
import { request } from './favSummaries'

// Keys running in this session — the same job is never started twice.
const active = new Set<string>()
let resumed = false

export async function summaryJob(title: string, codes: string[], resumeKey?: string): Promise<void> {
  const list = [...new Set(codes.filter((c) => /^\d+$/.test(c)))]
  if (!list.length || (resumeKey && active.has(resumeKey))) return
  const { startJob, updateJob, endJob } = useStore.getState()
  const key = resumeKey ?? Math.random().toString(36).slice(2)
  active.add(key)
  const jid = startJob('meta', 'doujin', title)
  const off = window.api.onOnlineFavPreload((p) => {
    if (p.key === key) updateJob(jid, { done: p.done, total: p.total })
  })
  try {
    const r = await window.api.preloadSummaries(list, key, title)
    endJob(jid, { status: 'done', detail: `${r.cached}/${r.total}개${r.dead ? ` · 삭제된 작품 ${r.dead}개` : ''}` })
    request(list) // show them on the cards now
    // titles / thumbs were written into the favorites too
    useStore.getState().setOnlineFavs(await window.api.getOnlineFavs())
    window.dispatchEvent(new Event('mm-summaries-done')) // 설정's 삭제된 작품 count
  } catch (e: any) {
    endJob(jid, { status: 'error', error: String(e?.message ?? e) })
  } finally {
    off()
    active.delete(key)
  }
}

// App start: jobs cut short last time (app closed midway) continue — what was
// fetched is cached, so only the rest is downloaded. One after another.
export async function resumeSummaryJobs(): Promise<void> {
  if (resumed) return // once per app start
  resumed = true
  const jobs = await window.api.pendingSummaryJobs().catch(() => [])
  for (const j of jobs) await summaryJob(j.title || '정보 불러오기', j.codes, j.key)
}
