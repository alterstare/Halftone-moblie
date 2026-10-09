import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore, useSeriesRoots } from '../store'
import { selectWorks, SORT_LABELS, groupSeries, matchesSearch, tagTokens, tokenLabel, analyzeSeries, CHAP_FAV_PREFIX, FAV_BASE, titleKey, type SeriesGroup, isComicCode, sortSeries } from '../util'
import type { SortMode, OnlineFav, Work } from '../../../shared/types'
import type { Filter } from '../store'
import { langCategory, LANG_CAT_LABELS, type LangCat } from '../../../shared/lang'
import Caret from './Caret'
import { GridIcon, MenuIcon, FavoriteIcon, AddIcon, CloseIcon, SortIcon, DeleteIcon, MergeTypeIcon } from './icons'
import { mergeWorks, canMerge } from '../merge'
import { useSelection, SelectionProvider, SelectBar, usePullRefresh, LibraryFab, useSwipeNav } from './libraryTools'
import Dropdown from './Dropdown'
import WorkGridCard from './WorkGridCard'
import SeriesGridCard from './SeriesGridCard'
import OnlineFavCard from './OnlineFavCard'
import FavDlToggle, { FavSortSelect } from './FavDlToggle'
import TagSearchInput from './TagSearchInput'
import Pager from './Pager'
import ConfirmModal, { DelTitle } from './ConfirmModal'
import { mergeFavorites, type FavEntry } from '../favorites'
import GroupName from './GroupName'
import { useLock } from '../lock'
import { getFavSummary, useFavSummaries } from '../favSummaries'

