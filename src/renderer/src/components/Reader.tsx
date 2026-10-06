// One reader pane (a tab, or one side of a split tab) for a local work or an
// online gallery/chapter. Three modes:
//   scroll — virtualized vertical strip (only a window of pages is mounted;
//            spacers use measured / estimated page heights)
//   paged  — one page, click/keys/wheel to flip
//   spread — two pages side by side
// plus fit modes and Ctrl+wheel zoom (anchored at the cursor), page
// chapter navigation (general manga, local + manga-site) and
// continuous reading into the next/previous work of the left list.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore, useSeriesRoots } from '../store'
import { getImages, getOnlineImages } from '../images'
import { getComicChapters } from '../comic'
import { analyzeSeries, seriesOf } from '../util'
import type { ComicChapter } from '../../../shared/ipc'
import type { FitMode } from '../../../shared/types'
import { filterExcluded, getExcluded, hasExclusions } from '../exclude'
import PageImage from './PageImage'
import ContextMenu from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import { FIT_TEXT, FIT_ICON, FIT_ORDER, SCROLL_FIT_ORDER, fitStyle, fitHeight } from './reader/fit'
import { prefetchOrdered } from './reader/prefetch'
import PageSlot from './reader/PageSlot'
import { useComicStatus } from './useComicStatus'
import { comboFromEvent, shortcutCombos } from '../../../shared/shortcuts'
import {
  DownloadIcon,
  ScrollModeIcon,
  PageModeIcon,
  SpreadModeIcon,
  ArrowBackIcon,
  FavoriteIcon,
  CheckMarkIcon,
  LanguageIcon,
  MoreVertIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  TouchAppIcon
} from './icons'

// (tab, pane, work) combos whose view was already counted this session, so a
// re-render / remount of the same open work doesn't bump viewCount again.
const counted = new Set<string>()

