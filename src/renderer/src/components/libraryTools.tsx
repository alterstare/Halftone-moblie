// Phone library-screen tools shared by the local library (Home) and the two
// online browses: pull-to-refresh, the floating + button (새로고침 / 작품 선택)
// and multi-select (sticky action bar + a checkbox on every card).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AddIcon, RefreshIcon, ArrowUpIcon, ArrowDownIcon, ChecklistIcon, NumbersIcon, SelectAllIcon, DeselectIcon, CloseIcon, CheckMarkIcon } from './icons'

// ---------- selection ----------

interface SelCtx {
  selecting: boolean
  selected: Set<string>
}
const SelectionCtx = createContext<SelCtx | null>(null)
// Wrap the card list: <SelectionProvider value={sel.ctx}>…</SelectionProvider>
export const SelectionProvider = SelectionCtx.Provider

// Screen side: selection state + the click interceptor for the card list.
export function useSelection(): {
  selecting: boolean
  selected: Set<string>
  start: () => void
  stop: () => void
  setAll: (keys: string[]) => void
  clear: () => void
  // onClickCapture for the list container: while selecting, a tap on a card
  // (anything with data-sel) toggles it instead of opening it.
  capture: (e: React.MouseEvent) => void
  ctx: SelCtx
} {
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const value = useMemo(() => ({ selecting, selected }), [selecting, selected])
  useEffect(() => {
    if (!selecting) return
    const end = (): void => {
      setSelecting(false)
      setSelected(new Set())
    }
    backStack.push(end)
    return () => {
      const i = backStack.indexOf(end)
      if (i >= 0) backStack.splice(i, 1)
    }
  }, [selecting])
  const capture = useCallback(
    (e: React.MouseEvent): void => {
      if (!selecting) return
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-sel]')
      if (!el || !e.currentTarget.contains(el)) return
      e.preventDefault()
      e.stopPropagation()
      const k = el.dataset.sel!
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(k)) n.delete(k)
        else n.add(k)
        return n
      })
    },
    [selecting]
  )
  return {
    selecting,
    selected,
    start: () => {
      setSelected(new Set())
      setSelecting(true)
    },
    stop: () => {
      setSelecting(false)
      setSelected(new Set())
    },
    setAll: (keys) => setSelected(new Set(keys)),
    clear: () => setSelected(new Set()),
    capture,
    ctx: value
  }
}

// Android back while selecting ends the selection (App's back handler asks).
const backStack: (() => void)[] = []
export function popBack(): boolean {
  const f = backStack.pop()
  if (!f) return false
  f()
  return true
}
// While `active`, Android back runs `fn` (once) instead of navigating — e.g.
// leave the online 즐겨찾기 view back to the full list.
export function useBackHandler(active: boolean, fn: () => void): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active) return
    const h = (): void => ref.current()
    backStack.push(h)
    return () => {
      const i = backStack.indexOf(h)
      if (i >= 0) backStack.splice(i, 1)
    }
  }, [active])
}

// The checkbox drawn at a card's top-left while selecting.
export function SelBox({ on }: { on: boolean }): JSX.Element {
  return (
    <span className={`sel-box ${on ? 'on' : ''}`} aria-hidden>
      {on && <CheckMarkIcon />}
    </span>
  )
}

// Card side: data-sel attribute, extra classes and the checkbox (top-left).
export function useSel(key: string): { attr: { 'data-sel': string }; cls: string; box: JSX.Element | null } {
  const c = useContext(SelectionCtx)
  const on = !!c?.selecting && c.selected.has(key)
  return {
    attr: { 'data-sel': key },
    cls: c?.selecting ? (on ? ' sel-mode sel-on' : ' sel-mode') : '',
    box: c?.selecting ? <SelBox on={on} /> : null
  }
}

// Bar fixed to the bottom edge while selecting (portaled — the list
// containers use containment, which would trap position:fixed): 전체 선택 ·
// 선택 해제 on the left, the count, then the action (삭제 / 다운로드) and ×.
export function SelectBar({
  count,
  onAll,
  onNone,
  action,
  onClose
}: {
  count: number
  onAll: () => void
  onNone: () => void
  action: ReactNode
  onClose: () => void
}): JSX.Element {
  // Lists get bottom room so the last card isn't hidden behind the bar.
  useEffect(() => {
    document.body.classList.add('has-sel-bar')
    return () => document.body.classList.remove('has-sel-bar')
  }, [])
  return createPortal(
    <div className="sel-bar">
      <span className="flat-group sel-bar-left">
        <button className="sel-btn" onClick={onAll} title="전체 선택">
          <SelectAllIcon />
        </button>
        <button className="sel-btn" onClick={onNone} title="선택 해제">
          <DeselectIcon />
        </button>
      </span>
      <span className="sel-count">{count}개 선택</span>
      <span className="flat-group sel-bar-right">
        {action}
        <button className="sel-btn" onClick={onClose} title="선택 종료">
          <CloseIcon />
        </button>
      </span>
    </div>,
    document.body
  )
}

