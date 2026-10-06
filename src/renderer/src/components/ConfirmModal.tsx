import { useEffect } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'

// 삭제 confirm title: "작품 '<name>'" clamped to 2 lines (a long folder name
// ends in …), then the rest of the question on its own line.
export function DelTitle({ name, rest }: { name: string; rest: string }): JSX.Element {
  return (
    <>
      <span className="exit-name">작품 '{name}'</span>
      {rest}
    </>
  )
}

// Generic styled confirm dialog (shares the exit-modal look). Used for group
// move (유지/옮김) and group delete (삭제/취소).
export default function ConfirmModal({
  title,
  desc,
  icon = '？',
  confirmLabel,
  cancelLabel = '취소',
  altLabel,
  danger = false,
  hideCancel = false,
  compact = false,
  onConfirm,
  onCancel,
  onAlt
}: {
  title: React.ReactNode
  desc?: React.ReactNode
  icon?: string
  confirmLabel: string
  cancelLabel?: string
  altLabel?: string // optional middle action (e.g. "저장 안 함")
  danger?: boolean
  hideCancel?: boolean // single-button info dialog
  // Plain text dialog: no icon, left-aligned text, the actions as small text
  // buttons (desc-sized) at the bottom right.
  compact?: boolean
  onConfirm: () => void
  onCancel: () => void
  onAlt?: () => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  // Portaled: cards use content-visibility (containment), which would trap a
  // position:fixed dialog rendered inside them.
  return createPortal(
    <div className="exit-backdrop" onClick={(e) => { e.stopPropagation(); onCancel() }}>
      <div className={`exit-modal ${compact ? 'compact' : ''}`} onClick={(e) => e.stopPropagation()}>
        {!compact && <div className={`exit-icon ${danger ? 'danger' : ''}`}>{icon}</div>}
        <h3 className="exit-title">{title}</h3>
        {desc && <p className="exit-desc">{desc}</p>}
        <div className="exit-actions">
          <button
            className={`exit-btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          {altLabel && onAlt && (
            <button className="exit-btn ghost" onClick={onAlt}>
              {altLabel}
            </button>
          )}
          {!hideCancel && (
            <button className="exit-btn ghost" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