export default function Reader({
  tabId,
  side = 'left'
}: {
  tabId: string
  side?: 'left' | 'right'
}): JSX.Element {
  const comicStatus = useComicStatus()
  const tab = useStore((s) => s.tabs.find((t) => t.id === tabId))
  // Which work/online this pane shows depends on the side of the (split) tab.
  const paneWorkId = side === 'right' ? tab?.rightWorkId : tab?.workId
  const paneOnline = side === 'right' ? tab?.rightOnline : tab?.online
  const savedScroll = (side === 'right' ? tab?.rightScrollTop : tab?.scrollTop) ?? 0
  const work = useStore((s) => s.works.find((w) => w.id === paneWorkId))
  // Unified favorite (local heart, or the online favorite of the same code).
  // Title-bar heart: doujin = the work's favorite; general manga = this
  // chapter's favorite (normalFavChapters, the sidebar chapter-row heart).
  const workFav = useStore(
    (s) =>
      !!work &&
      ((work.library ?? 'doujin') === 'normal'
        ? (s.settings.normalFavChapters ?? []).includes(work.id)
        : work.favorite || !!(work.code && s.onlineFavs[work.code]?.favorite))
  )
  const toggleNormalFav = useStore((s) => s.toggleNormalFav)
  const setTabScroll = useStore((s) => s.setTabScroll)
  const setTabRightScroll = useStore((s) => s.setTabRightScroll)
  const upsertWork = useStore((s) => s.upsertWork)
  const startDownload = useStore((s) => s.startDownload)
  // Reading mode + zoom are per-tab (per-pane): each tab keeps its own; a freshly
  // opened tab inherited the last-viewed tab's at creation. Mode reads straight
  // off the tab (reactive); zoom is local but seeded from / synced to the tab.
  const defaultMode = useStore((s) => s.settings.readerMode)
  const lastReaderMode = useStore((s) => s.settings.lastReaderMode)
  const setLastReaderMode = useStore((s) => s.setLastReaderMode)
  const lastFit = useStore((s) => s.settings.lastFit)
  const setLastFit = useStore((s) => s.setLastFit)
  const setLastZoom = useStore((s) => s.setLastZoom)
  const spreadNextSide = useStore((s) => s.settings.spreadNextSide)
  const pagedFlipSide = useStore((s) => s.settings.pagedFlipSide)
  const scrollTapFlip = useStore((s) => s.settings.scrollTapFlip ?? 'off')
  const setTapFlip = useStore((s) => s.setTapFlip)
  const setWorkFavorite = useStore((s) => s.setWorkFavorite)
  const setTabReader = useStore((s) => s.setTabReader)
  const markRead = useStore((s) => s.markRead)
  // Which library this pane belongs to (manga-site online = general-manga). Used to
  // restore + remember the reader mode separately for doujin vs general-manga.
  const libMode: 'doujin' | 'normal' = paneOnline
    ? paneOnline.kind === 'comic'
      ? 'normal'
      : 'doujin'
    : ((work?.library ?? 'doujin') as 'doujin' | 'normal')
  // Tab's own mode wins (set while reading); else this library's last-used mode;
  // else the global default.
  const mode =
    (side === 'right' ? tab?.rightReaderMode : tab?.readerMode) ??
    lastReaderMode?.[libMode] ??
    defaultMode
  const setMode = (m: 'scroll' | 'paged' | 'spread'): void => {
    setTabReader(tabId, side, { readerMode: m })
    setLastReaderMode(libMode, m) // persist per-library, survives restart
  }
  // Fit mode (page sizing). Tab's own value wins, else this library's last-used,
  // else contain. Persisted per library, survives restart.
  const storedFit: FitMode = (side === 'right' ? tab?.rightFit : tab?.fit) ?? lastFit?.[libMode] ?? 'contain'
  const fit: FitMode =
    mode === 'scroll' && !SCROLL_FIT_ORDER.includes(storedFit)
      ? storedFit === 'cover'
        ? 'width'
        : 'height'
      : storedFit
  const fitOrder = mode === 'scroll' ? SCROLL_FIT_ORDER : FIT_ORDER
  // Spread + cover: natural aspect (h/w) of the shown pages, to size them by hand.
  const [spreadRatios, setSpreadRatios] = useState<Record<string, number>>({})
  const onlineProgress = useStore((s) => s.onlineProgress)
  const setOnlineProgress = useStore((s) => s.setOnlineProgress)
  const reloadNonce = useStore((s) => s.reloadNonce)
  const pageGap = useStore((s) => s.settings.readerPageGap)
  const works = useStore((s) => s.works)
  const seriesRootList = useSeriesRoots()
  const chapterScheme = useStore((s) => s.settings.normalChapterScheme)
  const replaceTabWork = useStore((s) => s.replaceTabWork)
  const replaceTabOnline = useStore((s) => s.replaceTabOnline)
  const goBack = useStore((s) => s.goBack)
  const continueReading = useStore((s) => s.continueReading)
  const clearStartAtBottom = useStore((s) => s.clearStartAtBottom)
  const readingQueue = useStore((s) => s.readingQueue)

  const contentRef = useRef<HTMLDivElement>(null)
  const edgeAccum = useRef(0) // scroll mode: overscroll past an edge → continue
  const pendingBottomRef = useRef(false) // land on the last page after a backward continue
  // Cursor anchor for the next zoom step: keeps the point under the mouse fixed.
  const pendingZoom = useRef<{ cx: number; cy: number; ratio: number } | null>(null)
  // Virtualized scroll: measured page heights + a tick to re-render spacers.
  const heightsRef = useRef<number[]>([])
  const bumpRaf = useRef(0)
  const pageIdxRef = useRef(0)
  // Scroll mode: the page slider follows the scroll continuously (fractional
  // page), written straight to the DOM — no re-render per frame.
  const sliderRef = useRef<HTMLInputElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const syncSliderRef = useRef<() => void>(() => {})
  const syncSliderToScroll = (): void => syncSliderRef.current()
  const goToPageRef = useRef<(i: number) => void>(() => {})
  const wheelAccum = useRef(0) // paged mode: accumulated wheel delta → page steps
  const wheelRaf = useRef(0)
  const saveTimer = useRef(0)
  const [, setTick] = useState(0)
  const [images, setImages] = useState<string[]>([])
  const [loadingImgs, setLoadingImgs] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [dlDone, setDlDone] = useState(false)
  const [pageIdx, setPageIdx] = useState(0)
  // Seed zoom from the tab (keyed remount per tab+side guarantees this runs once
  // per tab); else this library's last-used zoom; else 1. prev/next reuse the
  // same instance so zoom carries over.
  const [zoom, setZoom] = useState(() => {
    const st = useStore.getState()
    const t = st.tabs.find((x) => x.id === tabId)
    return (side === 'right' ? t?.rightZoom : t?.zoom) ?? st.settings.lastZoom?.[libMode] ?? 1
  })
  const [pane, setPane] = useState({ w: 800, h: 600 })
  // Phone chrome: the title bar + bottom bar float over the pages and slide away
  // while reading (a scroll / page flip); a tap on the bottom 15% brings them
  // back. The bottom bar's extra row (mode / fit / 넘김) opens from ⋮ or a swipe
  // up on the bar.
  const [barsHidden, setBarsHidden] = useState(false)
  // Long-press popup (title: copy title / number; page: save image).
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const longPressAt = useRef(0) // the finger lifting after a long-press isn't a tap
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const headRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [barH, setBarH] = useState({ top: 0, bottom: 0 })
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const pinchEndAt = useRef(0) // a pinch's lifting fingers must not count as a tap
  const barSwipe = useRef<number | null>(null)

  const online = paneOnline
  const key = online ? `online:${online.code}` : paneWorkId

  // General-manga chapter navigation: prev/next within the same series.
  const isNormalWork = !!work && (work.library ?? 'doujin') === 'normal'
  const seriesGroup = useMemo(
    () => (isNormalWork && work ? seriesOf(work, works, seriesRootList) : null),
    [isNormalWork, work, works, seriesRootList]
  )
  const chapterInfos = useMemo(
    () => (seriesGroup ? analyzeSeries(seriesGroup.chapters, seriesGroup.title, chapterScheme) : []),
    [seriesGroup, chapterScheme]
  )

  const chapters = useMemo(() => chapterInfos.map((ci) => ci.work), [chapterInfos])
  const chIdx = work ? chapters.findIndex((c) => c.id === work.id) : -1

  // Online (manga-site) chapter navigation: same series' sibling chapters, loaded in
  // place (same tab) via the shared chapter cache. Left pane only.
  const [comicChs, setComicChs] = useState<ComicChapter[]>([])
  useEffect(() => {
    const su = online?.kind === 'comic' ? online.seriesUrl : undefined
    if (!su) {
      setComicChs([])
      return
    }
    let alive = true
    getComicChapters(su)
      .then((c) => alive && setComicChs(c))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [online?.kind, online?.seriesUrl])
  const comicIdx = online ? comicChs.findIndex((c) => c.url === online.code) : -1
  const goComicChapter = (delta: number): boolean => {
    const n = comicChs[comicIdx + delta]
    if (n && online) {
      replaceTabOnline(tabId, {
        code: n.url,
        title: online.title,
        artist: online.artist,
        kind: 'comic',
        seriesUrl: online.seriesUrl,
        chapterLabel: n.title,
        thumb: online.thumb
      })
      return true
    }
    return false
  }
  const goComicChapterRef = useRef(goComicChapter)
  goComicChapterRef.current = goComicChapter

  // One chapter navigator for the bottom bar + edge-scroll: online comic
  // (sibling chapters) or a local series; null for a single work.
  const chNav =
    online?.kind === 'comic' && side === 'left' && comicChs.length > 1
      ? {
          idx: comicIdx,
          count: comicChs.length,
          label: comicChs[comicIdx]?.title ?? online.chapterLabel ?? '',
          go: (d: 1 | -1) => goComicChapter(d)
        }
      : isNormalWork && chapters.length > 1
        ? {
            idx: chIdx,
            count: chapters.length,
            label: chapterInfos[chIdx]?.label ?? '',
            go: (d: 1 | -1) => {
              const n = chapters[chIdx + d]
              if (!n) return false
              replaceTabWork(tabId, side, n.id)
              return true
            }
          }
        : null
  // Past the first / last page: previous / next chapter, else the reading queue.
  const continueRef = useRef<(d: 1 | -1) => void>(() => {})
  continueRef.current = (d) => {
    // Going back by scrolling up lands on the previous chapter's last page.
    if (d < 0 && chNav && chNav.idx > 0 && side === 'left')
      useStore.setState((st) => ({ startAtBottom: { ...st.startAtBottom, [tabId]: true } }))
    if (chNav ? chNav.go(d) : false) return
    useStore.getState().continueReading(tabId, side, d)
  }

  // Zoom-scaled pane box (px), the basis for every fit-mode size calculation.
  const sw = Math.max(1, Math.round(pane.w * zoom))
  const sh = Math.max(1, Math.round(pane.h * zoom))
  // Page height before a page is measured. Prefer a measured height, else derive
  // it from the decoded aspect ratio (ratioRef) under the current fit mode, else
  // the pane-fit upper bound.
  const estH = Math.max(40, sh)
  const ratioRef = useRef<number[]>([]) // naturalHeight / naturalWidth per page
  const heightOf = useCallback(
    (i: number): number =>
      heightsRef.current[i] ||
      (ratioRef.current[i] ? Math.round(fitHeight(fit, ratioRef.current[i], sw, sh)) : estH),
    [fit, sw, sh, estH]
  )

  // The prefetcher reports each decoded page's natural size; store the aspect
  // ratio (stable across zoom/fit) so the virtualizer's spacers are ~right.
  const onDims = useCallback((i: number, w: number, h: number): void => {
    if (!w) return
    const r = h / w
    if (Math.abs((ratioRef.current[i] || 0) - r) > 0.002) {
      ratioRef.current[i] = r
      cancelAnimationFrame(bumpRaf.current)
      bumpRaf.current = requestAnimationFrame(() => setTick((t) => (t + 1) % 1e9))
    }
  }, [])

  // A rendered page reports its real pixel height; store it and re-render the
  // spacers if it changed meaningfully.
  const measure = useCallback((i: number, h: number): void => {
    if (h <= 0) return
    if (Math.abs((heightsRef.current[i] || 0) - h) > 2) {
      heightsRef.current[i] = h
      cancelAnimationFrame(bumpRaf.current)
      bumpRaf.current = requestAnimationFrame(() => setTick((t) => (t + 1) % 1e9))
    }
  }, [])

  useEffect(() => {
    if (!tab) return
    let alive = true
    setLoadingImgs(true)
    // Clear the previous work's pages immediately so they don't show behind the
    // loading overlay while the new list resolves.
    setImages([])
    heightsRef.current = [] // fresh work → drop measured heights
    ratioRef.current = [] // …and decoded aspect ratios
    // Online galleries remember the page you were on across close/reopen.
    const pp = side === 'right' ? tab.rightPagePos : tab.pagePos
    setPageIdx(online ? onlineProgress[online.code]?.pageIdx ?? 0 : pp && pp.workId === paneWorkId ? pp.idx : 0)
    // NB: zoom is NOT reset here — prev/next-chapter (same tab) keeps the zoom.
    const loader = online ? getOnlineImages(online.code) : work ? getImages(work.id) : Promise.resolve([])
    loader.then((imgs) => {
      if (!alive) return
      // Show the pages right away — the first (visible) page can paint at once.
      setImages(imgs)
      setLoadingImgs(false)
      // Continuing BACKWARD into this work → start at its last page. Consume the
      // one-shot flag HERE (tied to the new work's load) so it can't be eaten by a
      // render that still holds the previous work's pages.
      if (side === 'left' && useStore.getState().startAtBottom[tabId] && imgs.length) {
        pendingBottomRef.current = true
        setPageIdx(imgs.length - 1)
        clearStartAtBottom(tabId)
      }
      // Page exclusion (opt-in) hashes every page, which for a many-page work
      // would block the whole reader if done up front. Run it in the background
      // and drop the excluded pages once it finishes.
      if (!online && hasExclusions()) {
        filterExcluded(imgs, getExcluded()).then((kept) => {
          if (alive && kept.length !== imgs.length) {
            heightsRef.current = []
            ratioRef.current = []
            setImages(kept)
          }
        })
      }
    })
    return () => {
      alive = false
    }
  }, [key, reloadNonce])

  // Sync zoom back onto the tab so switching away and back (or a new tab that
  // inherits it) keeps the same magnification. Also persist it per library
  // (debounced so a Ctrl+wheel burst doesn't spam disk writes).
  useEffect(() => {
    setTabReader(tabId, side, { zoom })
    const h = window.setTimeout(() => setLastZoom(libMode, zoom), 400)
    return () => window.clearTimeout(h)
  }, [zoom, tabId, side, setTabReader, setLastZoom, libMode])

  // Online galleries stream over the network. Prefetch the WHOLE gallery once,
  // but in reading order from the opened page and at low concurrency, so the
  // first pages paint fast and the rest fill in the background (instead of
  // firing every request at once and stalling the start). onDims feeds the
  // virtualizer so spacers are right and scrolling doesn't jump.
  const sinkRef = useRef<HTMLImageElement[]>([])
  useEffect(() => {
    sinkRef.current = []
    if (!online || images.length === 0) return
    const s = pageIdxRef.current
    const order: number[] = []
    for (let i = s; i < images.length; i++) order.push(i)
    for (let i = s - 1; i >= 0; i--) order.push(i)
    return prefetchOrdered(images, order, 4, sinkRef.current, onDims)
  }, [online?.code, images, onDims])

  // Local works load from disk fast, but a fresh <img> still decodes on mount →
  // a black flash as new pages scroll in / paging remounts. Prefetch a bounded
  // window AHEAD of the current page (forward-first, concurrency-limited) so
  // upcoming pages are already decoded before they're viewed — no per-page
  // stutter — while memory stays flat on huge works.
  const warmRef = useRef<HTMLImageElement[]>([])
  useEffect(() => {
    warmRef.current = []
    if (online || images.length === 0) return
    const AHEAD = 40
    const BEHIND = 4
    const hi = Math.min(images.length, pageIdx + AHEAD + 1)
    const order: number[] = []
    for (let i = pageIdx; i < hi; i++) order.push(i)
    for (let i = pageIdx - 1; i >= Math.max(0, pageIdx - BEHIND); i--) order.push(i)
    return prefetchOrdered(images, order, 6, warmRef.current, onDims)
  }, [online, images, pageIdx, onDims])

  // Continuous reading: warm the neighbouring works in the reading queue so that
  // crossing a work boundary is instant (the folder listing is cached and the
  // edge pages are already decoded). Next work's first pages + prev work's last.
  const neighborRef = useRef<HTMLImageElement[]>([])
  useEffect(() => {
    neighborRef.current = []
    if (online || !work) return
    const i = readingQueue.indexOf(work.id)
    if (i < 0) return
    let cancelled = false
    const warm = (id: string | undefined, tail: boolean): void => {
      if (!id) return
      getImages(id)
        .then((imgs) => {
          if (cancelled) return
          for (const src of tail ? imgs.slice(-3) : imgs.slice(0, 3)) {
            const im = new Image()
            im.decoding = 'async'
            im.src = src
            neighborRef.current.push(im)
          }
        })
        .catch(() => {})
    }
    warm(readingQueue[i + 1], false)
    warm(readingQueue[i - 1], true)
    return () => {
      cancelled = true
      neighborRef.current = []
    }
  }, [online, work?.id, readingQueue])

  // Count a view (조회수 / 최근 본) once per opening of a local work.
  useEffect(() => {
    if (!tab || !work || online) return
    const ck = `${tabId}:${side}:${work.id}`
    if (counted.has(ck)) return
    counted.add(ck)
    window.api.incrementView(work.id).then(upsertWork)
  }, [tabId, side, work?.id])

  // Current page from scroll position, computed from the cumulative page-height
  // model (the DOM only holds a window of pages, so rects can't be used).
  const computeCurrentFromScroll = useCallback((): void => {
    const el = contentRef.current
    if (!el) return
    const target = (el.scrollTop + el.clientHeight / 3) / vz.current.s // pinch zoom → layer px
    let acc = 0
    let idx = 0
    for (let i = 0; i < images.length; i++) {
      const h = heightOf(i)
      if (target < acc + h) {
        idx = i
        break
      }
      acc += h
      idx = i
    }
    pageIdxRef.current = idx
    setPageIdx(idx) // React skips the re-render when idx is unchanged
  }, [images.length, heightOf])

  // --- scroll mode: restore saved scroll, then sync the current page. ---
  useLayoutEffect(() => {
    if (mode !== 'scroll') return
    const el = contentRef.current
    if (!el || !tab) return
    el.scrollTop = online ? onlineProgress[online.code]?.scrollTop ?? 0 : savedScroll
    computeCurrentFromScroll() // center the render window on the restored page
    // Depend on `images` (not images.length): switching to another chapter with the
    // SAME page count must still reset the scroll to that chapter's top/saved spot.
  }, [tabId, side, images, mode])

  // When continuing BACKWARD into the previous work, land on its last page / bottom
  // instead of the top. The flag was set in the load effect (tied to this work).
  // In scroll mode the page heights are still settling as images decode, so a
  // single scroll would drift mid-way — pin to the bottom for a short window until
  // the layout stabilizes, then sync the current page.
  useLayoutEffect(() => {
    if (!pendingBottomRef.current || images.length === 0) return
    pendingBottomRef.current = false
    if (mode !== 'scroll') {
      goToPageRef.current(images.length - 1)
      return
    }
    const deadline = performance.now() + 700
    const pin = (): void => {
      const el = contentRef.current
      if (!el) return
      el.scrollTop = el.scrollHeight
      if (performance.now() < deadline) requestAnimationFrame(pin)
      else computeCurrentFromScroll()
    }
    requestAnimationFrame(pin)
  }, [images, mode, computeCurrentFromScroll])

  // Remember which general-manga chapter was opened last (이어보기 / list mark).
  const progKey = online ? online.code : work?.id
  useEffect(() => {
    if (libMode === 'normal' && progKey) markRead(progKey)
  }, [libMode, progKey, markRead])

  useEffect(() => {
    if (mode !== 'scroll') return
    const el = contentRef.current
    if (!el || !tab) return
    let raf = 0
    // Persist scroll position only after scrolling settles. Writing to the store
    // every frame re-rendered the Reader (window math) + TabBar each frame and
    // capped the framerate; this keeps scrolling render-free.
    const save = (): void => {
      const top = el.scrollTop / vz.current.s // saved unzoomed (pinch zoom isn't kept)
      if (online) setOnlineProgress(online.code, { scrollTop: top, pageIdx: pageIdxRef.current })
      else if (side === 'right') setTabRightScroll(tabId, top)
      else setTabScroll(tabId, top)
    }
    const onScroll = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        computeCurrentFromScroll() // cheap; re-renders only on page change
        syncSliderToScroll()
      })
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(save, 250)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
      window.clearTimeout(saveTimer.current)
      save() // flush on tab switch / unmount
    }
  }, [tabId, side, mode, online?.code, computeCurrentFromScroll, setOnlineProgress, setTabScroll, setTabRightScroll])

  const goToPage = useCallback(
    (idx: number): void => {
      // Continuous reading: stepping past the last/first page flows into the next/
      // previous work. Online (manga-site) uses its sibling chapters; local works use the
      // reading queue (the filtered left list). Only when a neighbour exists.
      if (idx > images.length - 1) {
        continueRef.current(1)
        return
      }
      if (idx < 0) {
        continueRef.current(-1)
        return
      }
      const clamped = Math.max(0, Math.min(images.length - 1, idx))
      setPageIdx(clamped)
      if (mode === 'scroll') {
        const el = contentRef.current
        if (el) {
          let top = 0
          for (let i = 0; i < clamped; i++) top += heightOf(i)
          el.scrollTo({ top: top * vz.current.s, behavior: 'auto' })
        }
      }
      if (online) setOnlineProgress(online.code, { scrollTop: contentRef.current?.scrollTop ?? 0, pageIdx: clamped })
    },
    [images.length, mode, online, setOnlineProgress, heightOf, continueReading, tabId, side]
  )

  // Keep refs fresh so the wheel handler (paged paging) reads current values
  // without re-subscribing each render.
  goToPageRef.current = goToPage
  pageIdxRef.current = pageIdx

  // Paged / two-page modes: remember the page in the tab (settled, not per flip).
  const setTabPage = useStore((s) => s.setTabPage)
  useEffect(() => {
    if (mode === 'scroll' || online || !paneWorkId) return
    const t = window.setTimeout(() => setTabPage(tabId, side, { workId: paneWorkId, idx: pageIdx }), 300)
    return () => window.clearTimeout(t)
  }, [pageIdx, mode, online, paneWorkId, tabId, side, setTabPage])

  // Changing the fit mode resizes every page, so re-anchor the scroll to the
  // page the reader was on (heights were cleared in applyFit → re-measured).
  const fitRef = useRef(fit)
  useLayoutEffect(() => {
    if (fitRef.current === fit) return
    fitRef.current = fit
    if (mode === 'scroll') goToPageRef.current(pageIdxRef.current)
  }, [fit, mode])

  // Overlay bar heights → scroll-mode padding so the first / last page can be
  // scrolled clear of the bars.
  useEffect(() => {
    const update = (): void =>
      setBarH({ top: headRef.current?.offsetHeight ?? 0, bottom: bottomRef.current?.offsetHeight ?? 0 })
    update()
    const ro = new ResizeObserver(update)
    if (headRef.current) ro.observe(headRef.current)
    if (bottomRef.current) ro.observe(bottomRef.current)
    return () => ro.disconnect()
  }, [images.length > 0])

  // Measure the reader pane so a page can be fit whole at 100% (scroll mode).
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const update = (): void => setPane({ w: el.clientWidth - 8, h: el.clientHeight - 8 }) // 4px each side
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode, images.length])

  // Ctrl + wheel zoom (works in both scroll and paged modes). The point under
  // the cursor is recorded so the layout effect below can keep it fixed.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) {
        // Paged / spread modes: the page fits the pane (no scroll), so use the
        // wheel to flip pages instead (two at a time in spread).
        if (mode !== 'scroll') {
          // Optional: let the wheel flip pages in click-paging / spread modes.
          if (!useStore.getState().settings.pagedWheelFlip) return
          e.preventDefault()
          // Accumulate the wheel delta and flip a page every WHEEL_STEP px, so a
          // longer/faster scroll keeps flipping (proportional to how much you
          // scroll) instead of a fixed one-flip-per-burst. Batched per animation
          // frame so multiple events in one frame read a fresh page index.
          const WHEEL_STEP = 100
          if ((e.deltaY > 0) !== (wheelAccum.current > 0)) wheelAccum.current = 0
          wheelAccum.current += e.deltaY
          if (!wheelRaf.current) {
            wheelRaf.current = requestAnimationFrame(() => {
              wheelRaf.current = 0
              const n = Math.trunc(wheelAccum.current / WHEEL_STEP)
              if (n !== 0) {
                wheelAccum.current -= n * WHEEL_STEP
                const unit = mode === 'spread' ? 2 : 1
                goToPageRef.current(pageIdxRef.current + n * unit)
              }
            })
          }
        } else {
          // Scroll mode: keep scrolling past the bottom (or top) to flow into the
          // next (or previous) work in the reading queue — continuous reading.
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
          const atTop = el.scrollTop <= 0
          if ((atBottom && e.deltaY > 0) || (atTop && e.deltaY < 0)) {
            if ((e.deltaY > 0) !== (edgeAccum.current > 0)) edgeAccum.current = 0
            edgeAccum.current += e.deltaY
            const EDGE = 240 // extra overscroll needed before jumping works
            if (Math.abs(edgeAccum.current) >= EDGE) {
              const dir: 1 | -1 = edgeAccum.current > 0 ? 1 : -1
              edgeAccum.current = 0
              // Online manga-site continues by sibling chapter; local by reading queue.
              continueRef.current(dir)
            }
          } else {
            edgeAccum.current = 0
          }
        }
        return
      }
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const cx = e.clientX - r.left
      const cy = e.clientY - r.top
      setZoom((z) => {
        const nz = Math.max(0.25, Math.min(5, +(z * (e.deltaY < 0 ? 1.1 : 0.9)).toFixed(2)))
        pendingZoom.current = nz === z ? null : { cx, cy, ratio: nz / z }
        return nz
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [mode, images.length])

  // Two-finger pinch zoom (phone) — a purely visual zoom on top of the fit:
  // the page layer (.zoom-layer) is CSS-scaled from its top-left corner and the
  // pane's own scroll pans it, so nothing re-lays out (no jump on release). The
  // content point under the fingers stays under them while pinching / moving.
  // Zooming out past the fit rubber-bands, then springs back to the fit on
  // release. vz.s is that scale (1 = fit); scroll-mode page math divides by it.
  const vz = useRef({ s: 1, tx: 0, ty: 0 })
  const vzAnim = useRef(0)
  const layerOf = (): HTMLElement | null => contentRef.current?.querySelector<HTMLElement>('.zoom-layer') ?? null
  // Put content point (X, Y) (unscaled layer px) under pane point (cx, cy) at
  // scale s: scroll as far as the range allows, the remainder as a translate.
  const vzSet = useCallback((sc: number, X: number, Y: number, cx: number, cy: number, settle = 1): void => {
    const el = contentRef.current
    const layer = el?.querySelector<HTMLElement>('.zoom-layer')
    if (!el || !layer) return
    const offX = X * sc - cx
    const offY = Y * sc - cy
    const maxX = Math.max(0, layer.offsetWidth * sc - el.clientWidth)
    const maxY = Math.max(0, layer.scrollHeight * sc - el.clientHeight)
    const sl = Math.max(0, Math.min(maxX, offX))
    const st = Math.max(0, Math.min(maxY, offY))
    const tx = (sl - offX) * settle
    const ty = (st - offY) * settle
    vz.current = { s: sc, tx, ty }
    layer.style.transformOrigin = '0 0'
    layer.style.transform = sc === 1 && !tx && !ty ? '' : `translate(${tx}px, ${ty}px) scale(${sc})`
    el.scrollLeft = sl
    el.scrollTop = st
  }, [])
  // Back to the plain fit (new page / mode / work).
  const vzReset = useCallback((): void => {
    cancelAnimationFrame(vzAnim.current)
    const layer = layerOf()
    if (layer) layer.style.transform = ''
    vz.current = { s: 1, tx: 0, ty: 0 }
  }, [])
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    let p: { d0: number; s0: number; X: number; Y: number; cx: number; cy: number } | null = null
    const dist = (t: TouchList): number => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const mid = (t: TouchList): [number, number] => {
      const r = el.getBoundingClientRect()
      return [(t[0].clientX + t[1].clientX) / 2 - r.left, (t[0].clientY + t[1].clientY) / 2 - r.top]
    }
    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 2) return
      cancelAnimationFrame(vzAnim.current)
      const [cx, cy] = mid(e.touches)
      const { s: s0, tx, ty } = vz.current
      p = {
        d0: dist(e.touches) || 1,
        s0,
        X: (cx + el.scrollLeft - tx) / s0,
        Y: (cy + el.scrollTop - ty) / s0,
        cx,
        cy
      }
    }
    const onMove = (e: TouchEvent): void => {
      if (!p || e.touches.length !== 2) return
      if (e.cancelable) e.preventDefault()
      const raw = (p.s0 * dist(e.touches)) / p.d0
      // Below the fit: resist (rubber band), never under 60 %.
      const sc = raw >= 1 ? Math.min(5, raw) : Math.max(0.6, 1 - (1 - raw) * 0.45)
      const [cx, cy] = mid(e.touches)
      p.cx = cx
      p.cy = cy
      vzSet(sc, p.X, p.Y, cx, cy)
    }
    const onEnd = (e: TouchEvent): void => {
      if (!p || e.touches.length >= 2) return
      const { X, Y, cx, cy } = p
      p = null
      pinchEndAt.current = Date.now()
      // Spring back: under the fit → the fit; any edge overshoot → flush.
      const from = vz.current.s
      const to = Math.max(1, from)
      if (from === to && !vz.current.tx && !vz.current.ty) return
      const t0 = performance.now()
      const DUR = 220
      const step = (now: number): void => {
        const k = Math.min(1, (now - t0) / DUR)
        const ease = 1 - Math.pow(1 - k, 3)
        vzSet(from + (to - from) * ease, X, Y, cx, cy, 1 - ease)
        if (k < 1) vzAnim.current = requestAnimationFrame(step)
      }
      vzAnim.current = requestAnimationFrame(step)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [mode, images.length, vzSet])
  // Paged / spread: a page flip (or any mode / work change) drops the zoom.
  useLayoutEffect(() => {
    if (mode !== 'scroll') vzReset()
  }, [pageIdx, mode, vzReset])
  useLayoutEffect(() => vzReset, [mode, images, vzReset])

  // After a cursor-anchored zoom, page sizes scale by `ratio`; shift the scroll
  // so the content point that was under the cursor stays under it.
  useLayoutEffect(() => {
    const p = pendingZoom.current
    if (!p) return
    pendingZoom.current = null
    // Page heights scale with zoom — keep the model in sync.
    heightsRef.current = heightsRef.current.map((h) => (h ? h * p.ratio : 0))
    const el = contentRef.current
    if (!el) return
    el.scrollLeft = (el.scrollLeft + p.cx) * p.ratio - p.cx
    el.scrollTop = (el.scrollTop + p.cy) * p.ratio - p.cy
  }, [zoom])

  // Zoom = 1 means "at fit": the button shows the fit label and cycles the four
  // fit modes. A Ctrl+wheel zoom sets zoom ≠ 1 ("custom"): the button then shows
  // the % and a click reverts to the fit mode.
  const atFit = Math.abs(zoom - 1) < 0.001
  const applyFit = (f: FitMode): void => {
    heightsRef.current = [] // page sizing changed → re-measure
    setZoom(1)
    setTabReader(tabId, side, { fit: f, zoom: 1 })
    setLastFit(libMode, f)
    setLastZoom(libMode, 1)
  }
  const onZoomButton = (): void => {
    if (atFit) applyFit(fitOrder[(fitOrder.indexOf(fit) + 1) % fitOrder.length])
    else {
      heightsRef.current = []
      setZoom(1) // custom → back to the fit mode
    }
  }

  useEffect(() => {
    if (mode !== 'spread' || fit !== 'cover') return
    let alive = true
    for (const src of [images[pageIdx], images[pageIdx + 1]]) {
      if (!src || spreadRatios[src]) continue
      const im = new Image()
      im.onload = () => {
        if (alive && im.naturalWidth)
          setSpreadRatios((m) => ({ ...m, [src]: im.naturalHeight / im.naturalWidth }))
      }
      im.src = src
    }
    return () => {
      alive = false
    }
  }, [mode, fit, images, pageIdx, spreadRatios])

  // keyboard paging
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      const step = mode === 'spread' ? 2 : 1
      const combo = comboFromEvent(e)
      if (!combo) return
      const keys = useStore.getState().settings.shortcuts
      if (shortcutCombos(keys, 'nextPage').includes(combo)) goToPage(pageIdx + step)
      else if (shortcutCombos(keys, 'prevPage').includes(combo)) goToPage(pageIdx - step)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pageIdx, goToPage, mode])

  // Online: which pages are already downloaded (decoded by the prefetcher or
  // shown) — runs of them become light-purple bands on the page slider.
  const loadedTrack = (() => {
    const n = images.length
    if (!online || !n) return 'transparent'
    const stops: string[] = []
    let i = 0
    while (i < n) {
      if (!ratioRef.current[i]) {
        i++
        continue
      }
      let j = i
      while (j < n && ratioRef.current[j]) j++
      const a = ((i / n) * 100).toFixed(2)
      const b = ((j / n) * 100).toFixed(2)
      stops.push(`transparent ${a}%, var(--page-loaded) ${a}%, var(--page-loaded) ${b}%, transparent ${b}%`)
      i = j
    }
    return stops.length ? `linear-gradient(to right, ${stops.join(', ')})` : 'transparent'
  })()

  syncSliderRef.current = () => {
    const el = contentRef.current
    const n = images.length
    if (!el || mode !== 'scroll' || n < 2) return
    let y = el.scrollTop / vz.current.s
    let pos = 0
    for (let i = 0; i < n; i++) {
      const h = heightOf(i)
      if (y < h || i === n - 1) {
        pos = i + Math.max(0, Math.min(1, y / (h || 1)))
        break
      }
      y -= h
    }
    pos = Math.min(n - 1, pos)
    if (sliderRef.current) sliderRef.current.value = String(pos)
    if (progressRef.current) progressRef.current.style.width = `calc(${pos / (n - 1)} * (100% - 22px) + 11px)`
  }

  // A page change re-renders the slider with the whole page number — put the
  // fractional scroll position back before paint.
  useLayoutEffect(() => {
    if (mode === 'scroll') syncSliderRef.current()
  })

  if (!tab) return <div className="reader empty">탭이 없습니다.</div>

  const title = online ? online.title : work?.title ?? '(삭제됨)'

  const download = async (): Promise<void> => {
    if (!online) return
    setDownloading(true)
    try {
      const works = await startDownload({ kind: 'doujin', input: online.code, title: online.title })
      if (!works) return // stopped
      setDlDone(true)
      setTimeout(() => setDlDone(false), 2500) // briefly flip the button to 완료 ✓
    } catch (e: any) {
      alert(String(e?.message ?? e))
    } finally {
      setDownloading(false)
    }
  }

  // Download the whole manga-site series into the local general-manga library.
  const downloadComic = async (): Promise<void> => {
    if (!online?.seriesUrl) return
    setDownloading(true)
    try {
      const created = await startDownload({
        kind: 'comic',
        seriesUrl: online.seriesUrl,
        title: online.title
      })
      if (!created) return // stopped
      setDlDone(true)
      setTimeout(() => setDlDone(false), 2500)
    } catch (e: any) {
      alert(String(e?.message ?? e))
    } finally {
      setDownloading(false)
    }
  }

  // Taps on the pages. A single tap waits a moment for a possible second tap
  // (double tap = zoom), then acts. Bars toggle zone:
  //   paged / spread: the center (middle third of the width × middle 40% of
  //     the height); elsewhere one half flips forward (pagedFlipSide), the
  //     other back.
  //   scroll, 넘김 OFF: anywhere.
  //   scroll, 하단 넘김: the middle third band (full width); the bottom third
  //     scrolls one screen; the top third does nothing.
  type Tap = { x: number; y: number; rect: DOMRect; el: HTMLElement }
  // A single tap acts after 130ms unless a second finger-down arrives in that
  // window; then it waits for that touch's tap (→ double tap) a little longer.
  const tapTimer = useRef(0)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const pendingSingle = useRef<(() => void) | null>(null)
  const firePending = (): void => {
    const f = pendingSingle.current
    pendingSingle.current = null
    lastTap.current = null
    f?.()
  }
  const handleTap = (e: React.MouseEvent, single: (t: Tap) => void): void => {
    if (Date.now() - pinchEndAt.current < 400) return // end of a pinch, not a tap
    if (Date.now() - longPressAt.current < 700) return // end of a long-press
    const el = e.currentTarget as HTMLElement
    const tap: Tap = { x: e.clientX, y: e.clientY, rect: el.getBoundingClientRect(), el }
    const now = Date.now()
    const prev = lastTap.current
    window.clearTimeout(tapTimer.current)
    if (prev && now - prev.t < 450 && Math.hypot(prev.x - tap.x, prev.y - tap.y) < 40) {
      lastTap.current = null
      pendingSingle.current = null
      toggleZoomAt(tap)
      return
    }
    lastTap.current = { t: now, x: tap.x, y: tap.y }
    pendingSingle.current = () => single(tap)
    tapTimer.current = window.setTimeout(firePending, 130)
  }
  const toggleBars = (): void => {
    setBarsHidden((h) => !h)
    setMoreOpen(false)
  }
  const onPagedClick = (e: React.MouseEvent): void =>
    handleTap(e, (t) => {
      const y = (t.y - t.rect.top) / t.rect.height
      const x = (t.x - t.rect.left) / t.rect.width
      if (Math.abs(x - 0.5) < 1 / 6 && Math.abs(y - 0.5) < 0.2) return toggleBars()
      const step = mode === 'spread' ? 2 : 1
      const forward = x < 0.5 === (pagedFlipSide === 'left')
      goToPage(pageIdx + (forward ? step : -step))
      setBarsHidden(true)
    })
  const onScrollClick = (e: React.MouseEvent): void =>
    handleTap(e, (t) => {
      if (scrollTapFlip !== 'bottom') return toggleBars()
      const y = (t.y - t.rect.top) / t.rect.height
      if (y < 1 / 3) return
      if (y < 2 / 3) return toggleBars()
      t.el.scrollBy({ top: Math.round(t.el.clientHeight * 0.85), behavior: 'smooth' })
      setBarsHidden(true)
    })
  // Double tap: at the fit → zoom in until the page under the finger fills the
  // pane (2× when it already fills one side, e.g. width-fit scroll); zoomed in
  // → back to the fit. Animated, anchored at the tap (same visual zoom as the
  // pinch).
  const toggleZoomAt = (t: Tap): void => {
    const el = contentRef.current
    if (!el) return
    cancelAnimationFrame(vzAnim.current)
    const { s: from, tx, ty } = vz.current
    const cx = t.x - t.rect.left
    const cy = t.y - t.rect.top
    const X = (cx + el.scrollLeft - tx) / from
    const Y = (cy + el.scrollTop - ty) / from
    let to = 1
    if (from <= 1.01) {
      const hit = document.elementFromPoint(t.x, t.y) as HTMLElement | null
      const img = hit?.closest('img') ?? el.querySelector<HTMLElement>('.paged-cur img, .zoom-layer img')
      const r = img?.getBoundingClientRect()
      to = r && r.width && r.height ? Math.max(el.clientWidth / r.width, el.clientHeight / r.height) : 2
      if (to < 1.2) to = 2
      to = Math.min(5, to)
    }
    const t0 = performance.now()
    const DUR = 240
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / DUR)
      const ease = 1 - Math.pow(1 - k, 3)
      vzSet(from + (to - from) * ease, X, Y, cx, cy, to === 1 ? 1 - ease : 1)
      if (k < 1) vzAnim.current = requestAnimationFrame(step)
    }
    vzAnim.current = requestAnimationFrame(step)
    setBarsHidden(true)
  }
  // A drag on the pages (scrolling / panning) hides the bars.
  // Scroll mode, touch: keep pulling past the bottom (or the top) → next (or
  // previous) chapter. The pull is measured from where the finger was when
  // the edge was reached; a hint shows how far to go.
  const EDGE_PULL = 130
  const edgePull = useRef<{ dir: 1 | -1; y0: number } | null>(null)
  const [pullHint, setPullHint] = useState<{ dir: 1 | -1; ready: boolean } | null>(null)
  const trackEdgePull = (t: { clientY: number }): void => {
    const el = contentRef.current
    if (!el || mode !== 'scroll' || vz.current.s > 1.01) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    const atTop = el.scrollTop <= 0
    const p = edgePull.current
    if (!p) {
      if (atBottom) edgePull.current = { dir: 1, y0: t.clientY }
      else if (atTop) edgePull.current = { dir: -1, y0: t.clientY }
      return
    }
    const pull = p.dir === 1 ? p.y0 - t.clientY : t.clientY - p.y0
    if ((p.dir === 1 && !atBottom) || (p.dir === -1 && !atTop) || pull < 0) {
      edgePull.current = null
      setPullHint(null)
      return
    }
    if (pull > 24) setPullHint({ dir: p.dir, ready: pull >= EDGE_PULL })
  }
  const endEdgePull = (t: { clientY: number } | undefined): void => {
    const p = edgePull.current
    edgePull.current = null
    setPullHint(null)
    if (!p || !t) return
    const pull = p.dir === 1 ? p.y0 - t.clientY : t.clientY - p.y0
    if (pull >= EDGE_PULL) continueRef.current(p.dir)
  }

  const onPagesTouchStart = (e: React.TouchEvent): void => {
    edgePull.current = null
    // A finger-down while a single tap is pending: maybe a double tap.
    if (pendingSingle.current) {
      window.clearTimeout(tapTimer.current)
      tapTimer.current = window.setTimeout(firePending, 320)
    }
    const t = e.touches[0]
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null
    swipe.current = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null
  }
  // Paged / two-page: a quick horizontal swipe flips. The forward direction
  // follows the tap setting — 오른쪽 넘김: swipe left (the next page comes in
  // from the right); 왼쪽 넘김: swipe right. Not while pinch-zoomed (that drag
  // pans the page).
  const onPagesTouchEnd = (e: React.TouchEvent): void => {
    if (e.touches.length === 0) endEdgePull(e.changedTouches[0])
    const s0 = swipe.current
    swipe.current = null
    const t = e.changedTouches[0]
    if (!s0 || !t || e.touches.length > 0 || mode === 'scroll' || vz.current.s > 1.01) return
    const dx = t.clientX - s0.x
    const dy = t.clientY - s0.y
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - s0.t > 700) return
    const step = mode === 'spread' ? 2 : 1
    const forward = (dx < 0) === (pagedFlipSide === 'right')
    goToPage(pageIdx + (forward ? step : -step))
    setBarsHidden(true)
  }
  const onPagesTouchMove = (e: React.TouchEvent): void => {
    if (e.touches.length === 1) trackEdgePull(e.touches[0])
    const s = touchStart.current
    const t = e.touches[0]
    if (!s || !t || barsHidden) return
    if (Math.abs(t.clientY - s.y) > 12 || Math.abs(t.clientX - s.x) > 12) {
      setBarsHidden(true)
      setMoreOpen(false)
      touchStart.current = null
    }
  }
  // Long-press a page: 이미지 저장 (a copy into the phone's Download folder,
  // also for downloaded works).
  const onPageContext = (e: React.MouseEvent): void => {
    const img = (e.target as HTMLElement).closest('img')
    if (!img) return
    e.preventDefault()
    longPressAt.current = Date.now()
    const src = img.getAttribute('src') ?? ''
    const n = images.indexOf(src)
    const name = `${title}${n >= 0 ? `_p${n + 1}` : ''}`
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [{ label: '이미지 저장', onClick: () => void window.api.saveImageToDownloads(img.src, name) }]
    })
  }
  const pagesTouch = {
    onTouchStart: onPagesTouchStart,
    onTouchMove: onPagesTouchMove,
    onTouchEnd: onPagesTouchEnd,
    onContextMenu: onPageContext
  }
  // Long-press the title: copy the title / the work number.
  const workCode = online ? (online.kind === 'comic' ? null : online.code) : (work?.code ?? null)
  const onTitleContext = (e: React.MouseEvent): void => {
    e.preventDefault()
    // (Android 13+ shows its own "copied" confirmation.)
    const copy = (text: string): void => void window.api.clipboardWriteText(text)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '제목 복사', onClick: () => copy(title) },
        ...(workCode ? [{ label: `작품 번호 복사 (${workCode})`, onClick: () => copy(workCode) }] : [])
      ]
    })
  }
  // Swipe up on the bottom bar opens the extra row, down closes it.
  const onBarTouchStart = (e: React.TouchEvent): void => {
    barSwipe.current = e.touches[0]?.clientY ?? null
  }
  const onBarTouchEnd = (e: React.TouchEvent): void => {
    const y0 = barSwipe.current
    const y1 = e.changedTouches[0]?.clientY
    barSwipe.current = null
    if (y0 == null || y1 == null) return
    if (y1 - y0 < -30) setMoreOpen(true)
    else if (y1 - y0 > 30) setMoreOpen(false)
  }

  return (
    <div className={`reader-wrap overlay-bars ${barsHidden ? 'bars-hidden' : ''}`}>
      <div className="reader-head" ref={headRef}>
        {side === 'left' && (
          <button className="mini icon reader-back" onClick={goBack} title="목록">
            <ArrowBackIcon />
          </button>
        )}
        <h2 onContextMenu={onTitleContext}>{title}</h2>
        {online && (
          <span className="reader-online" title="온라인">
            <LanguageIcon />
          </span>
        )}
        {/* Icon buttons, flat group (default design). Download shows its state
            in the icon: arrow → (busy, dimmed) → check when done. */}
        <span className="flat-group reader-head-btns">
          {online && online.kind !== 'comic' ? (
            <button
              className={`mini icon ${dlDone ? 'dl-ok' : ''} ${downloading ? 'busy' : ''}`}
              onClick={download}
              disabled={downloading || dlDone}
              title={downloading ? '다운로드 중…' : dlDone ? '다운로드 완료' : '다운로드'}
            >
              {dlDone ? <CheckMarkIcon /> : <DownloadIcon />}
            </button>
          ) : online && online.kind === 'comic' && online.seriesUrl ? (
            <button
              className={`mini icon ${dlDone ? 'dl-ok' : ''} ${downloading ? 'busy' : ''}`}
              onClick={downloadComic}
              disabled={downloading || dlDone}
              title={downloading ? '다운로드 중…' : dlDone ? '다운로드 완료' : '전체 다운로드'}
            >
              {dlDone ? <CheckMarkIcon /> : <DownloadIcon />}
            </button>
          ) : (
            work && (
              // Local work: the unified favorite (same heart as the library card).
              <button
                className={`mini icon reader-fav ${workFav ? 'on' : ''}`}
                onClick={() =>
                  (work.library ?? 'doujin') === 'normal'
                    ? void toggleNormalFav('chapter', work.id, !workFav)
                    : void setWorkFavorite(work, !workFav)
                }
                title={workFav ? '즐겨찾기 해제' : '즐겨찾기'}
              >
                <FavoriteIcon filled={workFav} />
              </button>
            )
          )}
        </span>
      </div>

      {loadingImgs && <div className="reader-loading">{(online?.kind === 'comic' && comicStatus) || '이미지 로딩 중…'}</div>}

      {mode === 'scroll' ? (
        (() => {
          // Virtualize both local and online: only render pages near the current
          // one; everything else is a spacer sized from the page-height model
          // (measured height → decoded-aspect estimate → pane-fit fallback). This
          // keeps the number of mounted <img> (and thus concurrent fetches) small,
          // so a large online gallery no longer loads every page up front. The
          // prefetcher decodes upcoming pages ahead of the scroll and fills their
          // height estimates, so spacers stay ~right and scrolling doesn't jump.
          // Online uses a wider window since its pages arrive over the network.
          const WIN = online ? 6 : 2
          const start = Math.max(0, pageIdx - WIN)
          const end = Math.min(images.length, pageIdx + WIN + 1)
          let topPad = 0
          for (let i = 0; i < start; i++) topPad += heightOf(i)
          let botPad = 0
          for (let i = end; i < images.length; i++) botPad += heightOf(i)
          const pageStyle = fitStyle(fit, sw, sh)
          return (
            <div
              className={`reader-content scroll ${pageGap ? 'page-gap' : ''}`}
              ref={contentRef}
              onClick={onScrollClick}
              {...pagesTouch}
              // Allow horizontal scroll when the page can exceed the pane width
              // (zoomed in, or width/cover fit past the viewport).
              // (Always on a phone: a pinch zoom pans sideways by scrolling.)
              style={{ overflowX: 'auto' }}
            >
              <div className="reader-pages-col zoom-layer" style={{ paddingTop: barH.top, paddingBottom: barH.bottom }}>
                {topPad > 0 && <div style={{ height: topPad }} aria-hidden />}
                {images.slice(start, end).map((src, k) => {
                  const i = start + k
                  return (
                    <PageSlot key={i} index={i} onMeasure={measure}>
                      <PageImage
                        src={src}
                        style={pageStyle}
                      />
                    </PageSlot>
                  )
                })}
                {botPad > 0 && <div style={{ height: botPad }} aria-hidden />}
              </div>
            </div>
          )
        })()
      ) : mode === 'spread' ? (
        <div className="reader-content paged spread" ref={contentRef} onClick={onPagedClick} {...pagesTouch}>
          <div className="zoom-layer">
          <div className="spread-pages">
            {/* Page order per setting: 'left' = next page on the left (manga
                right-to-left), 'right' = next page on the right (left-to-right). */}
            {(spreadNextSide === 'left' ? [pageIdx + 1, pageIdx] : [pageIdx, pageIdx + 1]).map(
              (idx) => {
                if (!images[idx]) return null
                const half = Math.round(sw / 2)
                const img = (style: React.CSSProperties): JSX.Element => (
                  <PageImage
                    key={idx}
                    src={images[idx]}
                    style={style}
                  />
                )
                if (fit !== 'cover') return img(fitStyle(fit, half, sh))
                // Cover without object-fit: size the WHOLE image to cover the cell and
                // clip with the cell. object-fit:cover draws a cropped sub-rect, which
                // skips Chromium's mipmapped downscale → jagged (aliased) lines.
                const r = spreadRatios[images[idx]]
                const style: React.CSSProperties = !r
                  ? fitStyle('contain', half, sh)
                  : r > sh / half
                    ? { width: half, height: Math.round(half * r), maxWidth: 'none', maxHeight: 'none' }
                    : { height: sh, width: Math.round(sh / r), maxWidth: 'none', maxHeight: 'none' }
                return (
                  <div key={idx} className="spread-cell" style={{ width: half, height: sh }}>
                    {img(style)}
                  </div>
                )
              }
            )}
          </div>
          </div>
          <div className="paged-hint left">‹</div>
          <div className="paged-hint right">›</div>
        </div>
      ) : (
        <div className="reader-content paged" ref={contentRef} onClick={onPagedClick} {...pagesTouch}>
          {/* Keep the neighbouring pages mounted (decoded, off-screen) so flipping
              swaps to an already-painted image instead of a fresh <img> that
              decodes on mount → one black frame. Only the current page shows. */}
          <div className="zoom-layer">
          {[pageIdx - 1, pageIdx, pageIdx + 1].map((i) =>
            images[i] ? (
              <PageImage
                key={i}
                className={i === pageIdx ? 'paged-cur' : 'paged-off'}
                src={images[i]}
                style={fitStyle(fit, sw, sh)}
              />
            ) : null
          )}
          </div>
          <div className="paged-hint left">‹</div>
          <div className="paged-hint right">›</div>
        </div>
      )}

      {pullHint && (
        <div className={`edge-pull-hint ${pullHint.dir === 1 ? 'bottom' : 'top'} ${pullHint.ready ? 'ready' : ''}`}>
          {pullHint.ready
            ? `놓으면 ${pullHint.dir === 1 ? '다음화' : '이전화'}`
            : `계속 당기면 ${pullHint.dir === 1 ? '다음화' : '이전화'}`}
        </div>
      )}
      {images.length > 0 && (
        <div
          className={`reader-bottom ${moreOpen ? 'more-open' : ''}`}
          ref={bottomRef}
          onTouchStart={onBarTouchStart}
          onTouchEnd={onBarTouchEnd}
        >
          {/* Custom track: grey base, online pages already loaded in light purple,
              read progress in purple; the native range sits on top (thumb). */}
          <div className="page-slider-wrap">
            <div className="page-track" aria-hidden>
              {online && <div className="page-loaded" style={{ background: loadedTrack }} />}
              <div
                ref={progressRef}
                className="page-progress"
                style={{ width: `calc(${images.length > 1 ? pageIdx / (images.length - 1) : 0} * (100% - 22px) + 11px)` }}
              />
            </div>
            <input
              ref={sliderRef}
              type="range"
              className="page-slider"
              min={0}
              max={images.length - 1}
              step="any"
              value={pageIdx}
              onChange={(e) => goToPage(Math.round(Number(e.target.value)))}
            />
          </div>
          <span className="page-label">
            {pageIdx + 1} / {images.length}
          </span>
          <button
            className={`mini icon reader-more-btn ${moreOpen ? 'on' : ''}`}
            onClick={() => setMoreOpen((o) => !o)}
            title="더보기"
          >
            <MoreVertIcon />
          </button>
          {/* Chapter row (series / online comic): ‹ 현재 화 › centered under the slider. */}
          {chNav && (
            <div className="chapter-nav">
              <button className="ch-btn" disabled={chNav.idx <= 0} onClick={() => chNav.go(-1)} title="이전화">
                <ChevronLeftIcon />
              </button>
              <span className="chapter-pos">
                <b>{chNav.label || `${chNav.idx + 1}화`}</b>
                <span className="chapter-count">
                  {chNav.idx + 1} / {chNav.count}
                </span>
              </span>
              <button
                className="ch-btn"
                disabled={chNav.idx < 0 || chNav.idx >= chNav.count - 1}
                onClick={() => chNav.go(1)}
                title="다음화"
              >
                <ChevronRightIcon />
              </button>
            </div>
          )}
          {/* Extra row (⋮ / swipe up): mode · fit · 넘김. Flat group, dividers. */}
          <div className="reader-more">
            <div className="reader-more-inner">
              <span className="flat-group reader-btns">
                <button
                  className="mini mode-toggle"
                  onClick={() => setMode(mode === 'scroll' ? 'paged' : mode === 'paged' ? 'spread' : 'scroll')}
                >
                  {mode === 'scroll' ? (
                    <>
                      <ScrollModeIcon />
                      <span className="btn-label">스크롤</span>
                    </>
                  ) : mode === 'paged' ? (
                    <>
                      <PageModeIcon />
                      <span className="btn-label">한 페이지</span>
                    </>
                  ) : (
                    <>
                      <SpreadModeIcon />
                      <span className="btn-label">두 페이지</span>
                    </>
                  )}
                </button>
                <button className="mini zoom-btn" onClick={onZoomButton}>
                  {atFit ? (
                    <>
                      {FIT_ICON[fit]}
                      <span className="btn-label">{FIT_TEXT[fit]}</span>
                    </>
                  ) : (
                    <span className="btn-label">{Math.round(zoom * 100)}%</span>
                  )}
                </button>
                <button
                  className="mini flip-btn"
                  onClick={() =>
                    mode === 'scroll'
                      ? setTapFlip({ scrollTapFlip: scrollTapFlip === 'bottom' ? 'off' : 'bottom' })
                      : setTapFlip({ pagedFlipSide: pagedFlipSide === 'left' ? 'right' : 'left' })
                  }
                >
                  <TouchAppIcon />
                  <span className="btn-label">
                    {mode === 'scroll' ? (scrollTapFlip === 'bottom' ? '하단' : 'OFF') : pagedFlipSide === 'left' ? '왼쪽' : '오른쪽'}
                  </span>
                </button>
              </span>
            </div>
          </div>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}
