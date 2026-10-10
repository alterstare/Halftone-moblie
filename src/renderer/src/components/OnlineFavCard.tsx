import { useState } from 'react'
import type { JSX } from 'react'
import type { OnlineFav } from '../../../shared/types'
import { useStore, lastReadKey, useFavoriteTags } from '../store'
import { getOnlineImages } from '../images'
import OnlineThumb from './OnlineThumb'
import Stars from './Stars'
import TagList from './TagList'
import { useFavSummaries, getFavSummary } from '../favSummaries'
import { tagToken, isComicCode } from '../util'
import { useSel } from './libraryTools'
import { CheckIcon, PauseIcon, PlayIcon, DownloadIcon, SyncIcon, FavoriteIcon } from './icons'
import { ArtistLinks } from './ArtistLinks'
import { useTagMenu } from './useTagMenu'
import MoreClamp from './MoreClamp'
import TileBar, { CompactBar } from './TileBar'
import CardMore from './CardMore'
import CopyCode from './CopyCode'

// An online work that isn't downloaded yet — a favorite, or a 기록 entry — (doujin numeric code or manga-site http url),
// shown inside the unified favorites grid alongside local work cards. Clicking
// opens it online; the download button pulls it into the library.
export default function OnlineFavCard({ fav: stored, layout }: { fav: OnlineFav; layout: 'grid' | 'list' }): JSX.Element {
  const isComic = isComicCode(stored.code)
  // Stored favorites carry no tags (and an imported one only its number) → pull
  // the cached gallery summary (doujin only) and fill the gaps from it.
  useFavSummaries(isComic ? [] : [stored.code])
  const sum = isComic ? undefined : getFavSummary(stored.code)
  const fav: OnlineFav = sum
    ? {
        ...stored,
        title: !stored.title || stored.title === stored.code ? sum.title || stored.title : stored.title,
        artist: stored.artist ?? sum.artists[0] ?? null,
        language: stored.language ?? sum.language,
        pageCount: stored.pageCount || sum.pageCount,
        thumbUrl: stored.thumbUrl ?? sum.thumbUrl
      }
    : stored
  const openOnline = useStore((s) => s.openOnline)
  const openComic = useStore((s) => s.openComic)
  const startDownload = useStore((s) => s.startDownload)
  const stopDownload = useStore((s) => s.stopDownload)
  const retryDownload = useStore((s) => s.retryDownload)
  const toggleUnifiedFav = useStore((s) => s.toggleUnifiedFav)
  const toggleNormalUnifiedFav = useStore((s) => s.toggleNormalUnifiedFav)
  const setOnlineRank = useStore((s) => s.setOnlineRank)
  const setOnlineListFav = useStore((s) => s.setOnlineListFav)
  const d = useStore((s) => s.downloads.find((x) => x.code === fav.code))
  const favoriteTags = useFavoriteTags()
  const addSearchToken = useStore((s) => s.addSearchToken)
  const { openTagMenu, tagMenu } = useTagMenu('online')
  // Artist names are links like on the local cards: click = search by that
  // artist, right-click = the usual tag menu.
  const artistLinks = (a: string): JSX.Element => (
    <ArtistLinks
      artist={a}
      onPick={(x) => addSearchToken(tagToken(`artist:${x}`))}
      onMenu={(x, e) => openTagMenu(e, tagToken(`artist:${x}`), x)}
    />
  )
  const tags = (sum?.tags ?? []).filter((t) => !t.startsWith('language:'))

  const phase = d?.phase
  const active = phase === 'queued' || phase === 'fetching' || phase === 'downloading' || phase === 'enriching'
  const paused = phase === 'stopped'
  const err = phase === 'error'
  const done = phase === 'done'
  const pct = d?.total ? Math.round((d.done / d.total) * 100) : 0

  const open = (): void => {
    setOnlineListFav(true) // opened from a favorites view → reader list shows favorites
    const g = { code: fav.code, title: fav.title, artist: fav.artist }
    if (isComic) void openComicSeries()
    else openOnline(g)
  }
  // Manga-site favorites / 기록 entries are keyed by the series url: open the
  // last-read chapter (or the first) with the series attached, like the online
  // browse does — the reader's chapter list, nav and series heart need it.
  const openComicSeries = async (): Promise<void> => {
    try {
      const chapters = await window.api.comicChapters(fav.code)
      if (chapters.length === 0) return alert('이 작품의 화 목록을 찾지 못했습니다.')
      const st = useStore.getState()
      const lastUrl = st.settings.resumeReading !== false ? lastReadKey(st.readProgress, chapters.map((c) => c.url)) : null
      const ch = chapters.find((c) => c.url === lastUrl) ?? chapters[0]
      openComic({
        code: ch.url,
        title: fav.title,
        artist: fav.artist,
        kind: 'comic',
        seriesUrl: fav.code,
        chapterLabel: ch.title,
        thumb: fav.thumbUrl
      })
    } catch (e: any) {
      alert(String(e?.message ?? e))
    }
  }
  const dl = (): void => {
    if (active) return void stopDownload(fav.code)
    if (paused || err) return void retryDownload(fav.code)
    if (isComic) void startDownload({ kind: 'comic', seriesUrl: fav.code, title: fav.title })
    else void startDownload({ kind: 'doujin', input: fav.code, title: fav.title })
  }

  const unfav = (): void =>
    void (isComic ? toggleNormalUnifiedFav({ title: fav.title, url: fav.code, meta: fav }) : toggleUnifiedFav(fav.code, fav))
  const sel = useSel(fav.code)
  const [moreOpen, setMoreOpen] = useState(false)
  const dlBtn = (
    <span
      className={`seg-dl ${done ? 'ok' : ''} ${err ? 'err' : ''} ${paused ? 'paused' : ''}`}
      title={active ? `다운로드 중 ${pct}%` : paused ? '이어받기' : err ? '다시 시도' : '다운로드'}
      onClick={dl}
    >
      {active ? <PauseIcon /> : paused ? <PlayIcon /> : done ? <CheckIcon /> : err ? <SyncIcon /> : <DownloadIcon />}
    </span>
  )

  const heart = (
    <span className={`seg-heart ${fav.favorite ? 'on' : ''}`} title={fav.favorite ? '즐겨찾기 해제' : '즐겨찾기'} onClick={unfav}>
      <FavoriteIcon filled={fav.favorite} />
    </span>
  )
  // 격자형 (2 columns): cover, title, [code] · artist, 즐겨찾기 | 다운로드.
  if (layout === 'grid')
    return (
      <div className={`gtile online-fav ctile${isComic ? ' series' : ''}${sel.cls}`} onClick={open} {...sel.attr}>
        {sel.box}
        <div className="ctile-thumb">
          <OnlineThumb thumbUrl={fav.thumbUrl} className="gtile-thumb-inner" />
          <span className="online-fav-badge">온라인</span>
        </div>
        <div className="ctile-title">{fav.title}</div>
        <div className="ctile-artist">{fav.artist && artistLinks(fav.artist)}</div>
        <div className="ctile-meta">
          {!isComic && <CopyCode code={fav.code} />}
          {!isComic && fav.pageCount > 0 && ' · '}
          {fav.pageCount > 0 && `${fav.pageCount}p`}
        </div>
        <CompactBar fav={heart} action={dlBtn} />
      </div>
    )

  return (
    <div className={`gtile online-fav grid${isComic ? ' series' : ''}${sel.cls}`} onClick={open} {...sel.attr}>
      {sel.box}
      <div className="tile-body">
        <div className="gtile-thumb">
          <OnlineThumb thumbUrl={fav.thumbUrl} className="gtile-thumb-inner" />
          <span className="online-fav-badge">온라인</span>
        </div>
        <div className="tile-info">
          <div className="gtile-title selectable">{fav.title}</div>
          {/* same as the online list: 쪽수 · [번호] · 언어 */}
          <div className="gtile-meta">
            {[
              fav.pageCount ? `${fav.pageCount}p` : null,
              !isComic ? <CopyCode key="code" code={fav.code} /> : null,
              fav.language || null
            ]
              .filter(Boolean)
              .flatMap((x, i) => (i ? [' · ', x] : [x]))}
          </div>
          {fav.artist && <MoreClamp className="gtile-meta gtile-artist">{artistLinks(fav.artist)}</MoreClamp>}
          {tags.length > 0 && (
            <div className="gtile-tags" onClick={(e) => e.stopPropagation()}>
              <TagList
                tags={tags}
                favoriteTags={favoriteTags}
                onTagClick={(t) => addSearchToken(tagToken(t))}
                lines={4}
                fluid
              />
            </div>
          )}
        </div>
      </div>
      <TileBar
        fav={heart}
        rating={<Stars rank={fav.rank ?? 0} onChange={(r) => setOnlineRank(fav.code, r, fav)} />}
        action={dlBtn}
        more={isComic ? undefined : { open: moreOpen, onToggle: () => setMoreOpen((o) => !o) }}
      />
      {moreOpen && !isComic && (
        <CardMore
          getImgs={() => getOnlineImages(fav.code)}
          editions={{ code: fav.code, artist: fav.artist, title: fav.title, language: fav.language }}
        />
      )}
      {tagMenu}
    </div>
  )
}
