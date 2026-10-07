import { useRef } from 'react'
import type { JSX, ReactNode } from 'react'
import { useStore } from '../store'
import { useLock } from '../lock'
import { useSwipeClose } from './libraryTools'
import { HomeIcon, LanguageIcon, MenuIcon, SettingsIcon, DownloadIcon, FavoriteIcon, AssignmentIcon, HistoryIcon, CompareArrowsIcon } from './icons'

// Left slide-in navigation drawer (☰). Surfaces every screen plus the
// doujin ⇄ general-manga mode toggle. Existing tab-bar buttons still work; this
// is an additional, consolidated entry point. Width is narrow and the rest of
// the window stays visible behind a transparent click-catcher that closes it.
function Item({
  icon,
  label,
  active,
  onClick,
  className
}: {
  icon: ReactNode
  label: string
  active?: boolean
  onClick: () => void
  className?: string
}): JSX.Element {
  return (
    <button className={`menu-item ${active ? 'active' : ''} ${className ?? ''}`} onClick={onClick}>
      <span className="menu-item-ico">{icon}</span>
      <span className="menu-item-label">{label}</span>
    </button>
  )
}

export default function MenuDrawer(): JSX.Element {
  const open = useStore((s) => s.menuOpen)
  const setMenuOpen = useStore((s) => s.setMenuOpen)
  const view = useStore((s) => s.view)
  const libraryMode = useStore((s) => s.libraryMode)
  const decoy = useLock((s) => s.decoy)
  const setLibraryMode = useStore((s) => s.setLibraryMode)
  const goHome = useStore((s) => s.goHome)
  const goBrowse = useStore((s) => s.goBrowse)
  const goDownload = useStore((s) => s.goDownload)
  const goManage = useStore((s) => s.goManage)
  const goSettings = useStore((s) => s.goSettings)
  const goHistory = useStore((s) => s.goHistory)
  const setFilter = useStore((s) => s.setFilter)
  const setSort = useStore((s) => s.setSort)
  const setSearch = useStore((s) => s.setSearch)
  const defaultSort = useStore((s) => s.settings.defaultSort)

  const close = (): void => setMenuOpen(false)
  // Swipe left anywhere on the open menu (drawer or the dimmed side) closes it.
  const rootRef = useRef<HTMLDivElement>(null)
  useSwipeClose(rootRef, close, open, {
    drawer: () => rootRef.current?.querySelector<HTMLElement>('.menu-drawer') ?? null,
    fade: () => rootRef.current?.querySelector<HTMLElement>('.menu-overlay') ?? null
  })
  const go = (fn: () => void): void => {
    fn()
    close()
  }
  // "라이브러리" must always land on the default home — reset any active filter /
  // search / sort left over from 즐겨찾기 or 최근 본.
  const libraryClick = (): void =>
    go(() => {
      setSearch('')
      setSort(defaultSort)
      setFilter({ kind: 'all' })
      goHome()
    })

  const normal = libraryMode === 'normal'
  // Both modes route to the browse view; App renders ComicBrowse in normal mode,
  // doujin Browse otherwise.
  const onlineClick = (): void => go(goBrowse)

  return (
    <div ref={rootRef} className={`menu-root ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="menu-overlay" onClick={close} />
      <nav className="menu-drawer">
        <div className="menu-head">
          <button className="menu-close" onClick={close}>
            <MenuIcon />
          </button>
          <span className="menu-brand">메뉴</span>
        </div>

        <button
          className="menu-mode"
          onClick={() =>
            go(() => setLibraryMode(normal ? 'doujin' : 'normal'))
          }
        >
          <span className="menu-item-ico"><CompareArrowsIcon /></span>
          <span className="menu-mode-label">{normal ? '동인지 뷰어로 전환' : '일반 만화 뷰어로 전환'}</span>
        </button>
        <div className="menu-mode-cur">현재: {normal ? '일반 만화' : '동인지'}</div>

        <div className="menu-sep" />
        <Item icon={<HomeIcon />} label="라이브러리" active={view === 'home'} onClick={libraryClick} />
        {!decoy && <Item icon={<LanguageIcon />} label="온라인" active={view === 'browse'} onClick={onlineClick} />}
        <Item className="menu-fav" icon={<FavoriteIcon />} label="즐겨찾기" onClick={() => go(() => setFilter({ kind: 'favorites' }))} />
        {/* 기록: everything viewed — local and online — in the library layout. */}
        <Item
          icon={<HistoryIcon />}
          label="기록"
          active={view === 'history'}
          onClick={() =>
            go(() => {
              setSearch('')
              setFilter({ kind: 'all' })
              goHistory()
            })
          }
        />

        <div className="menu-sep" />
        <Item icon={<DownloadIcon />} label="작업 목록" active={view === 'download'} onClick={() => go(goDownload)} />
        <Item icon={<AssignmentIcon />} label="관리" active={view === 'manage'} onClick={() => go(() => goManage('duplicates'))} />
        <Item icon={<SettingsIcon />} label="설정" active={view === 'settings'} onClick={() => go(goSettings)} />
      </nav>
    </div>
  )
}
