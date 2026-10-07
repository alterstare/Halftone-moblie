import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore, useSeriesRoots, lastReadKey } from '../store'
import type { ComicListSource, ComicSummary, ComicSort, ComicType } from '../../../shared/ipc'
import type { OnlineFav } from '../../../shared/types'
import Stars from './Stars'
import MoreClamp from './MoreClamp'
import { ArtistLinks } from './ArtistLinks'
import TileBar from './TileBar'
import { useSelection, SelBox, SelectBar, usePullRefresh, LibraryFab, useSwipeNav, useBackHandler } from './libraryTools'
import ComicDownloadModal from './ComicDownloadModal'
import type { ComicSeriesRef } from './ComicDownloadModal'
import ComicBackupModal from './ComicBackupModal'
import OnlineThumb from './OnlineThumb'
import { FavoriteIcon, DownloadIcon, FilterAltIcon, SortIcon, ArrowDownIcon } from './icons'
import { BypassToggle, OnlineOnlyToggle, FavSortSelect } from './FavDlToggle'
import Pager from './Pager'
import { groupSeries, titleKey, isComicCode } from '../util'
import { useComicStatus } from './useComicStatus'
import SearchClear from './SearchClear'
import Dropdown from './Dropdown'
import ContextMenu from './ContextMenu'

const SORTS: [ComicSort, string][] = [
  ['date', '최신순'],
  ['new', '신작순'],
  ['bookmark', '북마크순'],
  ['view', '조회순'],
  ['rating', '평점순'],
  ['chapter', '화수순']
]
const TYPES: [ComicType, string][] = [
  ['manga', '만화'],
  ['webtoon', '웹툰']
]

// Meta cached alongside a manga-site online favorite (keyed by the series url).
function favMeta(g: ComicSummary, artist: string | null): Partial<OnlineFav> {
  return { title: g.title, artist, thumbUrl: g.thumb, language: null, pageCount: 0 }
}

// General-manga online browse (manga-site-family mirror). Full-screen, mirrors the
// doujin Browse. Clicking a series fetches its chapters and opens chapter 1.
// Favorites/ratings reuse the online-fav store, keyed by the series url (http),
// which keeps them separate from the doujin numeric-code favorites.
const NO_GENRES: string[] = []
// Webtoon 분류 (`cat=`); '' = the site default (일반웹툰).
const CATS: readonly (readonly [string, string])[] = [
  ['all', '전체'],
  ['', '일반'],
  ['bl', 'BL/GL'],
  ['adult', '성인']
]