// ---------- swipe between 라이브러리 ⇄ 온라인 ----------

// A quick, clearly horizontal swipe on the list switches screens: left → the
// next screen (onLeft), right → the previous (onRight). Ignored when it starts
// on something that scrolls / drags sideways itself.
const SWIPE_SKIP = '.card-more-strip, .chips, .mtab-strip, input, textarea, .search-ac, .page-slider, .ctx-overlay, .taglist-grid.expanded'
// Set just before a swipe navigation; App reads + clears it on the view change.
export const swipeSlide: { dir: 'left' | 'right' | null } = { dir: null }

export function useSwipeNav(
  ref: RefObject<HTMLElement | null>,
  onLeft: (() => void) | null,
  onRight: (() => void) | null,
  enabled = true
): void {
  const cbs = useRef({ onLeft, onRight })
  cbs.current = { onLeft, onRight }
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let s: { x: number; y: number; t: number } | null = null
    const onStart = (e: TouchEvent): void => {
      const t = e.touches[0]
      s =
        e.touches.length === 1 && !(e.target as Element).closest(SWIPE_SKIP)
          ? { x: t.clientX, y: t.clientY, t: Date.now() }
          : null
    }
    const onEnd = (e: TouchEvent): void => {
      const s0 = s
      s = null
      const t = e.changedTouches[0]
      if (!s0 || !t || el.classList.contains('ptr-on')) return
      const dx = t.clientX - s0.x
      const dy = t.clientY - s0.y
      if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - s0.t > 600) return
      // App slides the next screen in from the side the finger moved away from.
      if (dx < 0 && cbs.current.onLeft) {
        swipeSlide.dir = 'left'
        cbs.current.onLeft()
      } else if (dx > 0 && cbs.current.onRight) {
        swipeSlide.dir = 'right'
        cbs.current.onRight()
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
    }
  }, [ref, enabled])
}

// Left-edge drawers (☰ menu, reader list): dragging left on the element moves
// the drawer with the finger (plus `follow` elements, e.g. its edge toggle) and
// fades `fade` (its backdrop). Released past a third of its width, or flicked,
// it slides out and closes; otherwise it springs back. Inline styles only
// during the gesture — on close they're dropped with transitions off, so the
// drawer's own closed state takes over without a second animation.
export function useSwipeClose(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true,
  parts: { drawer?: () => HTMLElement | null; follow?: () => (HTMLElement | null)[]; fade?: () => HTMLElement | null } = {}
): void {
  const cb = useRef({ onClose, parts })
  cb.current = { onClose, parts }
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let s: { x: number; y: number; t: number; lock: 'h' | 'v' | null; dx: number } | null = null
    const els = (): { drawer: HTMLElement; moving: HTMLElement[]; fade: HTMLElement | null } => {
      const p = cb.current.parts
      const drawer = p.drawer?.() ?? el
      return { drawer, moving: [drawer, ...(p.follow?.() ?? []).filter((x): x is HTMLElement => !!x)], fade: p.fade?.() ?? null }
    }
    const paint = (dx: number, anim: string): void => {
      const { drawer, moving, fade } = els()
      for (const m of moving) {
        m.style.transition = anim
        m.style.transform = `translateX(${dx}px)`
      }
      if (fade) {
        fade.style.transition = anim ? anim.replace('transform', 'opacity') : 'none'
        fade.style.opacity = String(Math.max(0, 1 + dx / (drawer.offsetWidth || 1)))
      }
    }
    const clear = (): void => {
      const { moving, fade } = els()
      for (const m of [...moving, ...(fade ? [fade] : [])]) {
        m.style.transform = ''
        m.style.opacity = ''
        m.style.transition = ''
      }
    }
    const onStart = (e: TouchEvent): void => {
      const t = e.touches[0]
      s = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now(), lock: null, dx: 0 } : null
    }
    const onMove = (e: TouchEvent): void => {
      if (!s) return
      const t = e.touches[0]
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (!s.lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        s.lock = dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.5 ? 'h' : 'v'
      }
      if (s.lock !== 'h') return
      e.preventDefault() // the list under the finger doesn't scroll meanwhile
      s.dx = Math.min(0, dx)
      paint(s.dx, 'none')
    }
    const onEnd = (): void => {
      const s0 = s
      s = null
      if (!s0 || s0.lock !== 'h') return
      const w = els().drawer.offsetWidth || 1
      const v = -s0.dx / Math.max(1, Date.now() - s0.t) // px/ms, leftward
      const anim = 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)'
      if (s0.dx < -w / 3 || (s0.dx < -40 && v > 0.5)) {
        paint(-w, anim)
        window.setTimeout(() => {
          const { moving, fade } = els()
          for (const m of [...moving, ...(fade ? [fade] : [])]) m.style.transition = 'none'
          cb.current.onClose()
          // Let React apply the closed state (width 0 / class off) first.
          requestAnimationFrame(() => requestAnimationFrame(clear))
        }, 180)
      } else {
        paint(0, anim)
        window.setTimeout(clear, 200)
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [ref, enabled])
}

