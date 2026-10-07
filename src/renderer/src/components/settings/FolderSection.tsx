// 폴더·저장: library roots, download/language folders, and the doujin
// download folder-name patterns. Also exports the folder rows reused by other
// sections (download). The favorites folder lives in the 즐겨찾기
// box (TagSection).
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { NasConn } from '../../../../shared/ipc'
import { useNas, emptyConn } from '../../nas'
import { NasConnModal } from '../NasDialogs'
import ConfirmModal from '../ConfirmModal'
import { fillNamePattern, SAMPLE_FIELDS } from '../../../../shared/pattern'
import SettingRow from '../SettingRow'
import Toggle from '../Toggle'
import { useSettings } from './context'
import { RootList, FolderRow } from './parts'

// Download folder of the current mode.
export function DownloadDirRow(): JSX.Element {
  const { draft, patch, isDoujin, pickDir } = useSettings()
  return isDoujin ? (
    <FolderRow
      title="다운로드 폴더"
      desc="받은 작품을 저장할 폴더. 비우면 라이브러리 폴더에 저장합니다."
      path={draft.downloadDir}
      onPick={() => pickDir((d) => patch({ downloadDir: d }))}
      onClear={() => patch({ downloadDir: null })}
      mode="doujin"
    />
  ) : (
    <FolderRow
      title="다운로드 폴더"
      desc="온라인에서 받은 일반 만화를 저장할 폴더."
      path={draft.normalDownloadDir}
      onPick={() => pickDir((d) => patch({ normalDownloadDir: d }))}
      onClear={() => patch({ normalDownloadDir: null })}
      mode="normal"
    />
  )
}

