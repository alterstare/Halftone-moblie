import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore, useSeriesRoots } from '../store'
import type { Tab } from '../store'
import { useLock } from '../lock'
import { groupSeries, analyzeSeries } from '../util'
import { getFavSummary, useFavSummaries } from '../favSummaries'
import Thumb from './Thumb'
import OnlineThumb from './OnlineThumb'
import { HomeIcon, LanguageIcon, MenuIcon, CloseIcon } from './icons'

// Phone tab bar (replaces the desktop TabBar): ☰ · 라이브러리 · 온라인, then the
// open tabs as a strip that shows ONE tab at a time — swipe left/right to look
// through them (swiping never switches tabs; tap one to open it) — and, at the
// right end, a Chrome-mobile style tab-count button that opens the tab grid.
// Mode switching, 작업 목록 and 설정 live in the ☰ menu only.

// Display title of a tab: "n화 · 시리즈" for general-manga chapters (local and
// manga-site), the work title otherwise.
export function useTabTitles(): (t: Tab) => string {
  const works = useStore((s) => s.works)
  const chapterScheme = useStore((s) => s.settings.normalChapterScheme)
  const normalRoots = useSeriesRoots()
  const workById = useMemo(() => new Map(works.map((w) => [w.id, w])), [works])
  const normalLabels = useMemo(() => {
    const map = new Map<string, { series: string; label: string }>()
    const normal = works.filter((w) => (w.library ?? 'doujin') === 'normal')
    for (const g of groupSeries(normal, normalRoots)) {
      for (const ci of analyzeSeries(g.chapters, g.title, chapterScheme)) {
        map.set(ci.work.id, { series: g.title, label: ci.label })
      }
    }
    return map
  }, [works, normalRoots, chapterScheme])
  return (t: Tab): string => {
    if (t.online) {
      const o = t.online
      return o.chapterLabel && !o.title.includes(o.chapterLabel) ? `${o.chapterLabel} · ${o.title}` : o.title
    }
    const w = workById.get(t.workId)
    if (!w) return '(삭제됨)'
    const info = normalLabels.get(w.id)
    return info && info.series ? `${info.label} · ${info.series}` : w.title
  }
}

// Tabs of the current library mode (glance tabs never show in the bar).
function useModeTabs(): Tab[] {
  const tabs = useStore((s) => s.tabs)
  const libraryMode = useStore((s) => s.libraryMode)
  return useMemo(() => tabs.filter((t) => !t.glance && (t.mode ?? 'doujin') === libraryMode), [tabs, libraryMode])
}

