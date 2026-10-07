import { useState } from 'react'
import type { JSX } from 'react'
import type { Work } from '../../../shared/types'
import { useStore } from '../store'
import { allTags, tagToken } from '../util'
import Thumb from './Thumb'
import { ArtistLinks } from './ArtistLinks'
import Stars from './Stars'
import TagList from './TagList'
import EditionsPanel from './EditionsPanel'
import FavGroup from './FavGroup'
import { useWorkCard } from './useWorkCard'
import { useSel } from './libraryTools'
import ConfirmModal from './ConfirmModal'
import Caret from './Caret'

// List row for a local work on the home library: thumb, title + favorite,
// meta line (pages · code · language · artist), tags, and the action row
// (rating, 메타 채우기, folder, delete, editions finder). Card behavior
// (clicks, favorite, tags, menus) is shared with the grid tile via useWorkCard.
export default function WorkCard({ work }: { work: Work }): JSX.Element {
  const setFilter = useStore((s) => s.setFilter)
  const addSearchToken = useStore((s) => s.addSearchToken)
  const upsertWork = useStore((s) => s.upsertWork)
  const removeWork = useStore((s) => s.removeWork)
  const favoriteTags = useStore((s) => s.settings.favoriteTags)
  const c = useWorkCard(work)
  const sel = useSel(work.id)
  const [findKo, setFindKo] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const copyCode = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!work.code) return
    navigator.clipboard.writeText(work.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  const tags = allTags(work)

  return (
    <div className="work-card-wrap">
    <div className={`work-card${sel.cls}`} {...c.cardEvents} {...sel.attr}>
      {sel.box}
      <Thumb workId={work.id} />
      <div className="work-info">
        <div className="work-title-row">
          <span className="work-title selectable">{work.title}</span>
          <FavGroup favorite={c.isFav} onToggle={c.toggleFav} work={work} />
        </div>

        <div className="work-meta">
          {work.pageCount}p
          {work.code && (
            <>
              {' · '}
              <span className="code copyable" onClick={copyCode}>
                [{work.code}]{copied ? ' ✓복사됨' : ''}
              </span>
            </>
          )}
          {work.language && ` · ${work.language}`}
          {work.artist && (
            <>
              {' · '}
              <ArtistLinks
                artist={work.artist}
                onPick={(a) => setFilter({ kind: 'artist', value: a })}
                onMenu={(a, e) => c.openTagMenu(e, tagToken(`artist:${a}`), a)}
              />
            </>
          )}
        </div>

        <div className="work-tags">
          <TagList
            tags={tags}
            favoriteTags={favoriteTags}
            manualTags={work.manualTags}
            onTagClick={(t) => addSearchToken(tagToken(t))}
            onTagContext={(t, e) => c.openTagMenu(e, tagToken(t), t)}
            onRemove={c.removeTag}
            onAddClick={c.adding ? undefined : c.startAddTag}
          />
          {c.tagInput}
        </div>

        <div className="work-actions">
          <Stars rank={work.rank} onChange={c.setRank} />
          {work.code && (
            <button
              className="mini"
              onClick={async (e) => {
                e.stopPropagation()
                try {
                  upsertWork(await window.api.doujinEnrich(work.id))
                } catch (err: any) {
                  alert(String(err?.message ?? err))
                }
              }}
            >
              메타 채우기
            </button>
          )}
          <button
            className="mini"
            onClick={(e) => {
              e.stopPropagation()
              window.api.openInExplorer(work.id)
            }}
          >
            폴더 열기
          </button>
          <button
            className="mini danger"
            onClick={(e) => {
              e.stopPropagation()
              setConfirmDel(true)
            }}
          >
            삭제
          </button>
          <button
            className={`mini ko-toggle ${findKo ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              setFindKo((v) => !v)
            }}
          >
            다른 언어 <Caret up={findKo} sm />
          </button>
        </div>
      </div>
    </div>
    {findKo && (
      <EditionsPanel inline code={work.code} artist={work.artist} title={work.title} language={work.language} />
    )}
    {confirmDel && (
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmModal
          danger
          icon="🗑"
          title="작품을 삭제할까요?"
          desc={<><b>{work.title}</b> 폴더를 영구 삭제합니다. 되돌릴 수 없습니다.</>}
          confirmLabel="삭제"
          cancelLabel="취소"
          onConfirm={async () => {
            setConfirmDel(false)
            await window.api.deleteWork(work.id)
            removeWork(work.id)
          }}
          onCancel={() => setConfirmDel(false)}
        />
      </div>
    )}
    {c.workMenu}
    {c.tagMenu}
    </div>
  )
}
