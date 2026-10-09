import { useState } from 'react'
import type { JSX } from 'react'
import ContextMenu from './ContextMenu'
import { showToast } from '../toast'

// Clickable [code]: a tap copies it ("코드 복사 완료" toast); a long-press opens
// a small popup (작품 번호 복사) instead of the card's own menu.
export default function CopyCode({ code, className = '' }: { code: string; className?: string }): JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const copy = (): void => {
    void window.api.clipboardWriteText(code)
    showToast('코드 복사 완료')
  }
  return (
    <>
      <span
        className={`code copyable ${className}`}
        onClick={(e) => {
          e.stopPropagation()
          copy()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        [{code}]
      </span>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: `작품 번호 복사 (${code})`, onClick: copy }]}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
