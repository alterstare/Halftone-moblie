import { useState } from 'react'
import type { JSX } from 'react'
import { useStore, useFavoriteTags } from '../store'
import { tagToken, type SeriesGroup } from '../util'
import Thumb from './Thumb'
import { ArtistLinks } from './ArtistLinks'
import Stars from './Stars'
import TagList from './TagList'
import GroupButton from './GroupButton'
import MoreClamp from './MoreClamp'
import TileBar, { CompactBar } from './TileBar'
import CardMore from './CardMore'
import { getImages } from '../images'
import { FavoriteIcon } from './icons'
import { useSeriesCard } from './useSeriesCard'
import { useSel } from './libraryTools'

// Grid tile for a general-manga series (phone layout, same shape as
// WorkGridCard): representative chapter's cover on the left; title, chapter
// count, artist (1 line + 더보기) and tags on the right; favorite | rating |
// group bar below. Behavior is shared with the list card via useSeriesCard.
// `compact` = the 2-column 격자형 card (cover, title, 화 수 · artist,
// 즐겨찾기 | 그룹); otherwise the 목록형 card with the 더보기 preview.
export default function SeriesGridCard({ series, compact = false }: { series: SeriesGroup; compact?: boolean }): JSX.Element {
  const addSearchToken = useStore((s) => s.addSearchToken)
  const favoriteTags = useFavoriteTags()
  const c = useSeriesCard(series)
  const sel = useSel(series.key)
  const [moreOpen, setMoreOpen] = useState(false)
  const heart = (
    <span className={`seg-heart ${c.isFav ? 'on' : ''}`} title="즐겨찾기" onClick={c.toggleFav}>
      <FavoriteIcon filled={c.isFav} />
    </span>
  )
  const group = c.rep && <GroupButton work={c.rep} applyTo={c.chapters} />

  if (compact)
    return (
      <div className={`gtile series ctile${sel.cls}`} {...c.cardEvents} {...sel.attr}>
        {sel.box}
        <div className="ctile-thumb">
          <Thumb workId={c.rep?.id ?? ''} />
        </div>
        <div className="ctile-title">{series.title}</div>
        <div className="ctile-artist">
          {c.artist && (
            <ArtistLinks
              artist={c.artist}
              onPick={(a) => addSearchToken(tagToken(`artist:${a}`))}
              onMenu={(a, e) => c.openTagMenu(e, tagToken(`artist:${a}`), a)}
            />
          )}
        </div>
        <div className="ctile-meta">전체 {c.chapters.length}화</div>
        <CompactBar fav={heart} action={group} />
        {c.seriesMenu}
        {c.tagMenu}
      </div>
    )

  return (
    <div className={`gtile series${sel.cls}`} {...c.cardEvents} {...sel.attr}>
      {sel.box}
      <div className="tile-body">
        <div className="gtile-thumb">
          <Thumb workId={c.rep?.id ?? ''} />
        </div>
        <div className="tile-info">
          <div className="gtile-title selectable">{series.title}</div>
          <div className="gtile-meta">전체 {c.chapters.length}화</div>
          {c.artist && (
            <MoreClamp className="gtile-meta gtile-artist">
              <ArtistLinks
                artist={c.artist}
                onPick={(a) => addSearchToken(tagToken(`artist:${a}`))}
                onMenu={(a, e) => c.openTagMenu(e, tagToken(`artist:${a}`), a)}
              />
            </MoreClamp>
          )}
          <div className="gtile-tags">
            <TagList
              tags={c.seriesTags}
              favoriteTags={favoriteTags}
              manualTags={c.seriesTags}
              onTagClick={(t) => addSearchToken(tagToken(t))}
              onTagContext={(t, e) => c.openTagMenu(e, tagToken(t), t)}
              onRemove={c.removeSeriesTag}
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
        rating={<Stars rank={c.maxRank} onChange={c.rankAll} />}
        action={group}
        more={c.rep ? { open: moreOpen, onToggle: () => setMoreOpen((o) => !o) } : undefined}
      />
      {moreOpen && c.rep && <CardMore getImgs={() => getImages(c.rep!.id)} />}
      {c.seriesMenu}
      {c.tagMenu}
    </div>
  )
}