export default function Home(): JSX.Element {
  const works = useStore((s) => s.works)
  const libraryMode = useStore((s) => s.libraryMode)
  const settings = useStore((s) => s.settings)
  const search = useStore((s) => s.search)
  const sort = useStore((s) => s.sort)
  const sortDir = useStore((s) => s.sortDir)
  const toggleSortDir = useStore((s) => s.toggleSortDir)
  const filter = useStore((s) => s.filter)
  const seed = useStore((s) => s.randomSeed)
  const loading = useStore((s) => s.loading)
  const setSearch = useStore((s) => s.setSearch)
  const setSort = useStore((s) => s.setSort)
  const setFilter = useStore((s) => s.setFilter)
  const reshuffle = useStore((s) => s.reshuffle)
  const homeLayout = useStore((s) => s.homeLayout)
  const setHomeLayout = useStore((s) => s.setHomeLayout)
  const onlineFavs = useStore((s) => s.onlineFavs)
  // 기록 view: the library screen listing only what was viewed (local works by
  // lastViewedAt + online works from the history), newest first.
  const history = useStore((s) => s.view === 'history')
  const onlineHistory = useStore((s) => s.onlineHistory)
  const favDownloadedOnly = useStore((s) => s.favDownloadedOnly)
  const setFavDownloadedOnly = useStore((s) => s.setFavDownloadedOnly)
  const popularRanks = useStore((s) => s.popularRanks)
  const setPopularRanks = useStore((s) => s.setPopularRanks)
  const showCoded = useStore((s) => s.showCoded)
  const showUncoded = useStore((s) => s.showUncoded)
  const setShowCoded = useStore((s) => s.setShowCoded)
  const setShowUncoded = useStore((s) => s.setShowUncoded)
  const langFilter = useStore((s) => s.langFilter)
  const setLangFilter = useStore((s) => s.setLangFilter)
  const groups = useStore((s) => s.settings.groups)
  const groupFilter = useStore((s) => s.groupFilter)
  const showUngrouped = useStore((s) => s.showUngrouped)
  const setGroupFilter = useStore((s) => s.setGroupFilter)
  const setShowUngrouped = useStore((s) => s.setShowUngrouped)
  const createGroup = useStore((s) => s.createGroup)
  const deleteGroup = useStore((s) => s.deleteGroup)
  const homeTopNonce = useStore((s) => s.homeTopNonce)
  const scrollRef = useRef<HTMLDivElement>(null)
  const mountNonce = useRef(homeTopNonce)
  const [delGroup, setDelGroup] = useState<{ id: string; name: string } | null>(null)

  // Restore the previous home scroll position on mount; save it continuously so
  // returning to the library lands where the user left off. 홈 pressed while
  // already home bumps homeTopNonce → jump to the top (but not on mount).
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = useStore.getState().homeScroll
  }, [])
  useEffect(() => {
    if (homeTopNonce === mountNonce.current) return
    // Returning to the initial screen (홈 pressed while already home): clear the
    // search + tag/artist filter, but KEEP the chosen sort. Then first page/top.
    setQuery('')
    setSearch('')
    setFilter({ kind: 'all' })
    setPage(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeTopNonce])

  const [progress, setProgress] = useState<{ scanned: number; current: string } | null>(null)
  const [organizeProg, setOrganizeProg] = useState<{ moved: number; current: string } | null>(null)
  const [enrichProg, setEnrichProg] = useState<{ done: number; total: number } | null>(null)
  const [query, setQuery] = useState(search) // pending search text (applied on Enter/button)
  // Individual chips for the active search's tokens (comma-separated), shown above
  // the list. Removing a chip re-runs the search without it.
  const searchTokens = search.split(',').map((s) => s.trim()).filter(Boolean)
  const removeSearchToken = (tok: string): void => {
    const q = searchTokens.filter((t) => t !== tok).join(', ')
    setQuery(q)
    setSearch(q)
  }
  // A tag clicked on a work card is appended to the search box (not searched
  // immediately), like the online browse. Consumes the store seed on change.
  const searchSeed = useStore((s) => s.searchSeed)
  useEffect(() => {
    if (!searchSeed) return
    setQuery((cur) => {
      const toks = cur.split(',').map((s) => s.trim()).filter(Boolean)
      return toks.includes(searchSeed.tok) ? cur : [...toks, searchSeed.tok].join(', ') + ', '
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchSeed?.nonce])
  // Only one classification panel (작품/언어/그룹 분류) open at a time — opening
  // one collapses whichever was open.
  const [openPanel, setOpenPanel] = useState<'cat' | 'lang' | 'group' | 'fav' | null>(null)
  // 분류 popup (작품 / 언어 / 그룹 분류 together), opened by the + chip.
  const [classOpen, setClassOpen] = useState(false)
  const togglePanel = (p: 'cat' | 'lang' | 'group' | 'fav'): void =>
    setOpenPanel((cur) => (cur === p ? null : p))
  // Favorite lists the user has UNchecked in the drawer (all checked by default).
  const [favUnchecked, setFavUnchecked] = useState<string[]>([])
  // Favorites-view sort (mirrors the online favorites): 평점 높은순 / 최근 추가순.
  // Lives in the store so it survives Home unmount/remount (opening a work).
  const favSort = useStore((s) => s.favSort)
  const setFavSort = useStore((s) => s.setFavSort)
  const [newGroup, setNewGroup] = useState('')
  const submitNewGroup = async (): Promise<void> => {
    if (!newGroup.trim()) return
    await createGroup(newGroup)
    setNewGroup('')
  }
  const [loadingPopular, setLoadingPopular] = useState(false)

  // Load site popularity ranks the first time the user sorts by 인기순.
  useEffect(() => {
    if (sort !== 'popular' || popularRanks) return
    const codes = works.filter((w) => w.code).map((w) => w.code!)
    if (!codes.length) return
    setLoadingPopular(true)
    window.api
      .doujinPopularRanks(codes)
      .then(setPopularRanks)
      .finally(() => setLoadingPopular(false))
  }, [sort, popularRanks, works])

  useEffect(() => {
    return window.api.onScanProgress((p) => {
      if (p.done) setProgress(null)
      else setProgress({ scanned: p.scanned, current: p.current })
    })
  }, [])

  useEffect(() => {
    return window.api.onOrganizeProgress((p) => {
      if (p.done) setOrganizeProg(null)
      else setOrganizeProg({ moved: p.moved, current: p.current })
    })
  }, [])

  useEffect(() => {
    return window.api.onDoujinProgress((p) => {
      if (p.phase === 'enriching') setEnrichProg({ done: p.done, total: p.total })
      else if (p.phase === 'done') setEnrichProg(null)
    })
  }, [])

  // Only the current library's works (doujin vs general manga).
  const modeWorks = useMemo(
    () => works.filter((w) => (w.library ?? 'doujin') === libraryMode),
    [works, libraryMode]
  )
  // Tag autocomplete for the search box (replaces the old tag-builder row).
  const libTokens = useMemo(() => tagTokens(modeWorks), [modeWorks])

  // Groups are scoped per library mode.
  const modeGroups = useMemo(
    () => groups.filter((g) => (g.mode ?? 'doujin') === libraryMode),
    [groups, libraryMode]
  )

  // Category filter: choose whether coded / uncoded works appear, and which
  // languages. Works with unknown (null) language always pass the language gate.
  const allLang = langFilter.korean && langFilter.english && langFilter.japanese && langFilter.other
  const allGroups = modeGroups.every((g) => groupFilter[g.id] !== false) && showUngrouped
  const categoryWorks = useMemo(
    () =>
      modeWorks.filter((w) => {
        // Normal mode hides the coded/language chips → don't let their state filter.
        if (libraryMode !== 'normal') {
          if (!(w.code ? showCoded : showUncoded)) return false
          const lc = langCategory(w.language)
          if (lc !== null && !langFilter[lc]) return false
        }
        const gids = w.groups ?? []
        if (gids.length === 0) return showUngrouped
        return gids.some((id) => groupFilter[id] !== false)
      }),
    [modeWorks, showCoded, showUncoded, langFilter, groupFilter, showUngrouped, libraryMode]
  )

  const favActive = filter.kind === 'favorites' || filter.kind === 'favlists'
  // General-manga: online (manga-site) favorites by normalized title — a local series
  // with the same title is the same favorite (one unified list).
  const onlineNormalFavKeys = useMemo(
    () =>
      new Set(
        Object.values(onlineFavs)
          .filter((f) => f.favorite && isComicCode(f.code))
          .map((f) => titleKey(f.title))
          .filter(Boolean)
      ),
    [onlineFavs]
  )
  const list = useMemo(() => {
    // In the favorites view, the dedicated 평점/최근 sort overrides the main sort.
    const effSort = favActive ? (favSort === 'rank' ? 'rank' : 'recent') : sort
    let base = selectWorks(
      categoryWorks,
      search,
      filter,
      effSort,
      seed,
      settings.ignoreBracketTagsInSort,
      popularRanks ?? undefined
    )
    // Unified favorites: also include downloaded works that are ONLINE favorites
    // even if they were never hearted locally (so a fav is a fav everywhere).
    if (favActive && filter.kind === 'favorites') {
      const onlineCodes = new Set(
        Object.values(onlineFavs)
          .filter((f) => f.favorite && !isComicCode(f.code))
          .map((f) => f.code)
      )
      const have = new Set(base.map((w) => w.id))
      const extra = categoryWorks.filter((w) => w.code && onlineCodes.has(w.code) && !have.has(w.id))
      if (extra.length) base = [...base, ...extra]
    }
    if (favActive || sortDir !== 'asc') return base
    const r = [...base].reverse()
    // Keep artist-less works last regardless of direction.
    if (sort === 'artist') return [...r.filter((w) => w.artist?.trim()), ...r.filter((w) => !w.artist?.trim())]
    return r
  }, [categoryWorks, search, filter, favActive, favSort, sort, sortDir, seed, settings.ignoreBracketTagsInSort, popularRanks, onlineFavs])

  // Normal mode: collapse chapters into one entry per series.
  const normal = libraryMode === 'normal'
  const normalRoots = useSeriesRoots()
  // Whole-mode series count (ignores the fav filter) for the 전체 chip.
  const seriesTotal = useMemo(
    () => (normal ? groupSeries(modeWorks, normalRoots).length : 0),
    [normal, modeWorks, normalRoots]
  )
  const seriesList = useMemo(() => {
    if (!normal) return []
    let arr = groupSeries(categoryWorks, normalRoots)
    const q = search.trim()
    if (q) {
      const ql = q.toLowerCase()
      arr = arr.filter((s) => s.title.toLowerCase().includes(ql) || s.chapters.some((c) => matchesSearch(c, q)))
    }
    // Favorites view (normal): in-app favorites — favorited SERIES as their group,
    // plus chapters favorited on their own as single-chapter entries that open the
    // chapter directly. No dependence on the folder-move/favlist system.
    if (favActive) {
      const favS = settings.normalFavSeries ?? []
      const favC = settings.normalFavChapters ?? []
      const favGroups = arr.filter((s) => favS.includes(s.key) || onlineNormalFavKeys.has(titleKey(s.title)))
      const covered = new Set(favGroups.flatMap((s) => s.chapters.map((c) => c.id)))
      const chapEntries: SeriesGroup[] = []
      for (const s of arr) {
        if (favGroups.includes(s)) continue
        const infos = analyzeSeries(s.chapters, s.title, settings.normalChapterScheme)
        for (const ci of infos) {
          if (!favC.includes(ci.work.id) || covered.has(ci.work.id)) continue
          covered.add(ci.work.id)
          chapEntries.push({
            key: CHAP_FAV_PREFIX + ci.work.id,
            title: `${s.title} · ${ci.label}`,
            chapters: [ci.work]
          })
        }
      }
      arr = [...favGroups, ...chapEntries]
    }
    return sortSeries(arr, sort, sortDir)
  }, [
    normal,
    categoryWorks,
    normalRoots,
    favActive,
    search,
    sort,
    sortDir,
    settings.normalChapterScheme,
    settings.normalFavSeries,
    settings.normalFavChapters,
    onlineNormalFavKeys
  ])

  // Title keys of every local general-manga series, to drop online (manga-site)
  // favorites that are already downloaded.
  const localSeriesKeys = useMemo(
    () => (normal ? new Set(groupSeries(modeWorks, normalRoots).map((g) => titleKey(g.title))) : new Set<string>()),
    [normal, modeWorks, normalRoots]
  )
  // Unified favorites view: online favorites NOT in the library show as online
  // cards next to the local ones ("다운로드한 것만" toggle hides them). Per mode:
  // doujin = numeric codes, general manga = manga-site urls (matched by title).
  const onlineOnlyFavs = useMemo(() => {
    if (!favActive || favDownloadedOnly) return []
    // Only with 기본 (the hearts) checked — imported lists show downloaded works only.
    if (filter.kind === 'favlists' && !filter.value.includes(FAV_BASE)) return []
    const libCodes = new Set(works.map((w) => w.code).filter(Boolean) as string[])
    return Object.values(onlineFavs)
      .filter(
        (f) =>
          f.favorite &&
          isComicCode(f.code) === normal &&
          !libCodes.has(f.code) &&
          !(normal && localSeriesKeys.has(titleKey(f.title)))
      )
      .sort((a, b) => (favSort === 'rank' ? b.rank - a.rank || b.addedAt - a.addedAt : b.addedAt - a.addedAt))
  }, [favActive, favDownloadedOnly, filter, onlineFavs, works, normal, favSort, localSeriesKeys])
  // One merged favorites list (local works / series + online-only), sorted
  // together by favorite time (최근 추가순) or rating (평점 높은순), then paged.
  const favMerged = useMemo(
    () =>
      favActive
        ? mergeFavorites({ normal, works: list, series: seriesList, onlineOnly: onlineOnlyFavs, onlineFavs, normalFavAt: settings.normalFavAt ?? {}, sort: favSort })
        : null,
    [favActive, normal, list, seriesList, onlineOnlyFavs, onlineFavs, favSort, settings.normalFavAt]
  )

  // Doujin online history entries without a stored cover → fetch their summaries.
  const sumVer = useFavSummaries(
    history && !normal ? Object.values(onlineHistory).filter((e) => e.kind === 'doujin' && !e.thumbUrl).map((e) => e.key) : []
  )
  // 기록: viewed local works / series + online history entries (not in the
  // library), one list newest-first. Search / filters narrow the local part
  // like the library; online entries follow the 즐겨찾기 filter and plain-word
  // search on title / artist.
  const historyMerged = useMemo<FavEntry[] | null>(() => {
    if (!history) return null
    const out: FavEntry[] = []
    if (!normal) {
      for (const w of list) if (w.lastViewedAt) out.push({ kind: 'local', work: w, t: w.lastViewedAt, r: w.rank })
    } else {
      for (const sg of seriesList) {
        const t = Math.max(0, ...sg.chapters.map((c) => c.lastViewedAt ?? 0))
        if (t) out.push({ kind: 'series', series: sg, t, r: Math.max(0, ...sg.chapters.map((c) => c.rank)) })
      }
    }
    const libCodes = new Set(works.map((w) => w.code).filter(Boolean) as string[])
    const words = search
      .toLowerCase()
      .split(/[\s,]+/)
      .filter((w) => w && !w.includes(':'))
    for (const e of Object.values(onlineHistory)) {
      if ((e.kind === 'comic') !== normal) continue
      if (normal ? localSeriesKeys.has(titleKey(e.title)) : libCodes.has(e.code)) continue
      const f = onlineFavs[e.key]
      if (filter.kind === 'favorites' && !f?.favorite) continue
      if (filter.kind !== 'all' && filter.kind !== 'favorites') continue
      const hay = `${e.title} ${e.artist ?? ''}`.toLowerCase()
      if (words.some((w) => !hay.includes(w))) continue
      const fav: OnlineFav = {
        code: e.key,
        favorite: !!f?.favorite,
        rank: f?.rank ?? 0,
        title: e.title,
        artist: e.artist,
        language: e.language,
        pageCount: e.pageCount,
        thumbUrl: e.thumbUrl ?? getFavSummary(e.key)?.thumbUrl ?? null,
        addedAt: e.at
      }
      out.push({ kind: 'online', fav, t: e.at, r: fav.rank })
    }
    out.sort((a, b) => b.t - a.t)
    return out
  }, [history, normal, list, seriesList, works, search, onlineHistory, onlineFavs, filter, localSeriesKeys, sumVer])
  const merged = historyMerged ?? favMerged

  const pageSize = settings.pageSize || 50
  const [page, setPage] = useState(() => useStore.getState().homePage)
  const total = merged ? merged.length : normal ? seriesList.length : list.length
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1)
  // Persist the current page so returning to home restores it (with the scroll).
  useEffect(() => useStore.getState().setHomePage(page), [page])
  // Any list-level action (search / filter chip / sort / mode switch / layout /
  // page move) collapses an open classification panel. Panel-internal toggles
  // (language/coded/group checkboxes) aren't in the deps, so adjusting them keeps
  // the panel open.
  useEffect(() => {
    setOpenPanel(null)
  }, [search, filter, sort, libraryMode, homeLayout, page])
  // Click anywhere outside a classification panel (empty space or any other
  // control) collapses it. Clicks inside the panel/its chip stay open, so
  // adjusting the checkboxes doesn't dismiss it.
  useEffect(() => {
    if (!openPanel) return
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.cat-wrap')) setOpenPanel(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openPanel])
  // Reset to first page (top) only when the user changes the query/filter/sort —
  // never on mount/remount, and never when works count changes (delete/scan), so
  // the scroll+page stay put. Keyed on the filter signature; a ref guards the
  // first run and StrictMode's double-invoke, both of which see an unchanged key.
  const resetKey = JSON.stringify([search, filter, sort, seed, libraryMode, history])
  const prevKey = useRef<string | null>(null)
  useEffect(() => {
    if (prevKey.current === null || prevKey.current === resetKey) {
      prevKey.current = resetKey
      return
    }
    prevKey.current = resetKey
    setPage(0)
    useStore.getState().setHomeScroll(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [resetKey])
  // Clamp a restored page that no longer exists (data shrank while away).
  useEffect(() => {
    if (page > lastPage) setPage(lastPage)
  }, [lastPage, page])
  // The current page as card entries: the merged favorites list, or plain
  // series (general manga) / works (doujin).
  const pageEntries = useMemo<FavEntry[]>(() => {
    const at = page * pageSize
    if (merged) return merged.slice(at, at + pageSize)
    if (normal) return seriesList.slice(at, at + pageSize).map((series) => ({ kind: 'series', series, t: 0, r: 0 }))
    return list.slice(at, at + pageSize).map((work) => ({ kind: 'local', work, t: 0, r: 0 }))
  }, [merged, normal, seriesList, list, page, pageSize])

  // Favorites drawer: 기본 (the hearts) + imported favorite lists (gallery
  // codes — doujin only). All checked by default; `favUnchecked` tracks the
  // ones the user turned off, so a newly imported list shows up checked.
  const decoy = useLock((s) => s.decoy)
  const favLists = useMemo(
    () => (libraryMode === 'doujin' && !decoy ? (settings.onlineFavLists ?? []) : []),
    [settings.onlineFavLists, libraryMode, decoy]
  )
  const allFavNames = useMemo(() => [FAV_BASE, ...favLists.map((l) => l.name)], [favLists])
  const favSelected = useMemo(
    () => allFavNames.filter((n) => !favUnchecked.includes(n)),
    [allFavNames, favUnchecked]
  )
  // Filter for a drawer selection: just the hearts when there are no lists,
  // else the checked names + the union of the checked lists' codes.
  const favFilterFor = (sel: string[]): Filter =>
    favLists.length === 0 && sel.includes(FAV_BASE)
      ? { kind: 'favorites' }
      : { kind: 'favlists', value: sel, codes: favLists.filter((l) => sel.includes(l.name)).flatMap((l) => l.codes) }
  // Count reflects the checked selection (updates as lists are toggled). Normal
  // mode counts its in-app favorites (series + standalone chapters) instead.
  // Unified favorite count: local + online favorites, each favorite counted once.
  const favCount = useMemo(() => {
    if (normal) {
      const favS = settings.normalFavSeries ?? []
      const keys = new Set(onlineNormalFavKeys)
      for (const g of groupSeries(modeWorks, normalRoots)) if (favS.includes(g.key)) keys.add(titleKey(g.title))
      return keys.size + (settings.normalFavChapters?.length ?? 0)
    }
    // Hearts (list entries + uncoded local hearts) plus checked lists' downloaded works.
    const base = favSelected.includes(FAV_BASE)
    const codes = new Set(favLists.filter((l) => favSelected.includes(l.name)).flatMap((l) => l.codes))
    const ids = new Set<string>()
    for (const w of modeWorks) if ((base && w.favorite) || (w.code && codes.has(w.code))) ids.add(w.code ?? w.id)
    if (base) for (const f of Object.values(onlineFavs)) if (f.favorite && !isComicCode(f.code)) ids.add(f.code)
    return ids.size
  }, [normal, modeWorks, normalRoots, favSelected, favLists, onlineFavs, onlineNormalFavKeys, settings.normalFavSeries, settings.normalFavChapters])
  const groupCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const w of modeWorks) for (const id of w.groups ?? []) m[id] = (m[id] ?? 0) + 1
    return m
  }, [modeWorks])

  // Phone tools: pull-to-refresh / + 새로고침 (page 1 + library rescan) and
  // 작품 선택 (delete the picked local works).
  const homeView = useStore((s) => s.view === 'home' || s.view === 'history')
  const sel = useSelection()
  const [delSel, setDelSel] = useState<string[] | null>(null)
  useEffect(() => {
    if (!sel.selecting) setDelSel(null) // selection ended (×, back) → drop the pending confirm
  }, [sel.selecting])
  const refresh = async (): Promise<void> => {
    setPage(0)
    useStore.getState().setHomeScroll(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    await useStore.getState().scanLibraryJob()
  }
  const pager = {
    page,
    lastPage,
    onPage: (p: number): void => {
      setPage(p)
      useStore.getState().setHomeScroll(0)
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    }
  }
  const ptrSpinner = usePullRefresh(scrollRef, refresh, homeView, pager)
  // Swipe left → 온라인 (the library screen only, not 기록 / while selecting).
  const onHome = useStore((s) => s.view === 'home')
  useSwipeNav(scrollRef, () => !decoy && useStore.getState().goBrowse(), null, onHome && !sel.selecting)
  const entryKey = (e: FavEntry): string => (e.kind === 'local' ? e.work.id : e.kind === 'series' ? e.series.key : e.fav.code)
  // Selected keys → local work ids (a series = all its chapters; online-only
  // entries have nothing to delete).
  const selWorkIds = (): string[] => {
    const ids: string[] = []
    const byId = new Set(works.map((w) => w.id))
    const series = new Map(seriesList.map((g) => [g.key, g]))
    for (const k of sel.selected) {
      if (byId.has(k)) ids.push(k)
      else series.get(k)?.chapters.forEach((c) => ids.push(c.id))
    }
    return ids
  }
  // 작품 통합: pick → name dialog (prefilled with the first pick's title) → merge.
  const [mergeAsk, setMergeAsk] = useState<{ works: Work[]; name: string } | null>(null)
  useEffect(() => {
    if (!sel.selecting) setMergeAsk(null)
  }, [sel.selecting])
  const mergeSelected = (): void => {
    const byId = new Map(works.map((w) => [w.id, w]))
    const picked = selWorkIds().flatMap((id) => byId.get(id) ?? [])
    if (canMerge(picked)) setMergeAsk({ works: picked, name: picked[0].title })
  }
  const confirmMerge = async (): Promise<void> => {
    const m = mergeAsk
    if (!m || !m.name.trim()) return
    setMergeAsk(null)
    if (await mergeWorks(m.works, m.name)) sel.stop()
  }
  const deleteSelected = async (ids: string[]): Promise<void> => {
    setDelSel(null)
    for (const id of ids) {
      await window.api.deleteWork(id)
      useStore.getState().removeWork(id)
    }
    sel.stop()
  }

  // Extra toolbar controls (즐겨찾기 view toggles, filter chips): phone = their
  // own row under the chips (the chips row never wraps); tablet = inline, the
  // row wraps only if they don't fit.
  const hasExtras = favActive || (sort === 'popular' && loadingPopular) || filter.kind === 'artist' || filter.kind === 'tag'
  const extras = (
    <>
      {favActive && (
        <FavDlToggle
          checked={favDownloadedOnly}
          onChange={setFavDownloadedOnly}
          onTitle="다운로드한 즐겨찾기만 보는 중"
          offTitle="모든 즐겨찾기 보는 중"
        />
      )}
      {favActive && <FavSortSelect value={favSort} onChange={setFavSort} />}
      {sort === 'popular' && loadingPopular && <span className="chip-stat">인기순 불러오는 중…</span>}
      {filter.kind === 'artist' && (
        <Chip active onClick={() => setFilter({ kind: 'all' })}>
          작가: {filter.value} ✕
        </Chip>
      )}
      {filter.kind === 'tag' && (
        <Chip active onClick={() => setFilter({ kind: 'all' })}>
          태그: {filter.value} ✕
        </Chip>
      )}
    </>
  )

  return (
    <div
      className="home"
      ref={scrollRef}
      onScroll={(e) => useStore.getState().setHomeScroll(e.currentTarget.scrollTop)}
      onClickCapture={sel.capture}
      style={{ ['--mw' as string]: `${settings.marginWidth}px` }}
    >
      {ptrSpinner}
      {sel.selecting && (
        <SelectBar
          count={sel.selected.size}
          onAll={() => sel.setAll(pageEntries.map(entryKey))}
          onNone={sel.clear}
          onClose={sel.stop}
          action={
            <>
              {/* 작품 통합: read the picked works as one (folders stay). */}
              <button
                className="sel-btn"
                title="작품 통합"
                disabled={sel.selected.size < 2}
                onClick={mergeSelected}
              >
                <MergeTypeIcon />
              </button>
              <button
                className="sel-btn"
                title="삭제"
                disabled={sel.selected.size === 0}
                onClick={() => {
                  const ids = selWorkIds()
                  if (ids.length) setDelSel(ids)
                }}
              >
                <DeleteIcon />
              </button>
            </>
          }
        />
      )}
      <LibraryFab
        active={homeView && !sel.selecting}
        scrollRef={scrollRef}
        onRefresh={() => void refresh()}
        onSelect={sel.start}
        pager={pager}
      />
      {mergeAsk && (
        <div className="exit-backdrop" onClick={() => setMergeAsk(null)}>
          <div className="exit-modal compact page-jump" onClick={(e) => e.stopPropagation()}>
            <h3 className="exit-title">
              작품 통합
              <span className="page-jump-info">{mergeAsk.works.length}개 작품을 하나로</span>
            </h3>
            <form
              className="page-jump-row merge-name-row"
              onSubmit={(e) => {
                e.preventDefault()
                void confirmMerge()
              }}
            >
              <input
                className="field-input"
                placeholder="통합 작품 이름"
                autoFocus
                value={mergeAsk.name}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setMergeAsk({ ...mergeAsk, name: e.target.value })}
              />
            </form>
            <div className="exit-actions">
              <button className="exit-btn ghost" onClick={() => setMergeAsk(null)}>
                취소
              </button>
              <button className="exit-btn primary" disabled={!mergeAsk.name.trim()} onClick={() => void confirmMerge()}>
                통합
              </button>
            </div>
          </div>
        </div>
      )}
      {delSel && (
        <ConfirmModal
          compact
          danger
          title={(() => {
            const w = works.find((x) => x.id === delSel[0])
            const name = w ? w.path.split(/[\/]/).filter(Boolean).pop() ?? w.title : ''
            return (
              <DelTitle
                name={name}
                rest={delSel.length === 1 ? '1개 삭제하시겠습니까?' : `외 ${delSel.length - 1}개 일괄 삭제하시겠습니까?`}
              />
            )
          })()}
          desc={<>선택한 작품의 폴더가 기기에서 삭제됩니다. 되돌릴 수 없습니다.</>}
          confirmLabel="삭제"
          onConfirm={() => void deleteSelected(delSel)}
          onCancel={() => setDelSel(null)}
        />
      )}
      <div className="home-head">
        {/* Phone: the search box takes the whole row (Enter on the keyboard
            searches); sort is the icon at its right end. Picking 무작위 again
            reshuffles. */}
        <div className="search-row">
          <TagSearchInput
            value={query}
            onChange={setQuery}
            onEnter={() => setSearch(query.trim())}
            tokens={libTokens}
            placeholder="검색"
            trailing={
              <Dropdown<SortMode>
                icon={<SortIcon />}
                title="정렬"
                value={sort}
                onChange={(m) => (m === 'random' && sort === 'random' ? reshuffle() : setSort(m))}
                options={(Object.keys(SORT_LABELS) as SortMode[])
                  .filter((m) => !(normal && m === 'popular'))
                  .map((m) => [m, SORT_LABELS[m]])}
              />
            }
          />
        </div>

        <div className="chips">
          <button
            className="chip layout-toggle"
            onClick={() => setHomeLayout(homeLayout === 'grid' ? 'list' : 'grid')}
            title={homeLayout === 'grid' ? '격자형' : '목록형'}
          >
            {homeLayout === 'grid' ? <GridIcon /> : <MenuIcon />}
          </button>
          <button
            className="chip layout-toggle"
            onClick={toggleSortDir}
            title={sortDir === 'asc' ? '오름차순' : '내림차순'}
          >
            <Caret up={sortDir === 'asc'} />
          </button>
          <Chip active={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>
            {history ? `기록 ${historyMerged?.length ?? 0}` : `전체 ${normal ? seriesTotal : modeWorks.length}`}
          </Chip>
          <div className="cat-wrap">
            <span
              className={`chip fav-chip ${filter.kind === 'favorites' || filter.kind === 'favlists' ? 'active' : ''}`}
            >
              <span
                className="fav-label"
                onClick={() => {
                  // Show everything: re-check all lists.
                  setFavUnchecked([])
                  setFilter(favFilterFor(allFavNames))
                }}
              >
                <FavoriteIcon filled className="fav-ico" /> 즐겨찾기 {favCount}
              </span>
              <span className="fav-caret" onClick={() => togglePanel('fav')} title="즐겨찾기 목록">
                <Caret up={openPanel === 'fav'} sm />
              </span>
            </span>
            {openPanel === 'fav' && (
              <div className="cat-panel">
                {allFavNames.map((n) => (
                  <label key={n}>
                    <input
                      type="checkbox"
                      checked={!favUnchecked.includes(n)}
                      onChange={() => {
                        const nextUnchecked = favUnchecked.includes(n)
                          ? favUnchecked.filter((x) => x !== n)
                          : [...favUnchecked, n]
                        setFavUnchecked(nextUnchecked)
                        const sel = allFavNames.filter((x) => !nextUnchecked.includes(x))
                        setFilter(favFilterFor(sel))
                      }}
                    />
                    ★ {n}
                  </label>
                ))}
              </div>
            )}
          </div>
          {hasExtras && <span className="chips-extra">{extras}</span>}
          {/* 분류 (작품 / 언어 / 그룹) in one popup; tinted while any filter is narrowed. */}
          <button
            className={`chip layout-toggle class-btn ${(!normal && (!(showCoded && showUncoded) || !allLang)) || !allGroups ? 'active' : ''}`}
            onClick={() => setClassOpen(true)}
            title="분류"
          >
            <AddIcon />
          </button>
        </div>
        {hasExtras && <div className="chips chips-extra-row">{extras}</div>}

        {searchTokens.length > 0 && (
          <div className="search-chips">
            {searchTokens.map((tok) => (
              <button
                key={tok}
                className="chip active search-tok"
                title="검색에서 제거"
                onClick={() => removeSearchToken(tok)}
              >
                {tokenLabel(tok)} ✕
              </button>
            ))}
          </div>
        )}

        {progress && (
          <div className="scan-progress">
            스캔 중… {progress.scanned}개 · {progress.current}
          </div>
        )}
        {enrichProg && (
          <div className="scan-progress">
            메타 채우는 중… {enrichProg.done}/{enrichProg.total}
          </div>
        )}
        {organizeProg && (
          <div className="scan-progress">
            언어 정리 중… {organizeProg.moved}개 이동 · {organizeProg.current}
          </div>
        )}
      </div>

      {classOpen && (
        <div className="modal-overlay" onClick={() => setClassOpen(false)}>
          <div className="modal class-modal" onClick={(e) => e.stopPropagation()}>
            <div className="class-modal-head">
              <b>분류</b>
              <button className="icon-close" onClick={() => setClassOpen(false)} title="닫기">
                <CloseIcon />
              </button>
            </div>
            {!normal && (
              <>
                <section className="class-sec">
                  <h3>작품 분류</h3>
                  <div className="cat-panel inline">
                      <label>
                        <input type="checkbox" checked={showCoded} onChange={(e) => setShowCoded(e.target.checked)} />
                        doujin 번호 작품
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showUncoded}
                          onChange={(e) => setShowUncoded(e.target.checked)}
                        />
                        번호 없는 작품
                      </label>
                  </div>
                </section>
                <section className="class-sec">
                  <h3>언어 분류</h3>
                  <div className="cat-panel inline">
                      {(['korean', 'english', 'japanese', 'other'] as LangCat[]).map((c) => (
                        <label key={c}>
                          <input
                            type="checkbox"
                            checked={langFilter[c]}
                            onChange={(e) => setLangFilter(c, e.target.checked)}
                          />
                          {LANG_CAT_LABELS[c]}
                        </label>
                      ))}
                  </div>
                </section>
              </>
            )}
            <section className="class-sec">
              <h3>그룹 분류</h3>
              <div className="cat-panel grp-panel inline">
                  {/* Bulk toggle: every group + "그룹 없음" on / off. */}
                  <div className="cat-panel-actions">
                    <button
                      className="mini"
                      onClick={() => {
                        modeGroups.forEach((g) => setGroupFilter(g.id, true))
                        setShowUngrouped(true)
                      }}
                    >
                      전체 선택
                    </button>
                    <button
                      className="mini"
                      onClick={() => {
                        modeGroups.forEach((g) => setGroupFilter(g.id, false))
                        setShowUngrouped(false)
                      }}
                    >
                      전체 선택 해제
                    </button>
                  </div>
                  {modeGroups.map((g) => (
                    <label key={g.id} className="grp-row">
                      <input
                        type="checkbox"
                        checked={groupFilter[g.id] !== false}
                        onChange={(e) => setGroupFilter(g.id, e.target.checked)}
                      />
                      <GroupName id={g.id} name={g.name} />
                      <span className="grp-row-count">({groupCounts[g.id] ?? 0})</span>
                      <span
                        className="grp-row-x"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setDelGroup({ id: g.id, name: g.name })
                        }}
                        title="그룹 삭제"
                      >
                        <CloseIcon />
                      </span>
                    </label>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={showUngrouped}
                      onChange={(e) => setShowUngrouped(e.target.checked)}
                    />
                    그룹 없음
                  </label>
                  <div className="grp-create">
                    <input
                      value={newGroup}
                      placeholder="새 그룹 이름"
                      onChange={(e) => setNewGroup(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submitNewGroup()}
                    />
                    <button className="mini icon" onClick={submitNewGroup} title="그룹 생성">
                      <AddIcon />
                    </button>
                  </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {modeWorks.length === 0 && !loading && (
        <div className="empty">
          {libraryMode === 'normal' ? (
            <>
              일반 만화 라이브러리가 비어 있습니다. <b>설정 ⚙</b>에서 <b>일반 만화 폴더</b>를 추가하고{' '}
              <b>라이브러리 스캔</b>을 누르세요.
            </>
          ) : (
            <>
              라이브러리가 비어 있습니다. <b>설정 ⚙</b>에서 폴더를 추가하고 <b>라이브러리 스캔</b>을
              누르세요.
            </>
          )}
        </div>
      )}

      {/* One card list for every view. Card type follows the entry kind; the
          container class follows the layout (+ series list styling in normal mode). */}
      <SelectionProvider value={sel.ctx}>
      {/* Phone: 목록형 = one wide card per row (cover + text, 더보기 preview);
          격자형 = 2-column compact cards. */}
      <div className={homeLayout === 'grid' ? 'work-grid compact-grid' : 'work-grid'}>
        {pageEntries.map((e) =>
          e.kind === 'local' ? (
            <WorkGridCard key={e.work.id} work={e.work} compact={homeLayout === 'grid'} />
          ) : e.kind === 'series' ? (
            <SeriesGridCard key={e.series.key} series={e.series} compact={homeLayout === 'grid'} />
          ) : (
            <OnlineFavCard key={e.fav.code} fav={e.fav} layout={homeLayout === 'grid' ? 'grid' : 'list'} />
          )
        )}
      </div>
      </SelectionProvider>

      {total > pageSize && (
        <Pager
          page={page}
          lastPage={lastPage}
          onPage={(p) => {
            setPage(p)
            useStore.getState().setHomeScroll(0)
            if (scrollRef.current) scrollRef.current.scrollTop = 0
          }}
        />
      )}
      <div className="result-count">
        {normal ? `${total}개 시리즈` : `${total}개 작품`} · {pageSize}개씩
      </div>

      {delGroup && (
        <ConfirmModal
          icon="🗑"
          danger
          title={`'${delGroup.name}' 그룹을 삭제하시겠습니까?`}
          desc={
            <>
              그룹이 사라지고, 속한 작품들은 그룹 폴더 밖으로 이동합니다. 작품 자체는 삭제되지
              않습니다.
            </>
          }
          confirmLabel="삭제"
          onConfirm={() => {
            const id = delGroup.id
            setDelGroup(null)
            deleteGroup(id)
          }}
          onCancel={() => setDelGroup(null)}
        />
      )}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button className={`chip ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}