// ---------- pull to refresh ----------

// List paging the pulls can step through (same shape as LibraryFab's pager).
export interface PullPager {
  page: number // 0-based
  lastPage: number // -1 = unknown
  onPage: (p: number) => void
}

// Pull the list down from the top and let go: the content follows the finger
// (damped), a round icon appears above it, and past the threshold the action
// runs while the content waits at a small offset, then everything springs back.
// With a `pager`: on page 1 that is 새로고침; on a later page the same pull
// goes to the previous page (↑), and pulling up past the bottom goes to the
// next page (↓, the icon comes up from under the list). Returns the icons
// (render them inside the container).
export function usePullRefresh(
  ref: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown> | void,
  enabled = true,
  pager?: PullPager
): JSX.Element {
  const cb = useRef(onRefresh)
  cb.current = onRefresh
  const pg = useRef(pager)
  pg.current = pager
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    el.classList.add('ptr-host')
    const MAX = 130
    const TRIGGER = 70
    const HOLD = 56
    let y0: number | null = null
    let dir: 1 | -1 | 0 = 0 // 1 = pulling down at the top, -1 = up at the bottom
    let canDown = false
    let canUp = false
    let busy = false
    let d = 0
    let animT = 0
    const atBottom = (): boolean => el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    const apply = (px: number, anim: boolean): void => {
      d = px
      window.clearTimeout(animT)
      el.classList.toggle('ptr-anim', anim)
      el.style.setProperty('--ptr', `${px}px`)
      el.style.setProperty('--ptr-p', String(Math.min(1, Math.abs(px) / TRIGGER)))
      el.classList.toggle('ptr-ready', Math.abs(px) >= TRIGGER)
      if (px !== 0) el.classList.add('ptr-on')
      else if (anim)
        animT = window.setTimeout(() => el.classList.remove('ptr-on', 'ptr-anim', 'ptr-page', 'ptr-up'), 280)
      else el.classList.remove('ptr-on', 'ptr-page', 'ptr-up')
    }
    const onStart = (e: TouchEvent): void => {
      if (busy || e.touches.length !== 1) return
      const p = pg.current
      canDown = el.scrollTop <= 0
      canUp = !!p && (p.lastPage < 0 || p.page < p.lastPage) && atBottom()
      y0 = canDown || canUp ? e.touches[0].clientY : null
      dir = 0
    }
    const onMove = (e: TouchEvent): void => {
      if (y0 == null || e.touches.length !== 1) return
      const dy = e.touches[0].clientY - y0
      if (!dir) {
        if (dy > 6 && canDown && el.scrollTop <= 0) dir = 1
        else if (dy < -6 && canUp && atBottom()) dir = -1
        else {
          if (Math.abs(dy) > 6) y0 = null
          return
        }
        const p = pg.current
        el.classList.toggle('ptr-page', dir === -1 || (!!p && p.page > 0))
        el.classList.toggle('ptr-up', dir === -1)
        // the up-pull icon is fixed to the list's bottom edge
        if (dir === -1) el.style.setProperty('--ptr-bottom', `${el.getBoundingClientRect().bottom}px`)
      }
      if (e.cancelable) e.preventDefault()
      apply(dir * Math.max(0, Math.min(MAX, dir * dy * 0.5)), false)
    }
    const onEnd = (): void => {
      const dir0 = dir
      dir = 0
      y0 = null
      if (!dir0) return
      if (Math.abs(d) < TRIGGER) return apply(0, true)
      const p = pg.current
      // Page step: the list changes under the held offset, then springs back.
      if (dir0 === -1 || (p && p.page > 0)) {
        apply(dir0 * HOLD, true)
        window.setTimeout(() => {
          if (p) p.onPage(p.page + (dir0 === -1 ? 1 : -1))
          el.scrollTop = 0
          apply(0, true)
        }, 160)
        return
      }
      busy = true
      apply(HOLD, true)
      el.classList.add('ptr-busy')
      const started = Date.now()
      Promise.resolve()
        .then(() => cb.current())
        .catch(() => {})
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - started))))) // spinner visible a beat
        .then(() => {
          el.classList.remove('ptr-busy')
          apply(0, true)
          busy = false
        })
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
      el.classList.remove('ptr-host', 'ptr-on', 'ptr-anim', 'ptr-busy', 'ptr-page', 'ptr-up', 'ptr-ready')
    }
  }, [ref, enabled])
  return (
    <div className="ptr-spin" aria-hidden>
      <RefreshIcon />
      <ArrowUpIcon />
      <ArrowDownIcon />
    </div>
  )
}