// Download folder-name patterns (-id-, -title-, -artist-, -group-, -language-);
// the checked one names new downloads.
function NamePatterns(): JSX.Element {
  const { draft, patch } = useSettings()
  const patterns = draft.doujinNamePatterns ?? []
  const setAt = (i: number, v: string): void => {
    const arr = [...patterns]
    arr[i] = v
    patch({ doujinNamePatterns: arr })
  }
  const removeAt = (i: number): void => {
    const arr = patterns.filter((_, x) => x !== i)
    const idx = draft.doujinDownloadPatternIdx
    // Keep the checked pattern pointing at the same entry (or the last one).
    patch({
      doujinNamePatterns: arr,
      doujinDownloadPatternIdx: idx > i ? idx - 1 : idx >= arr.length ? Math.max(0, arr.length - 1) : idx
    })
  }
  return (
    <div className="set-block">
      <SettingRow
        title="폴더명 패턴"
        desc="지원되는 변수는 [-id-, -title-, -artist-, -group-, -language-] 입니다. 체크된 형식으로 다운로드합니다."
      >
        <button className="mini" onClick={() => patch({ doujinNamePatterns: [...patterns, ''] })}>
          + 형식 추가
        </button>
      </SettingRow>
      {patterns.map((p, i) => (
        <div className="pat-row" key={i}>
          <div className="pat-line">
            <button
              type="button"
              className={`pat-check ${draft.doujinDownloadPatternIdx === i ? 'on' : ''}`}
              title="다운로드에 사용할 형식"
              onClick={() => patch({ doujinDownloadPatternIdx: i })}
            />
            <input
              type="text"
              className="field-input"
              value={p}
              placeholder="-artist- [-id-] -title-"
              onChange={(e) => setAt(i, e.target.value)}
            />
            <button className="mini danger" onClick={() => removeAt(i)}>
              삭제
            </button>
          </div>
          {p.trim() && (
            <div className="pat-example">
              예시: <span>{fillNamePattern(p, SAMPLE_FIELDS)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// Folders non-Korean works are moved into by "언어 정리".
function LanguageDirs(): JSX.Element {
  const { draft, patch, pickDir, rescanning, rescan } = useSettings()
  const LABEL = { english: '영어', japanese: '일본어', other: '기타' } as const
  return (
    <div className="set-block">
      <div className="set-sub">언어별 폴더</div>
      {(['english', 'japanese', 'other'] as const).map((k) => {
        const dir = draft.langDirs[k]
        return (
          <div className="path-item" key={k}>
            <span className="path-label">{LABEL[k]}</span>
            <code>{dir ?? '(미지정)'}</code>
            {dir && (
              <>
                <button className="mini" onClick={() => window.api.openFolder(dir)}>
                  열기
                </button>
                <button className="mini" disabled={rescanning === dir} onClick={() => rescan(dir, 'doujin')}>
                  {rescanning === dir ? '갱신 중…' : '갱신'}
                </button>
                <button className="mini danger" onClick={() => patch({ langDirs: { ...draft.langDirs, [k]: null } })}>
                  해제
                </button>
              </>
            )}
            <button className="mini" onClick={() => pickDir((d) => patch({ langDirs: { ...draft.langDirs, [k]: d } }))}>
              선택
            </button>
          </div>
        )
      })}
    </div>
  )
}

// NAS (WebDAV / SMB) connections. Folders on them are added through the
// usual "+ 폴더 추가" (it asks: this device or which NAS).
function NasConnections(): JSX.Element {
  const conns = useNas((s) => s.conns)
  const [edit, setEdit] = useState<NasConn | null>(null)
  const [del, setDel] = useState<NasConn | null>(null)
  useEffect(() => {
    void useNas.getState().refresh()
  }, [])
  return (
    <div className="set-block">
      <SettingRow
        title="NAS 연결"
        desc="WebDAV / SMB로 NAS에 연결합니다. 연결한 뒤 폴더 추가에서 NAS 폴더를 고를 수 있습니다. 비밀번호는 기기에 암호화해 저장됩니다."
      >
        <button className="mini" onClick={() => setEdit(emptyConn('webdav'))}>
          + NAS 연결
        </button>
      </SettingRow>
      {conns.map((c) => (
        <div className="path-item" key={c.id}>
          <code>
            {c.name} · {c.type === 'webdav' ? `WebDAV ${c.url}` : `SMB ${c.host}/${c.share}`}
          </code>
          <button className="mini" onClick={() => setEdit(c)}>
            편집
          </button>
          <button className="mini danger" onClick={() => setDel(c)}>
            삭제
          </button>
        </div>
      ))}
      {conns.length === 0 && <div className="path-item empty">연결된 NAS 없음</div>}
      {edit && <NasConnModal initial={edit} onClose={() => setEdit(null)} />}
      {del && (
        <ConfirmModal
          compact
          danger
          title={`NAS 연결 '${del.name}'을(를) 삭제하시겠습니까?`}
          desc={<>이 NAS의 폴더는 라이브러리에서 더 이상 읽을 수 없게 됩니다. NAS의 파일은 지워지지 않습니다.</>}
          confirmLabel="삭제"
          onConfirm={async () => {
            await window.api.nasRemove(del.id)
            await useNas.getState().refresh()
            setDel(null)
          }}
          onCancel={() => setDel(null)}
        />
      )}
    </div>
  )
}

export default function FolderSection(): JSX.Element {
  const { draft, patch, isDoujin, pickDir } = useSettings()
  const addTo = (key: 'libraryRoots' | 'normalRoots' | 'flattenRoots') => () =>
    pickDir((d) => patch({ [key]: [...new Set([...(draft[key] ?? []), d])] }))
  const removeFrom = (key: 'libraryRoots' | 'normalRoots' | 'flattenRoots') => (r: string) =>
    patch({ [key]: (draft[key] ?? []).filter((x) => x !== r) })

  return (
    <section data-cat="folder">
      <h2>폴더</h2>
      <SettingRow
        title="갤러리에서 숨기기"
        desc="다운로드 폴더에 .nomedia 파일을 두어 휴대폰 갤러리 앱이 다운로드한 이미지를 표시하지 않게 합니다. (감상창에서 '이미지 저장'으로 저장한 이미지는 그대로 보입니다.)"
      >
        <Toggle checked={draft.hideFromGallery !== false} onChange={(v) => patch({ hideFromGallery: v })} />
      </SettingRow>
      <NasConnections />
      {isDoujin ? (
        <>
          <RootList
            title="라이브러리 폴더"
            desc="만화가 들어 있는 폴더들. 각 하위 폴더가 한 작품으로 인식됩니다."
            roots={draft.libraryRoots}
            onAdd={addTo('libraryRoots')}
            onRemove={removeFrom('libraryRoots')}
            mode="doujin"
          />
          <NamePatterns />
          <RootList
            title="작가 폴더"
            desc="지정 폴더 바로 아래의 폴더 이름을 그 아래 모든 작품의 작가명으로 넣습니다 (지정 폴더 / 작가 폴더 / 작품 폴더 / 이미지)."
            roots={draft.flattenRoots ?? []}
            onAdd={addTo('flattenRoots')}
            onRemove={removeFrom('flattenRoots')}
            mode="doujin"
            addLabel="+ 위치 추가"
          />
          <DownloadDirRow />
          <LanguageDirs />
        </>
      ) : (
        <>
          <RootList
            title="일반 만화 폴더"
            desc="일반 만화가 들어 있는 폴더들. 보통 작품마다 여러 화 폴더로 나뉩니다."
            roots={draft.normalRoots}
            onAdd={addTo('normalRoots')}
            onRemove={removeFrom('normalRoots')}
            mode="normal"
          />
          <DownloadDirRow />
        </>
      )}
    </section>
  )
}