export default function MobileTabBar(): JSX.Element {
  const view = useStore((s) => s.view)
  const activeTabId = useStore((s) => s.activeTabId)
  const decoy = useLock((s) => s.decoy)
  const closingTabs = useStore((s) => s.closingTabs)
  const activateTab = useStore((s) => s.activateTab)
  const startClose = useStore((s) => s.requestCloseTab)
  const switcherOpen = useStore((s) => s.tabSwitcherOpen)
  const setSwitcherOpen = useStore((s) => s.setTabSwitcherOpen)
  const tabs = useModeTabs()
  const titleOf = useTabTitles()
  const stripRef = useRef<HTMLDivElement>(null)

  // Newly opened tabs animate in. Ids seen on the previous render; the first
  // render (app start / session restore) doesn't animate. A new tab is first
  // held invisible ('pre'), and the animation starts two frames later: opening
  // a tab mounts the reader in the same frame (the very first one also mounts
  // the list pane — a long frame), which would otherwise eat the animation.
  const seenIds = useRef<Set<string> | null>(null)
  const [entering, setEntering] = useState<Map<string, 'pre' | 'in'>>(new Map())
  useLayoutEffect(() => {
    const cur = new Set(tabs.map((t) => t.id))
    const seen = seenIds.current
    seenIds.current = cur
    if (!seen) return
    const added = [...cur].filter((id) => !seen.has(id))
    if (!added.length) return
    const put = (v: 'pre' | 'in' | null): void =>
      setEntering((m) => {
        const n = new Map(m)
        for (const id of added) v ? n.set(id, v) : n.delete(id)
        return n
      })
    put('pre')
    // Not cancelled on re-run: `tabs` changes often (scroll position etc.).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        put('in')
        setTimeout(() => put(null), 320)
      })
    )
  }, [tabs])

  // Tab grid: stays mounted for its close animation after the store closes it
  // (✕, a card tap or Android back).
  const [switcherShown, setSwitcherShown] = useState(switcherOpen)
  const [switcherClosing, setSwitcherClosing] = useState(false)
  useEffect(() => {
    if (switcherOpen) {
      setSwitcherShown(true)
      setSwitcherClosing(false)
      return
    }
    if (!switcherShown) return
    setSwitcherClosing(true)
    const timer = setTimeout(() => {
      setSwitcherShown(false)
      setSwitcherClosing(false)
    }, 170)
    return () => clearTimeout(timer)
  }, [switcherOpen])

  // Keep the active tab in view (after opening / switching, or when the bar
  // first shows it). Swiping only scrolls, so this never fights the user.
  useEffect(() => {
    const strip = stripRef.current
    const el = strip?.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`)
    if (!strip || !el) return
    // After layout (a just-opened tab is in the DOM but may not be measured yet).
    requestAnimationFrame(() => {
      const left = el.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft
      strip.scrollTo({ left, behavior: 'smooth' })
    })
  }, [activeTabId, tabs.length, view])

  const st = useStore.getState
  return (
    <>
      <div className="tabbar mtabbar">
        <button className="tab menu-btn" onClick={() => st().setMenuOpen(!st().menuOpen)} title="메뉴">
          <MenuIcon />
        </button>
        <button className={`tab home-tab ${view === 'home' ? 'active' : ''}`} onClick={() => st().goHome()} title="라이브러리">
          <HomeIcon />
        </button>
        {!decoy && (
          <button className={`tab icon-tab ${view === 'browse' ? 'active' : ''}`} onClick={() => st().goBrowse()} title="온라인">
            <LanguageIcon />
          </button>
        )}
        <div className="mtab-strip" ref={stripRef}>
          {tabs.map((t) => (
            <div
              key={t.id}
              data-tab-id={t.id}
              className={`mtab ${view === 'reader' && activeTabId === t.id ? 'active' : ''} ${
                closingTabs.includes(t.id) ? 'closing' : ''
              } ${entering.get(t.id) === 'pre' ? 'pre-enter' : entering.get(t.id) === 'in' ? 'entering' : ''}`}
              onClick={() => activateTab(t.id)}
            >
              {t.online && (
                <span className="tab-online-dot">
                  <LanguageIcon />
                </span>
              )}
              <span className="tab-title">{titleOf(t)}</span>
              <span
                className="tab-close"
                title="탭 닫기"
                onClick={(e) => {
                  e.stopPropagation()
                  startClose(t.id)
                }}
              >
                <CloseIcon />
              </span>
            </div>
          ))}
        </div>
        <button className="tab icon-tab mtab-count" onClick={() => setSwitcherOpen(true)} title="탭 목록">
          <span className="mtab-count-box">{tabs.length > 99 ? ':D' : tabs.length}</span>
        </button>
      </div>
      {switcherShown && <TabSwitcher closing={switcherClosing} onClose={() => setSwitcherOpen(false)} />}
    </>
  )
}

// Chrome-mobile style tab grid: two columns of cards — a colored frame with the
// title + × on it and the work's cover inset below (the open tab's frame is the
// accent color). Tap a card to open that tab.
function TabSwitcher({ closing, onClose }: { closing: boolean; onClose: () => void }): JSX.Element {
  const view = useStore((s) => s.view)
  const activeTabId = useStore((s) => s.activeTabId)
  const onlineHistory = useStore((s) => s.onlineHistory)
  const activateTab = useStore((s) => s.activateTab)
  const startClose = useStore((s) => s.requestCloseTab)
  const closingTabs = useStore((s) => s.closingTabs)
  const tabs = useModeTabs()
  const titleOf = useTabTitles()
  // Doujin online tabs: cover from the cached gallery summary.
  useFavSummaries(tabs.filter((t) => t.online && t.online.kind !== 'comic').map((t) => t.online!.code))

  const cover = (t: Tab): JSX.Element => {
    if (!t.online) return <Thumb workId={t.workId} />
    const o = t.online
    const url =
      o.kind === 'comic'
        ? (o.thumb ?? onlineHistory[o.seriesUrl ?? o.code]?.thumbUrl ?? null)
        : (getFavSummary(o.code)?.thumbUrl ?? onlineHistory[o.code]?.thumbUrl ?? null)
    return <OnlineThumb className="mtcard-thumb" thumbUrl={url} />
  }

  return (
    <div className={`mtswitch ${closing ? 'closing' : ''}`}>
      <div className="mtswitch-head">
        <b>탭 {tabs.length}개</b>
        <button className="icon-close" onClick={onClose} title="닫기">
          <CloseIcon />
        </button>
      </div>
      {tabs.length === 0 ? (
        <div className="empty">열린 탭이 없습니다.</div>
      ) : (
        <div className="mtswitch-grid">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`mtcard ${view === 'reader' && activeTabId === t.id ? 'active' : ''} ${
                closingTabs.includes(t.id) ? 'closing' : ''
              }`}
              onClick={() => {
                activateTab(t.id)
                onClose()
              }}
            >
              <div className="mtcard-head">
                {t.online && (
                  <span className="tab-online-dot">
                    <LanguageIcon />
                  </span>
                )}
                <span className="mtcard-title">{titleOf(t)}</span>
                <span
                  className="mtcard-close"
                  title="탭 닫기"
                  onClick={(e) => {
                    e.stopPropagation()
                    startClose(t.id)
                  }}
                >
                  <CloseIcon />
                </span>
              </div>
              <div className="mtcard-img">{cover(t)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
