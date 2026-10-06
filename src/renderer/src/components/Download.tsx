import type { JSX } from 'react'
import { useStore, downloadMode } from '../store'
import type { Job } from '../store'
import { useLock } from '../lock'
import { PauseIcon, PlayIcon, DeleteIcon } from './icons'
import type { HitomiProgress } from '../../../shared/ipc'

// One merged activity entry: background jobs (export/scan) + online downloads.
interface Row {
  id: string
  icon: string
  title: string
  status: 'running' | 'done' | 'error'
  done: number
  total: number
  detail?: string
  error?: string
  // Set only for online-download rows — drives the phase label + stop/retry
  // controls. Jobs (scan/meta/…) leave it undefined.
  dl?: { code: string; phase: HitomiProgress['phase']; canRetry: boolean }
}
const KIND_ICON: Record<Job['kind'], string> = {
  scan: '🔄',
  meta: '🖋',
  thumb: '🖼',
  organize: '🗂',
  convert: '♻'
}
const rowPct = (done: number, total: number): number =>
  total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
// Phases where a download is in flight (can be stopped but not retried).
const activePhase = new Set<HitomiProgress['phase']>([
  'queued',
  'fetching',
  'downloading',
  'enriching'
])

export default function Download(): JSX.Element {
  const libraryMode = useStore((s) => s.libraryMode)
  const stopDownload = useStore((s) => s.stopDownload)
  const retryDownload = useStore((s) => s.retryDownload)
  const stopAllDownloads = useStore((s) => s.stopAllDownloads)
  const startAllDownloads = useStore((s) => s.startAllDownloads)
  const allDownloads = useStore((s) => s.downloads)
  const jobs = useStore((s) => s.jobs)
  const clearDone = useStore((s) => s.clearDoneJobs)
  // Show only this mode's downloads (doujin vs general-manga are separate lists).
  const downloads = allDownloads.filter((d) => downloadMode(d.code) === libraryMode)
  // Full activity list for this mode: jobs + downloads, running first, history kept.
  // Decoy (fake-PIN) doujin library: no tasks or download history at all.
  const hideAll = useLock((s) => s.decoy) && libraryMode === 'hitomi'
  const rows: Row[] = hideAll ? [] : [
    ...jobs
      .filter((j) => j.mode === libraryMode)
      .map((j) => ({
        id: j.id,
        icon: KIND_ICON[j.kind],
        title: j.title,
        status: j.status,
        done: j.done,
        total: j.total,
        detail: j.detail,
        error: j.error
      })),
    ...downloads.map((d) => ({
      id: `dl:${d.code}`,
      icon: '⬇',
      title: d.title || d.code,
      status: (d.phase === 'done' ? 'done' : d.phase === 'error' ? 'error' : 'running') as Row['status'],
      done: d.done,
      total: d.total,
      detail: d.phase,
      error: d.error,
      dl: { code: d.code, phase: d.phase, canRetry: !!d.spec }
    }))
  ]
  rows.sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1))
  return (
    <div className="download">
      <aside className="dl-list">
        {/* Phone: one flat row (no frames, dividers between): 전체 정지 ·
            전체 시작 · 완료 지우기. */}
        <div className="dl-list-head">
          <h2 className="dl-list-title">작업 목록</h2>
          <span className="flat-group dl-head-btns">
            {downloads.length > 0 && (
              <>
                <button
                  className="dl-head-btn"
                  onClick={() => stopAllDownloads(libraryMode)}
                  disabled={!downloads.some((d) => activePhase.has(d.phase))}
                  title="전체 정지"
                >
                  <PauseIcon />
                </button>
                <button
                  className="dl-head-btn"
                  onClick={() => startAllDownloads(libraryMode)}
                  disabled={!downloads.some((d) => (d.phase === 'stopped' || d.phase === 'error') && d.spec)}
                  title="전체 시작"
                >
                  <PlayIcon />
                </button>
              </>
            )}
            <button
              className="dl-head-btn"
              onClick={clearDone}
              disabled={!rows.length || rows.every((r) => r.status === 'running')}
              title="완료 항목 지우기"
            >
              <DeleteIcon />
            </button>
          </span>
        </div>
        {rows.length === 0 && <div className="dl-list-empty">작업 기록이 없습니다. 다운로드·내보내기·라이브러리 갱신이 여기에 표시됩니다.</div>}
        {rows.map((r) => {
          const pct = rowPct(r.done, r.total)
          const phase = r.dl?.phase
          // Download rows carry phase-specific labels (대기 중/정지됨); jobs fall
          // back to the coarse running/done/error status.
          const status =
            phase === 'stopped'
              ? { cls: 'stopped', label: '⏸ 정지됨' }
              : phase === 'queued'
                ? { cls: 'busy', label: '대기 중' }
                : phase === 'converting'
                  ? { cls: 'busy', label: r.total > 0 ? `webp 변환 ${pct}%` : 'webp 변환 중' }
                  : r.status === 'done'
                    ? { cls: 'ok', label: '✓ 완료' }
                    : r.status === 'error'
                      ? { cls: 'err', label: '✗ 실패' }
                      : { cls: 'busy', label: r.total > 0 ? `${pct}%` : '진행 중' }
          const active = phase ? activePhase.has(phase) : false
          const canRetry = r.dl?.canRetry && (phase === 'stopped' || phase === 'error')
          // A clean failure line instead of the raw error/stack (요청 사항).
          const errText =
            r.dl && phase === 'error' ? `다운로드 실패 (code:${r.dl.code})` : r.error
          return (
            <div key={r.id} className={`dl-item ${status.cls}`}>
              <div className="dl-item-top">
                <span className="dl-item-title">
                  {r.icon} {r.title}
                </span>
                <span className={`dl-item-status ${status.cls}`}>{status.label}</span>
              </div>
              <div className="dl-item-bar">
                <div
                  className="dl-item-fill"
                  style={{ width: r.status === 'done' ? '100%' : `${pct}%` }}
                />
              </div>
              <div className="dl-item-meta">
                <span>
                  {phase === 'stopped'
                    ? '정지됨'
                    : r.total > 0
                      ? `${r.done}/${r.total}`
                      : r.detail ?? '…'}
                </span>
                {(r.status === 'error' || phase === 'stopped') && errText && (
                  <span className="dl-item-err">{errText}</span>
                )}
                {r.dl && (active || canRetry) && (
                  <span className="dl-item-actions">
                    {active && (
                      <button className="dl-row-btn" onClick={() => stopDownload(r.dl!.code)} title="정지">
                        <PauseIcon />
                      </button>
                    )}
                    {canRetry && (
                      <button className="dl-row-btn" onClick={() => retryDownload(r.dl!.code)} title="재시도">
                        <PlayIcon />
                      </button>
                    )}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </aside>

    </div>
  )
}