// ---------- floating + button ----------

// Round + at the bottom right (portaled, shown only while `active`). Hides on
// scroll down, comes back on scroll up. Tap → a menu rises above it.
export function LibraryFab({
  active,
  scrollRef,
  onRefresh,
  onSelect,
  pager
}: {
  active: boolean
  scrollRef: RefObject<HTMLElement | null>
  onRefresh: () => void
  onSelect: () => void
  // 페이지 이동: the screen's list paging (0-based; lastPage -1 = unknown).
  pager?: { page: number; lastPage: number; onPage: (p: number) => void }
}): JSX.Element | null {
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
  const [jump, setJump] = useState<string | null>(null) // 페이지 이동 dialog input
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !active) return
    let last = el.scrollTop
    const onScroll = (): void => {
      const t = el.scrollTop
      if (Math.abs(t - last) < 6) return
      setHidden(t > last && t > 40)
      if (t > last) setOpen(false)
      last = t
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef, active])
  useEffect(() => {
    if (!active) setOpen(false)
  }, [active])
  // Open drop-up: any touch / drag elsewhere closes it. A drag still scrolls the
  // list (no blocking scrim); a plain tap only closes (its click is swallowed).
  useEffect(() => {
    if (!open) return
    const inside = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('.fab-wrap')
    const swallow = (e: MouseEvent): void => {
      e.stopPropagation()
      e.preventDefault()
    }
    const down = (e: PointerEvent): void => {
      if (inside(e.target)) return
      const x = e.clientX
      const y = e.clientY
      setOpen(false)
      // (registered outside the effect: closing unmounts the effect first)
      const up = (u: PointerEvent): void => {
        done()
        if (u.type !== 'pointerup' || Math.abs(u.clientX - x) >= 10 || Math.abs(u.clientY - y) >= 10) return
        window.addEventListener('click', swallow, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400)
      }
      const done = (): void => {
        window.removeEventListener('pointerup', up, true)
        window.removeEventListener('pointercancel', up, true)
      }
      window.addEventListener('pointerup', up, true)
      window.addEventListener('pointercancel', up, true)
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [open])
  if (!active) return null
  const pick = (fn: () => void) => (): void => {
    setOpen(false)
    fn()
  }
  return createPortal(
    <>
      <div className={`fab-wrap ${hidden && !open ? 'fab-hidden' : ''}`}>
        <div className={`fab-menu ${open ? 'open' : ''}`}>
          <button className="fab-item" onClick={pick(onRefresh)}>
            <RefreshIcon />
            <span>새로고침</span>
          </button>
          <button className="fab-item" onClick={pick(onSelect)}>
            <ChecklistIcon />
            <span>작품 선택</span>
          </button>
          {pager && (
            <button className="fab-item" onClick={pick(() => setJump(String(pager.page + 1)))}>
              <NumbersIcon />
              <span>페이지 이동</span>
            </button>
          )}
        </div>
        <button className={`fab ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} title="메뉴">
          <AddIcon />
        </button>
      </div>
      {jump !== null && pager && (
        <div className="exit-backdrop" onClick={() => setJump(null)}>
          <div className="exit-modal compact page-jump" onClick={(e) => e.stopPropagation()}>
            <h3 className="exit-title">
              페이지 이동
              <span className="page-jump-info">
                {pager.lastPage >= 0 ? `총 ${pager.lastPage + 1}페이지, ` : ''}현재 {pager.page + 1}페이지
              </span>
            </h3>
            <form
              className="page-jump-row"
              onSubmit={(e) => {
                e.preventDefault()
                const n = parseInt(jump, 10)
                if (isNaN(n)) return
                const max = pager.lastPage >= 0 ? pager.lastPage + 1 : n
                pager.onPage(Math.max(1, Math.min(max, n)) - 1)
                setJump(null)
              }}
            >
              <input
                className="field-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={pager.lastPage >= 0 ? pager.lastPage + 1 : undefined}
                autoFocus
                value={jump}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setJump(e.target.value)}
              />
            </form>
            <div className="exit-actions">
              <button className="exit-btn ghost" onClick={() => setJump(null)}>
                취소
              </button>
              <button
                className="exit-btn primary"
                onClick={() => (document.querySelector('.page-jump-row') as HTMLFormElement | null)?.requestSubmit()}
              >
                이동
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
