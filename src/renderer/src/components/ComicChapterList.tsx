import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useStore, useSeriesRoots, lastReadKey } from '../store'
import { groupSeries, titleKey, isComicCode } from '../util'
import { getComicChapters } from '../comic'
import type { ComicChapter } from '../../../shared/ipc'
import type { OnlineFav } from '../../../shared/types'
import Stars from './Stars'
import { FavoriteIcon, AutoStoriesIcon } from './icons'
import { useComicStatus } from './useComicStatus'
import SearchClear from './SearchClear'
import { useTabState } from './useTabState'

// Left list shown while reading a manga-site chapter: the sibling chapters of the active
// tab's series. Mirrors the local general-manga left list (LibraryList) so the
// reader chrome is identical between local and online in general-manga mode.
export default function ComicChapterList(): JSX.Element {
  const comicStatus = useComicStatus()
  const replaceTabOnline = useStore((s) => s.replaceTabOnline)
  const onlineFavs = useStore((s) => s.onlineFavs)
  const toggleNormalUnifiedFav = useStore((s) => s.toggleNormalUnifiedFav)
  const works = useStore((s) => s.works)
  const normalFavSeries = useStore((s) => s.settings.normalFavSeries)
  const roots = useSeriesRoots()
  const toggleOnlineFav = useStore((s) => s.toggleOnlineFav)
  const setOnlineRank = useStore((s) => s.setOnlineRank)
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const online = active?.online
  const seriesUrl = online?.seriesUrl

  // Series heart state = what toggleNormalUnifiedFav sees: this series url, any
  // online favorite of the same title, or a favorited local series of that title.
  const seriesFav = useMemo(() => {
    if (!online || !seriesUrl) return false
    if (onlineFavs[seriesUrl]?.favorite) return true
    const k = titleKey(online.title)
    if (!k) return false
    if (Object.values(onlineFavs).some((f) => f.favorite && isComicCode(f.code) && titleKey(f.title) === k)) return true
    const favS = normalFavSeries ?? []
    return groupSeries(works.filter((w) => (w.library ?? 'doujin') === 'normal'), roots).some(
      (g) => titleKey(g.title) === k && favS.includes(g.key)
    )
  }, [online, seriesUrl, onlineFavs, works, normalFavSeries, roots])

  // Per-chapter online favorite/rank stored in onlineFavs, keyed by chapter url —
  // gives the online reader the same 평점/즐겨찾기 controls as the local one.
  const chapterMeta = (c: ComicChapter): Partial<OnlineFav> => ({
    title: c.title,
    artist: online?.artist ?? null,
    thumbUrl: online?.thumb,
    language: null,
    pageCount: 0
  })

  const [chapters, setChapters] = useState<ComicChapter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useTabState('input', '')
  const [applied, setApplied] = useTabState('applied', '')

  useEffect(() => {
    if (!seriesUrl) {
      setChapters([])
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    getComicChapters(seriesUrl)
      .then((c) => alive && setChapters(c))
      .catch((e) => alive && setError(String(e?.message ?? e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [seriesUrl])

  const apply = (): void => setApplied(input.trim())
  const q = applied.toLowerCase()
  const list = q ? chapters.filter((c) => c.title.toLowerCase().includes(q)) : chapters
  const readProgress = useStore((s) => s.readProgress)
  const lastUrl = useMemo(() => lastReadKey(readProgress, chapters.map((c) => c.url)), [readProgress, chapters])

  return (
    <div className="lib-list">
      <div className="lib-list-head">
        <span className="lib-series-label wide">
          <AutoStoriesIcon /> 시리즈 · {chapters.length}화
          {seriesUrl && online && (
            <span className="lib-series-actions">
              {/* Series favorite, unified with a local series of the same title —
                  same heart as the online browse card. */}
              <span className="seg" onClick={(e) => e.stopPropagation()}>
                <span
                  className={`seg-heart ${seriesFav ? 'on' : ''}`}
                  title="즐겨찾기"
                  onClick={() =>
                    void toggleNormalUnifiedFav({
                      title: online.title,
                      url: seriesUrl,
                      meta: { title: online.title, artist: online.artist, thumbUrl: online.thumb, language: null, pageCount: 0 }
                    })
                  }
                >
                  <FavoriteIcon filled={seriesFav} />
                </span>
              </span>
            </span>
          )}
        </span>
      </div>
      <div className="lib-search-row">
        <div className="search-ac">
          <input
            className="search sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            placeholder="검색"
          />
          <SearchClear value={input} onClear={() => setInput('')} />
        </div>
      </div>
      {applied && (
        <div className="applied-row">
          <span className="applied-q">“{applied}”</span>
          <span
            className="mini"
            onClick={() => {
              setInput('')
              setApplied('')
            }}
          >
            초기화
          </span>
        </div>
      )}
      <div className="lib-list-scroll compact">
        {error && <div className="warn err">{error}</div>}
        {loading && <div className="reader-loading">{comicStatus ?? '불러오는 중…'}</div>}
        {list.map((c) => {
          const fav = onlineFavs[c.url]
          return (
            <div
              key={c.url}
              // read = opened before (readProgress) → light purple; last-read = outline.
              className={`chapter-row ${c.url === online?.code ? 'active' : ''} ${c.url === lastUrl ? 'last-read' : ''} ${readProgress[c.url] ? 'read' : ''}`}
              onClick={() =>
                active &&
                replaceTabOnline(active.id, {
                  code: c.url,
                  title: online?.title ?? c.title,
                  artist: online?.artist ?? null,
                  kind: 'comic',
                  seriesUrl,
                  chapterLabel: c.title,
                  thumb: online?.thumb
                })
              }
              title={c.title}
            >
              <div className="chapter-line">
                <span className="ch-label">{c.title}</span>
                <span className="ch-spacer" />
                <span
                  className={`ch-heart ${fav?.favorite ? 'on' : ''}`}
                  title="즐겨찾기"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleOnlineFav(c.url, chapterMeta(c))
                  }}
                >
                  <FavoriteIcon filled={!!fav?.favorite} />
                </span>
              </div>
              {/* Rating on its own line at the bottom right → the title gets the full width. */}
              <div className="chapter-sub">
                <Stars rank={fav?.rank ?? 0} onChange={(r) => setOnlineRank(c.url, r, chapterMeta(c))} size={13} />
              </div>
            </div>
          )
        })}
        {!loading && !error && chapters.length === 0 && <div className="hint">화 목록이 없습니다.</div>}
        {chapters.length > 0 && <div className="result-count">{chapters.length}개</div>}
      </div>
    </div>
  )
}
