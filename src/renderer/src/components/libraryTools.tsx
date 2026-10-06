// Phone library-screen tools shared by the local library (Home) and the two
// online browses: pull-to-refresh, the floating + button (새로고침 / 작품 선택)
// and multi-select (sticky action bar + a checkbox on every card).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AddIcon, RefreshIcon, ChecklistIcon, SelectAllIcon, DeselectIcon, CloseIcon, CheckMarkIcon } from './icons'

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

// ---------- pull to refresh ----------

// Pull the list down from the top and let go: the content follows the finger
// (damped), a spinner appears above the search box, and past the threshold the
// refresh runs while the content waits at a small offset, then everything
// springs back. Returns the spinner element (render it inside the container).
export function usePullRefresh(
  ref: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown> | void,
  enabled = true
): JSX.Element {
  const cb = useRef(onRefresh)
  cb.current = onRefresh
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    el.classList.add('ptr-host')
    const MAX = 130
    const TRIGGER = 70
    const HOLD = 56
    let y0: number | null = null
    let pulling = false
    let busy = false
    let d = 0
    let animT = 0
    const apply = (px: number, anim: boolean): void => {
      d = px
      window.clearTimeout(animT)
      el.classList.toggle('ptr-anim', anim)
      el.style.setProperty('--ptr', `${px}px`)
      el.style.setProperty('--ptr-p', String(Math.min(1, px / TRIGGER)))
      if (px > 0) el.classList.add('ptr-on')
      else if (anim) animT = window.setTimeout(() => el.classList.remove('ptr-on', 'ptr-anim'), 280)
      else el.classList.remove('ptr-on')
    }
    const onStart = (e: TouchEvent): void => {
      if (busy || e.touches.length !== 1) return
      y0 = el.scrollTop <= 0 ? e.touches[0].clientY : null
      pulling = false
    }
    const onMove = (e: TouchEvent): void => {
      if (y0 == null || e.touches.length !== 1) return
      const dy = e.touches[0].clientY - y0
      if (!pulling) {
        if (dy > 6 && el.scrollTop <= 0) pulling = true
        else if (dy < 0) {
          y0 = null
          return
        } else return
      }
      if (e.cancelable) e.preventDefault()
      apply(Math.max(0, Math.min(MAX, dy * 0.5)), false)
    }
    const onEnd = (): void => {
      if (!pulling) {
        y0 = null
        return
      }
      pulling = false
      y0 = null
      if (d < TRIGGER) return apply(0, true)
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
      el.classList.remove('ptr-host', 'ptr-on', 'ptr-anim', 'ptr-busy')
    }
  }, [ref, enabled])
  return (
    <div className="ptr-spin" aria-hidden>
      <RefreshIcon />
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
  onSelect
}: {
  active: boolean
  scrollRef: RefObject<HTMLElement | null>
  onRefresh: () => void
  onSelect: () => void
}): JSX.Element | null {
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
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
  if (!active) return null
  const pick = (fn: () => void) => (): void => {
    setOpen(false)
    fn()
  }
  return createPortal(
    <>
      {open && <div className="fab-scrim" onPointerDown={() => setOpen(false)} />}
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
        </div>
        <button className={`fab ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} title="메뉴">
          <AddIcon />
        </button>
      </div>
    </>,
    document.body
  )
}
