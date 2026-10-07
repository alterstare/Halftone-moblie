import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import type { NasConn } from '../../../shared/ipc'
import { useNas, splitNasPath } from '../nas'
import { CloseIcon, ChevronLeftIcon, FolderIcon } from './icons'

// Add / edit a NAS connection: WebDAV (address) or SMB (host + share), user,
// password (kept natively, encrypted), and a 연결 테스트 before saving.
export function NasConnModal({
  initial,
  onClose,
  onSaved
}: {
  initial: NasConn
  onClose: () => void
  onSaved?: (id: string) => void
}): JSX.Element {
  const [c, setC] = useState<NasConn>(initial)
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useNas((s) => s.refresh)
  const set = (p: Partial<NasConn>): void => setC((x) => ({ ...x, ...p }))
  // Editing: an empty password field keeps the stored one.
  const password = pw || (initial.id && initial.hasPassword ? null : '')
  const valid = c.name.trim() && (c.type === 'webdav' ? c.url.trim() : c.host.trim() && c.share.trim())

  const test = async (): Promise<void> => {
    setBusy(true)
    setMsg(null)
    const r = await window.api.nasTest(c, password)
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: `연결 성공 · 항목 ${r.count}개` } : { ok: false, text: r.error ?? '연결 실패' })
  }
  const save = async (): Promise<void> => {
    setBusy(true)
    const id = await window.api.nasSave({ ...c, name: c.name.trim() }, password)
    await refresh()
    setBusy(false)
    onSaved?.(id)
    onClose()
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal nas-modal" onClick={(e) => e.stopPropagation()}>
        <div className="nas-head">
          <b>{initial.id ? 'NAS 연결 편집' : 'NAS 연결 추가'}</b>
          <button className="icon-close" onClick={onClose} title="닫기">
            <CloseIcon />
          </button>
        </div>
        <div className="chips nas-type">
          {(['webdav', 'smb'] as const).map((t) => (
            <button key={t} className={`chip ${c.type === t ? 'active' : ''}`} onClick={() => set({ type: t })}>
              {t === 'webdav' ? 'WebDAV' : 'SMB'}
            </button>
          ))}
        </div>
        <label className="nas-field">
          <span>이름</span>
          <input className="search" value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 집 NAS" />
        </label>
        {c.type === 'webdav' ? (
          <>
            <label className="nas-field">
              <span>주소</span>
              <input
                className="search"
                value={c.url}
                onChange={(e) => set({ url: e.target.value })}
                placeholder="https://192.168.0.10:5006/폴더"
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            <label className="nas-check">
              <input type="checkbox" checked={c.insecure} onChange={(e) => set({ insecure: e.target.checked })} />
              자체 서명 인증서 허용 (NAS 기본 https 인증서)
            </label>
          </>
        ) : (
          <>
            <label className="nas-field">
              <span>호스트</span>
              <input className="search" value={c.host} onChange={(e) => set({ host: e.target.value })} placeholder="192.168.0.10" autoCapitalize="off" />
            </label>
            <div className="nas-row">
              <label className="nas-field">
                <span>공유 폴더</span>
                <input className="search" value={c.share} onChange={(e) => set({ share: e.target.value })} placeholder="예: comics" autoCapitalize="off" />
              </label>
              <label className="nas-field nas-port">
                <span>포트</span>
                <input
                  className="search"
                  inputMode="numeric"
                  value={c.port || ''}
                  onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                  placeholder="445"
                />
              </label>
            </div>
          </>
        )}
        <label className="nas-field">
          <span>아이디</span>
          <input className="search" value={c.user} onChange={(e) => set({ user: e.target.value })} autoCapitalize="off" autoCorrect="off" />
        </label>
        <label className="nas-field">
          <span>비밀번호</span>
          <input
            className="search"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={initial.id && initial.hasPassword ? '(저장됨 — 바꿀 때만 입력)' : ''}
          />
        </label>
        {msg && <div className={`nas-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
        <div className="flat-group nas-actions">
          <button className="btn" disabled={!valid || busy} onClick={test}>
            연결 테스트
          </button>
          <button className="btn primary" disabled={!valid || busy} onClick={save}>
            저장
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Browse a NAS connection's folders and pick one (returns /nas/<id>/<path>).
export function NasBrowser({
  conn,
  onPick,
  onClose
}: {
  conn: NasConn
  onPick: (path: string) => void
  onClose: () => void
}): JSX.Element {
  const root = `/nas/${conn.id}`
  const [path, setPath] = useState(root)
  const [dirs, setDirs] = useState<string[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setDirs(null)
    setErr(null)
    window.api
      .listDirs(path)
      .then((d) => alive && setDirs(d))
      .catch((e) => alive && setErr(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [path])
  const rel = splitNasPath(path).rel
  const up = (): void => setPath(path.slice(0, path.lastIndexOf('/')))

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal nas-modal nas-browser" onClick={(e) => e.stopPropagation()}>
        <div className="nas-head">
          {path !== root && (
            <button className="icon-close" onClick={up} title="상위 폴더">
              <ChevronLeftIcon />
            </button>
          )}
          <b className="nas-where">
            {conn.name}:/{rel}
          </b>
          <button className="icon-close" onClick={onClose} title="닫기">
            <CloseIcon />
          </button>
        </div>
        <div className="nas-list">
          {err && <div className="nas-msg err">{err}</div>}
          {!err && !dirs && <div className="hint">불러오는 중…</div>}
          {dirs && dirs.length === 0 && <div className="hint">하위 폴더 없음</div>}
          {dirs?.map((d) => (
            <button key={d} className="nas-dir" onClick={() => setPath(`${path}/${d}`)}>
              <FolderIcon />
              <span>{d}</span>
            </button>
          ))}
        </div>
        <div className="flat-group nas-actions">
          <button className="btn primary" onClick={() => onPick(path)}>
            이 폴더 선택
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