export default function ComicBrowse(): JSX.Element {
  const comicStatus = useComicStatus()
  const openComic = useStore((s) => s.openComic)
  const openComicBackground = useStore((s) => s.openComicBackground)
  const openGlance = useStore((s) => s.openGlance)
  const onlineFavs = useStore((s) => s.onlineFavs)
  const toggleNormalUnifiedFav = useStore((s) => s.toggleNormalUnifiedFav)
  const favOnlineOnly = useStore((s) => s.favOnlineOnly)
  const works = useStore((s) => s.works)
  const openTab = useStore((s) => s.openTab)
  const roots = useSeriesRoots()
  const normalFavSeries = useStore((s) => s.settings.normalFavSeries)
  const setOnlineRank = useStore((s) => s.setOnlineRank)
  const authorSeed = useStore((s) => s.comicAuthorSeed)
  const browseTopNonce = useStore((s) => s.browseTopNonce)
  const rootRef = useRef<HTMLDivElement>(null)
  // Bumped to force a fresh fetch even when source/page are unchanged (used by
  // the 🌐 double-press reset when already on the first page).
  const [reloadKey, setReloadKey] = useState(0)
  // Phone: 인증창 / 주소 / 비상용 and the genre list stay folded until asked for.
  const [toolsOpen, setToolsOpen] = useState(false)
  // Which filter dropdown is open (만화: 장르; 웹툰: 요일 / 장르 / 플랫폼).
  const [filterOpen, setFilterOpen] = useState<'cat' | 'day' | 'genre' | 'plat' | null>(null)
  // Webtoon 분류: '' = 일반 (site default), 'all' / 'bl' / 'adult'.
  const [cat, setCat] = useState<string>('')
  const [day, setDay] = useState<string>('')
  const [plat, setPlat] = useState<string>('')
  const [platforms, setPlatforms] = useState<{ id: string; name: string }[]>([])
  const refreshWaiters = useRef<(() => void)[]>([]) // pull-to-refresh waits for the fetch
  const comicBaseUrl = useStore((s) => s.settings.comicBaseUrl)
  const setSettings = useStore((s) => s.setSettings)
  const [addrOpen, setAddrOpen] = useState(false)
  const [addr, setAddr] = useState(comicBaseUrl)
  const [genre, setGenre] = useState<string>('전체')
  const [sort, setSort] = useState<ComicSort>('date')
  const [type, setType] = useState<ComicType>('manga')
  const [query, setQuery] = useState('')
  const [field, setField] = useState<'title' | 'author'>('title')
  const [source, setSource] = useState<ComicListSource>({ genre: '전체', sort: 'date', type: 'manga' })
  const [page, setPage] = useState(0)
  // Authors discovered when a series is opened (list cards don't carry them).
  const [authors, setAuthors] = useState<Record<string, string | null>>({})
  const [items, setItems] = useState<ComicSummary[]>([])
  const [hasNext, setHasNext] = useState(false)
  // Start empty so the hardcoded seed genres never flash — chips appear only
  // once the live site responds with its actual genre list.
  const [genres, setGenres] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  // Right-click menu on a card (open / background / 제목 복사).
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; g: ComicSummary } | null>(null)
  const [dlSeries, setDlSeries] = useState<ComicSeriesRef | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [favMode, setFavMode] = useState(false)
  const [favSort, setFavSort] = useState<'rank' | 'recent'>('recent')

  // The browse view is kept mounted (hidden) once first opened, so this effect
  // only re-runs on an actual source/page/base change or a forced reload
  // (🌐 double-press / reloadKey) — returning to the view does NOT refetch.
  // Set when a typed jump overshoots the last page: the site lands on its last
  // page, we sync `page` to it — that state change must not refetch.
  const skipFetch = useRef(false)
  useEffect(() => {
    if (favMode) return
    if (skipFetch.current) {
      skipFetch.current = false
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    setItems([]) // drop the previous page so it doesn't linger under the loader
    window.api
      .comicList(source, page)
      .then((r) => {
        if (!alive) return
        setItems(r.items)
        setHasNext(r.hasNext)
        if (r.page !== page) {
          skipFetch.current = true
          setPage(r.page)
        }
        // Use the genre chips the live page actually offers (per type).
        if (r.genres && r.genres.length) {
          const names = r.genres.map((g) => g.replace(/^✓\s*/, '')).filter((g) => g && g !== '전체')
          setGenres(['전체', ...new Set(names)])
        }
        if (r.platforms && r.platforms.length) setPlatforms(r.platforms)
      })
      .catch((e) => alive && setError(String(e?.message ?? e)))
      .finally(() => {
        if (alive) setLoading(false)
        refreshWaiters.current.splice(0).forEach((r) => r())
      })
    return () => {
      alive = false
    }
  }, [source, page, favMode, comicBaseUrl, reloadKey])

  // Save a new mirror address and reload (the list effect re-runs on base change).
  const saveAddr = async (): Promise<void> => {
    const url = addr.trim().replace(/\/+$/, '')
    if (!url) return
    const s = { ...useStore.getState().settings, comicBaseUrl: url }
    setSettings(s)
    await window.api.saveSettings(s)
    setAddrOpen(false)
    setPage(0)
    setFavMode(false)
  }

  // Apply the current type/sort/genre/query without needing the 적용 button.
  const applySource = (patch: Partial<ComicListSource>): void => {
    const next: ComicListSource = {
      genre,
      sort,
      type,
      query: query.trim() || undefined,
      field,
      cat: cat || undefined,
      day: day || undefined,
      plat: plat || undefined,
      ...patch
    }
    setPage(0)
    setFavMode(false)
    setSource(next)
  }
  const run = (): void => applySource({})
  // Genres: several at once (comma-joined in `genre`, '전체' = none).
  const selGenres = genre === '전체' ? [] : genre.split(',').filter(Boolean)
  const setSelGenres = (next: string[]): void => {
    const v = next.length ? next.join(',') : '전체'
    setGenre(v)
    applySource({ genre: v })
  }
  const toggleGenre = (g: string): void =>
    setSelGenres(g === '전체' ? [] : selGenres.includes(g) ? selGenres.filter((x) => x !== g) : [...selGenres, g])
  const genreLabel = selGenres.length > 1 ? `${selGenres[0]} 외 ${selGenres.length - 1}` : (selGenres[0] ?? '')
  // Pressing the 🌐 online button while already here bumps browseTopNonce →
  // return to the initial listing: KEEP type/sort/genre, but CLEAR the search
  // query (and field). First page + scroll top. Skip the initial mount.
  const mountNonce = useRef(browseTopNonce)
  useEffect(() => {
    if (browseTopNonce === mountNonce.current) return
    mountNonce.current = browseTopNonce
    setFavMode(false)
    setQuery('')
    setField('title')
    setPage(0)
    setSource({ genre, sort, type })
    setReloadKey((k) => k + 1) // force a fresh fetch even if the source is unchanged
    if (rootRef.current) rootRef.current.scrollTop = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseTopNonce])

  // Changing page (이전/다음, or a source switch resets to 0) → scroll to the top,
  // same as the library home does.
  useEffect(() => {
    if (rootRef.current) rootRef.current.scrollTop = 0
  }, [page])
  // Run an author search for a clicked author name.
  const searchAuthor = (name: string): void => {
    setQuery(name)
    setField('author')
    applySource({ query: name, field: 'author' })
  }

  // Author search triggered from another view (reader header etc.).
  useEffect(() => {
    if (!authorSeed) return
    searchAuthor(authorSeed.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorSeed?.nonce])

  // Local general-manga series (downloaded), keyed by normalized title — links a
  // local series with its online manga-site counterpart (they share only the title).
  const localSeries = useMemo(() => {
    const m = new Map<string, { key: string; title: string; repId: string; artist: string | null }>()
    for (const g of groupSeries(works.filter((w) => (w.library ?? 'doujin') === 'normal'), roots)) {
      const k = titleKey(g.title)
      if (k && !m.has(k))
        m.set(k, { key: g.key, title: g.title, repId: g.chapters[0]?.id ?? '', artist: g.chapters.find((c) => c.artist)?.artist ?? null })
    }
    return m
  }, [works, roots])
  // Title keys favorited locally (series hearts in the library).
  const localFavKeys = useMemo(() => {
    const set = new Set<string>()
    for (const [k, v] of localSeries) if ((normalFavSeries ?? []).includes(v.key)) set.add(k)
    return set
  }, [localSeries, normalFavSeries])
  const isFavTitle = (g: ComicSummary): boolean =>
    !!onlineFavs[g.url]?.favorite || localFavKeys.has(titleKey(g.title))

  // Unified favorites: online manga-site favorites + locally-favorited series that have
  // no online favorite yet (url `local:<key>` → opens the downloaded series).
  const normalFavAt = useStore((s) => s.settings.normalFavAt)
  const favGalleries = useMemo<ComicSummary[]>(() => {
    const rows: { g: ComicSummary; t: number; r: number }[] = []
    const seen = new Set<string>()
    for (const f of Object.values(onlineFavs)) {
      if (!f.favorite || !isComicCode(f.code)) continue
      seen.add(titleKey(f.title))
      rows.push({ g: { url: f.code, title: f.title, thumb: f.thumbUrl, artist: f.artist, genre: null, chapter: null }, t: f.addedAt, r: f.rank })
    }
    for (const k of localFavKeys) {
      if (seen.has(k)) continue
      const v = localSeries.get(k)
      if (v)
        rows.push({
          g: { url: `local:${v.key}`, title: v.title, thumb: null, artist: v.artist, genre: null, chapter: null },
          t: normalFavAt?.[v.key] ?? 0,
          r: 0
        })
    }
    rows.sort((x, y) => (favSort === 'rank' ? y.r - x.r || y.t - x.t : y.t - x.t))
    return rows.map((x) => x.g)
  }, [onlineFavs, favSort, localFavKeys, localSeries, normalFavAt])
  // Excluded genres (right-click a genre chip): hide cards carrying any of them.
  const excludeGenres = useStore((s) => s.settings.comicExcludeGenres) ?? NO_GENRES
  const toggleExclude = (g: string): void => {
    const st = useStore.getState()
    const cur = st.settings.comicExcludeGenres ?? []
    const next = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]
    const s = { ...st.settings, comicExcludeGenres: next }
    useStore.setState({ settings: s })
    void window.api.saveSettings(s)
  }
  const shownItems = useMemo(() => {
    if (!excludeGenres.length) return items
    const ex = new Set(excludeGenres)
    return items.filter((it) => !(it.genre ?? '').split(',').some((g) => ex.has(g.trim())))
  }, [items, excludeGenres])
  // "온라인만" toggle hides the local-only entries.
  const gallery = favMode
    ? favOnlineOnly
      ? // not downloaded yet: drop library-only entries and series already in the library
        favGalleries.filter((g) => !g.url.startsWith('local:') && !localSeries.has(titleKey(g.title)))
      : favGalleries
    : shownItems

  const openSeries = async (
    g: ComicSummary,
    target: 'tab' | 'glance' | 'background' = 'tab'
  ): Promise<void> => {
    if (g.url.startsWith('local:')) {
      const v = localSeries.get(titleKey(g.title))
      if (v?.repId) openTab(v.repId)
      return
    }
    setOpening(g.url)
    try {
      const chapters = await window.api.comicChapters(g.url)
      if (chapters.length === 0) {
        alert('이 작품의 화 목록을 찾지 못했습니다. (사이트 구조가 다를 수 있음)')
        return
      }
      // Author + series title are nice-to-haves; fetch after, never block opening.
      const [author, seriesTitle] = await Promise.all([
        window.api.comicSeriesAuthor(g.url).catch(() => null),
        window.api.comicSeriesTitle(g.url).catch(() => null)
      ])
      if (author) setAuthors((a) => ({ ...a, [g.url]: author }))
      // 이어보기: open the most recently read chapter instead of the first.
      const st = useStore.getState()
      const lastUrl = st.settings.resumeReading !== false ? lastReadKey(st.readProgress, chapters.map((c) => c.url)) : null
      const first = chapters.find((c) => c.url === lastUrl) ?? chapters[0]
      const payload = {
        code: first.url,
        title: seriesTitle || g.title,
        artist: author ?? g.artist,
        seriesUrl: g.url,
        chapterLabel: first.title,
        thumb: g.thumb
      }
      if (target === 'glance') openGlance({ online: { ...payload, kind: 'comic' } })
      else if (target === 'background') openComicBackground(payload)
      else openComic(payload)
    } catch (e: any) {
      alert(String(e?.message ?? e))
    } finally {
      setOpening(null)
    }
  }

  // Phone tools: pull-to-refresh / + 새로고침 (page 1, fresh fetch) and
  // 작품 선택 (download the picked series, one after another).
  const browseView = useStore((s) => s.view === 'browse')
  // Android back: an open filter dropdown, then the 즐겨찾기 view, then the
  // search / genre / day / platform filters → the full online list first.
  const thisMode = useStore((s) => (s.libraryMode === 'normal') === true)
  const filtered = !!source.query || (source.genre ?? '전체') !== '전체' || !!source.cat || !!source.day || !!source.plat
  useBackHandler(browseView && thisMode && (!!filterOpen || favMode || filtered), () => {
    if (filterOpen) return setFilterOpen(null)
    if (favMode) return setFavMode(false)
    setQuery('')
    setGenre('전체')
    setCat('')
    setDay('')
    setPlat('')
    applySource({ genre: '전체', cat: undefined, day: undefined, plat: undefined, query: undefined })
  })
  const sel = useSelection()
  const refresh = (): Promise<void> =>
    new Promise((res) => {
      refreshWaiters.current.push(res)
      if (rootRef.current) rootRef.current.scrollTop = 0
      setPage(0)
      setReloadKey((k) => k + 1)
      setTimeout(res, 30000) // never spin forever
    })
  const ptrSpinner = usePullRefresh(rootRef, refresh, browseView)
  // Swipe right → back to 라이브러리.
  useSwipeNav(rootRef, null, () => useStore.getState().goHome(), browseView && !sel.selecting)
  const startDownload = useStore((s) => s.startDownload)
  const downloadSelected = (): void => {
    const picked = gallery.filter((g) => sel.selected.has(g.url))
    sel.stop()
    void (async () => {
      for (const g of picked) await startDownload({ kind: 'comic', seriesUrl: g.url, title: g.title }).catch(() => null)
    })()
  }

  return (
    <div className="browse comic-browse" ref={rootRef} onClickCapture={sel.capture}>
      {ptrSpinner}
      {sel.selecting && (
        <SelectBar
          count={sel.selected.size}
          onAll={() => sel.setAll(gallery.map((g) => g.url))}
          onNone={sel.clear}
          onClose={sel.stop}
          action={
            <button className="sel-btn" title="다운로드" disabled={sel.selected.size === 0} onClick={downloadSelected}>
              <DownloadIcon />
            </button>
          }
        />
      )}
      <LibraryFab
        active={browseView && !sel.selecting}
        scrollRef={rootRef}
        onRefresh={() => void refresh()}
        onSelect={sel.start}
        pager={favMode ? undefined : { page, lastPage: -1, onPage: (p) => setPage(Math.max(0, p)) }}
      />
      <div className="browse-head">
        {/* Phone: full-width search box (Enter searches) — 제목/작가 filter icon
            at its left end, sort icon at its right end. */}
        <div className="search-row">
          <div className="search-ac has-leading has-trailing">
            <span className="search-leading">
              <Dropdown<'title' | 'author'>
                icon={<FilterAltIcon />}
                title="검색 대상"
                align="left"
                value={field}
                onChange={setField}
                options={[
                  ['title', '제목'],
                  ['author', '작가']
                ]}
              />
            </span>
            <input
              className="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder={field === 'author' ? '작가 검색' : '제목 검색'}
            />
            <SearchClear value={query} onClear={() => setQuery('')} />
            <span className="search-trailing">
              <Dropdown<ComicSort>
                icon={<SortIcon />}
                title="정렬"
                value={sort}
                onChange={(v) => {
                  setSort(v)
                  applySource({ sort: v })
                }}
                options={SORTS}
              />
            </span>
          </div>
        </div>

        <div className="chips">
          <BypassToggle onApplied={() => !favMode && setReloadKey((k) => k + 1)} />
          {TYPES.map(([v, l]) => (
            <button
              key={v}
              className={`chip ${type === v ? 'active' : ''}`}
              onClick={() => {
                setType(v)
                setGenre('전체')
                setCat('')
                setDay('')
                setPlat('')
                setFilterOpen(null)
                applySource({ type: v, genre: '전체', cat: undefined, day: undefined, plat: undefined })
              }}
            >
              {l}
            </button>
          ))}
          <button
            className={`chip ${favMode ? 'active' : ''}`}
            title="즐겨찾기"
            onClick={() => setFavMode((v) => !v)}
          >
            <FavoriteIcon filled className="fav-ico" /> 즐겨찾기 {favGalleries.length}
          </button>
          {favMode && <OnlineOnlyToggle />}
          {favMode && <FavSortSelect value={favSort} onChange={setFavSort} />}
          {/* Tablet: the site tools sit right in the row (CSS shows .tools-inline
              ≥ 600px and hides the chevron); phone: they fold out from it. */}
          <button className="chip tools-inline tools-first" onClick={() => window.api.comicOpenSite()}>
            인증창
          </button>
          <button
            className={`chip tools-inline ${addrOpen ? 'active' : ''}`}
            onClick={() => {
              setAddr(comicBaseUrl)
              setAddrOpen((v) => !v)
            }}
          >
            주소
          </button>
          <button className="chip tools-inline" onClick={() => setBackupOpen(true)}>
            비상용
          </button>
          {/* Site tools (인증창 / 주소 / 비상용) fold out from the chevron. */}
          <button
            className={`chip layout-toggle tools-toggle ${toolsOpen ? 'open' : ''}`}
            title={toolsOpen ? '접기' : '사이트 도구'}
            onClick={() => setToolsOpen((v) => !v)}
          >
            <ArrowDownIcon />
          </button>
        </div>
        {toolsOpen && (
          <div className="chips comic-tools">
            <button className="chip" onClick={() => window.api.comicOpenSite()}>
              인증창
            </button>
            <button
              className={`chip ${addrOpen ? 'active' : ''}`}
              onClick={() => {
                setAddr(comicBaseUrl)
                setAddrOpen((v) => !v)
              }}
            >
              주소
            </button>
            <button className="chip" onClick={() => setBackupOpen(true)}>
              비상용
            </button>
          </div>
        )}

        {addrOpen && (
          // Phone: the address box takes the row; flat text buttons below it.
          <div className="comic-addr">
            <input
              className="search"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveAddr()}
              placeholder="https://example.com (구조가 같은 미러 주소)"
              autoFocus
            />
            <span className="flat-group comic-addr-btns">
              <button className="btn primary" onClick={saveAddr}>
                저장 후 새로고침
              </button>
              <button className="btn" onClick={() => setAddrOpen(false)}>
                취소
              </button>
            </span>
          </div>
        )}

        {/* Filters fold into short buttons; one dropdown open at a time.
            만화: 장르. 웹툰: 분류 · 요일 · 장르 · 플랫폼. A set filter tints its button;
            the chosen values show as chips below. */}
        {!favMode && (
          <div className="flat-group filter-mores">
            {(type === 'webtoon'
              ? ([
                  ['cat', '분류', cat ? (CATS.find(([v]) => v === cat)?.[1] ?? '') : ''],
                  ['day', '요일', day ? `${day}요일` : ''],
                  ['genre', '장르', genreLabel],
                  ['plat', '플랫폼', plat ? (platforms.find((x) => x.id === plat)?.name ?? '') : '']
                ] as const)
              : ([['genre', '장르', genreLabel]] as const)
            ).map(([k, label, val]) => (
              <button
                key={k}
                className={`genre-more ${filterOpen === k ? 'open' : ''} ${val ? 'set' : ''}`}
                onClick={() => setFilterOpen((o) => (o === k ? null : k))}
              >
                <span>{label}</span>
                <ArrowDownIcon />
              </button>
            ))}
          </div>
        )}
        {!favMode && filterOpen === 'cat' && (
          <div className="genre-chips">
            {CATS.map(([v, l]) => (
              <span
                key={v || 'normal'}
                className={`tag ${cat === v ? 'fav-tag' : ''}`}
                onClick={() => {
                  setCat(v)
                  applySource({ cat: v || undefined })
                }}
              >
                {l}
              </span>
            ))}
          </div>
        )}
        {!favMode && filterOpen === 'day' && (
          <div className="genre-chips">
            {['', '월', '화', '수', '목', '금', '토', '일'].map((d) => (
              <span
                key={d || 'all'}
                className={`tag ${day === d ? 'fav-tag' : ''}`}
                onClick={() => {
                  setDay(d)
                  applySource({ day: d || undefined })
                }}
              >
                {d || '전체'}
              </span>
            ))}
          </div>
        )}
        {!favMode && filterOpen === 'plat' && (
          <div className="genre-chips">
            {[{ id: '', name: '전체' }, ...platforms].map((pl) => (
              <span
                key={pl.id || 'all'}
                className={`tag ${plat === pl.id ? 'fav-tag' : ''}`}
                onClick={() => {
                  setPlat(pl.id)
                  applySource({ plat: pl.id || undefined })
                }}
              >
                {pl.name}
              </span>
            ))}
            {platforms.length === 0 && <span className="hint">목록을 불러오면 플랫폼이 표시됩니다.</span>}
          </div>
        )}
        {!favMode && filterOpen === 'genre' && (
          <div className="genre-chips">
            {genres.map((g) => (
              <span
                key={g}
                className={`tag ${(g === '전체' ? !selGenres.length : selGenres.includes(g)) ? 'fav-tag' : ''} ${excludeGenres.includes(g) ? 'excluded' : ''}`}
                title={g === '전체' ? undefined : excludeGenres.includes(g) ? '우클릭: 제외 해제' : '클릭: 선택 / 해제 (여러 개) · 우클릭: 이 장르 제외'}
                onClick={() => toggleGenre(g)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (g !== '전체') toggleExclude(g)
                }}
              >
                {g}
              </span>
            ))}
            {excludeGenres.length > 0 && (
              <span className="genre-ex-info">
                제외 {excludeGenres.length}개
                {items.length > shownItems.length && ` · 이 쪽에서 ${items.length - shownItems.length}개 숨김`}
                <span
                  className="mini"
                  onClick={() => {
                    const s = { ...useStore.getState().settings, comicExcludeGenres: [] }
                    useStore.setState({ settings: s })
                    void window.api.saveSettings(s)
                  }}
                >
                  해제
                </span>
              </span>
            )}
          </div>
        )}
        {/* Chosen filters as removable chips (like the doujin search tokens). */}
        {!favMode && (selGenres.length > 0 || (type === 'webtoon' && (cat || day || plat))) && (
          <div className="search-chips">
            {type === 'webtoon' && cat && (
              <button className="chip active search-tok" title="필터에서 제거" onClick={() => (setCat(''), applySource({ cat: undefined }))}>
                {CATS.find(([v]) => v === cat)?.[1]} ✕
              </button>
            )}
            {type === 'webtoon' && day && (
              <button className="chip active search-tok" title="필터에서 제거" onClick={() => (setDay(''), applySource({ day: undefined }))}>
                {day}요일 ✕
              </button>
            )}
            {selGenres.map((g) => (
              <button key={g} className="chip active search-tok" title="필터에서 제거" onClick={() => toggleGenre(g)}>
                {g} ✕
              </button>
            ))}
            {type === 'webtoon' && plat && (
              <button className="chip active search-tok" title="필터에서 제거" onClick={() => (setPlat(''), applySource({ plat: undefined }))}>
                {platforms.find((x) => x.id === plat)?.name ?? '플랫폼'} ✕
              </button>
            )}
          </div>
        )}
      </div>

      {error && !favMode && <div className="warn err">{error} — 설정의 온라인 주소를 확인하세요.</div>}
      {loading && !favMode && <div className="reader-loading">{comicStatus ?? '불러오는 중…'}</div>}
      {favMode && gallery.length === 0 && (
        <div className="empty">즐겨찾기한 일반 만화 온라인 작품이 없습니다.</div>
      )}
      {!loading && !error && !favMode && items.length === 0 && (
        <div className="empty">결과가 없습니다. (사이트 구조/주소가 다를 수 있음)</div>
      )}

      <div className="browse-grid">
        {gallery.map((g) => {
          const f = onlineFavs[g.url]
          const artist = authors[g.url] ?? g.artist
          return (
            <div
              key={g.url}
              className={`gcard${sel.selecting ? (sel.selected.has(g.url) ? ' sel-mode sel-on' : ' sel-mode') : ''}`}
              data-sel={g.url}
              onContextMenu={(e) => {
                e.preventDefault()
                setCardMenu({ x: e.clientX, y: e.clientY, g })
              }}
              // Alt+click anywhere on the card → Glance (capture beats children).
              onClickCapture={(e) => {
                if (window.getSelection()?.toString()) return e.stopPropagation()
                if (e.altKey) {
                  e.preventDefault()
                  e.stopPropagation()
                  void openSeries(g, 'glance')
                }
              }}
            >
              {sel.selecting && <SelBox on={sel.selected.has(g.url)} />}
              {/* Phone grid: cover left, text right, favorite | rating | download bar. */}
              <div className="tile-body">
                <div
                  className="gcard-thumb-wrap"
                  onClick={() => openSeries(g)}
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault() // block middle-click autoscroll
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault()
                      void openSeries(g, 'background')
                    }
                  }}
                >
                  <OnlineThumb
                    thumbUrl={g.thumb}
                    localWorkId={localSeries.get(titleKey(g.title))?.repId || undefined}
                  >
                    {opening === g.url && <div className="gcard-loading">여는 중…</div>}
                  </OnlineThumb>
                </div>
                <div className="tile-info" onClick={() => openSeries(g)}>
                  <div className="gcard-title selectable">{g.title}</div>
                  <div className="gcard-meta">
                    {g.chapter && <span>{g.chapter}</span>}
                    {g.genre && <div className="gcard-genre">{g.genre}</div>}
                  </div>
                  {artist && (
                    <MoreClamp className="gcard-meta gcard-artist-line">
                      <ArtistLinks artist={artist} onPick={(a) => searchAuthor(a)} onMenu={() => {}} />
                    </MoreClamp>
                  )}
                </div>
              </div>
              <TileBar
                fav={
                  <span
                    className={`seg-heart ${isFavTitle(g) ? 'on' : ''}`}
                    title="즐겨찾기"
                    onClick={() =>
                      void toggleNormalUnifiedFav({
                        title: g.title,
                        url: g.url.startsWith('local:') ? undefined : g.url,
                        meta: favMeta(g, artist)
                      })
                    }
                  >
                    <FavoriteIcon filled={isFavTitle(g)} />
                  </span>
                }
                rating={<Stars rank={f?.rank ?? 0} onChange={(r) => setOnlineRank(g.url, r, favMeta(g, artist))} />}
                action={
                  <span className="seg-dl" title="다운로드" onClick={() => setDlSeries({ url: g.url, title: g.title })}>
                    <DownloadIcon />
                  </span>
                }
              />
            </div>
          )
        })}
      </div>

      {!favMode && (
        // Total page count isn't exposed by the site → no "/ N"; type any page
        // and Enter (overshooting lands on the last page).
        <Pager page={page} lastPage={-1} hasNext={hasNext} onPage={(p) => setPage(Math.max(0, p))} />
      )}

      {dlSeries && <ComicDownloadModal series={dlSeries} onClose={() => setDlSeries(null)} />}
      {backupOpen && <ComicBackupModal onClose={() => setBackupOpen(false)} />}
      {cardMenu && (
        <ContextMenu
          x={cardMenu.x}
          y={cardMenu.y}
          items={[
            { label: '새 탭에서 열기', onClick: () => void openSeries(cardMenu.g) },
            { label: '백그라운드에서 열기', onClick: () => void openSeries(cardMenu.g, 'background') },
            { label: '제목 복사', onClick: () => void window.api.clipboardWriteText(cardMenu.g.title) }
          ]}
          onClose={() => setCardMenu(null)}
        />
      )}
    </div>
  )
}
