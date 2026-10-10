import { useState } from 'react'
import type { JSX } from 'react'
import type { Work } from '../../../shared/types'
import { useStore, useFavoriteTags } from '../store'
import { allTags, tagToken } from '../util'
import Thumb from './Thumb'
import { ArtistLinks } from './ArtistLinks'
import Stars from './Stars'
import TagList from './TagList'
import GroupButton from './GroupButton'
import MoreClamp from './MoreClamp'
import TileBar, { CompactBar } from './TileBar'
import CardMore from './CardMore'
import CopyCode from './CopyCode'
import { getImages } from '../images'
import { FavoriteIcon } from './icons'
import { useWorkCard } from './useWorkCard'
import { useSel } from './libraryTools'

// Grid tile for a local work on the home library (phone layout): thumb on the
// left, text on the right — full title, meta, artist (1 line + 더보기), 5 tag
// rows (+ 추가 태그 보기) — and a 3-cell bar below: favorite | rating | group.
// The tile grows with its content (see .gtile in mobile.css). Behavior is
// shared with the list card via useWorkCard.
// `compact` = the 2-column 격자형 card: cover on top, title, [code] · artist,
// 즐겨찾기 | 그룹. Without it this is the 목록형 card (with the 더보기 panel).
export default function WorkGridCard({ work, compact = false }: { work: Work; compact?: boolean }): JSX.Element {
  const setFilter = useStore((s) => s.setFilter)
  const addSearchToken = useStore((s) => s.addSearchToken)
  const favoriteTags = useFavoriteTags()
  const c = useWorkCard(work)
  const sel = useSel(work.id)
  const [moreOpen, setMoreOpen] = useState(false)
  const heart = (
    <span className={`seg-heart ${c.isFav ? 'on' : ''}`} title="즐겨찾기" onClick={c.toggleFav}>
      <FavoriteIcon filled={c.isFav} />
    </span>
  )

  if (compact)
    return (
      <div className={`gtile ctile${sel.cls}`} {...c.cardEvents} {...sel.attr}>
        {sel.box}
        <div className="ctile-thumb">
          <Thumb workId={work.id} />
        </div>
        <div className="ctile-title">{work.title}</div>
        <div className="ctile-artist">
          {work.artist && (
            <ArtistLinks
              artist={work.artist}
              onPick={(a) => setFilter({ kind: 'artist', value: a })}
              onMenu={(a, e) => c.openTagMenu(e, tagToken(`artist:${a}`), a)}
            />
          )}
        </div>
        <div className="ctile-meta">
          {work.code && (
            <>
              <CopyCode code={work.code} />
              {' · '}
            </>
          )}
          {work.pageCount}p
        </div>
        <CompactBar fav={heart} action={<GroupButton work={work} />} />
        {c.workMenu}
        {c.tagMenu}
      </div>
    )

  return (
    <div className={`gtile${sel.cls}`} {...c.cardEvents} {...sel.attr}>
      {sel.box}
      <div className="tile-body">
        <div className="gtile-thumb">
          <Thumb workId={work.id} />
        </div>
        <div className="tile-info">
          <div className="gtile-title selectable">{work.title}</div>
          <div className="gtile-meta">
            {work.pageCount}p
            {work.code && (
              <>
                {' · '}
                <CopyCode code={work.code} />
              </>
            )}
            {work.language && ` · ${work.language}`}
          </div>
          {work.artist && (
            <MoreClamp className="gtile-meta gtile-artist">
              <ArtistLinks
                artist={work.artist}
                onPick={(a) => setFilter({ kind: 'artist', value: a })}
                onMenu={(a, e) => c.openTagMenu(e, tagToken(`artist:${a}`), a)}
              />
            </MoreClamp>
          )}
          <div className="gtile-tags">
            <TagList
              tags={allTags(work)}
              favoriteTags={favoriteTags}
              manualTags={work.manualTags}
              onTagClick={(t) => addSearchToken(tagToken(t))}
              onTagContext={(t, e) => c.openTagMenu(e, tagToken(t), t)}
              onRemove={c.removeTag}
              onAddClick={c.adding ? undefined : c.startAddTag}
              lines={4}
              fluid
            />
            {c.tagInput}
          </div>
        </div>
      </div>
      <TileBar
        fav={heart}
        rating={<Stars rank={work.rank} onChange={c.setRank} />}
        action={<GroupButton work={work} />}
        more={{ open: moreOpen, onToggle: () => setMoreOpen((o) => !o) }}
      />
      {moreOpen && (
        <CardMore
          getImgs={() => getImages(work.id)}
          editions={
            (work.library ?? 'doujin') === 'doujin'
              ? { code: work.code, artist: work.artist, title: work.title, language: work.language }
              : undefined
          }
        />
      )}
      {c.workMenu}
      {c.tagMenu}
    </div>
  )
}
