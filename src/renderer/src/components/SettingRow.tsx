import type { JSX, ReactNode } from 'react'

// One settings line: bold title + gray description on the left, the control on the
// right. Matches the redesigned settings look. A plain-text description is shown
// one sentence per line, so long ones don't wrap at random points. `stack` puts
// the controls on their own line under the text on narrow screens (rows with
// several buttons).
export default function SettingRow({
  title,
  desc,
  stack,
  children
}: {
  title: ReactNode
  desc?: ReactNode
  stack?: boolean
  children?: ReactNode
}): JSX.Element {
  return (
    <div className={stack ? 'set-row stack' : 'set-row'}>
      <div className="set-main">
        <div className="set-title">{title}</div>
        {desc && (
          <div className="set-desc">
            {typeof desc === 'string'
              ? desc.split(/(?<=\.|\.\))\s+(?=\S)/).map((line, i) => (
                  <span key={i} className="set-line">
                    {line}
                  </span>
                ))
              : desc}
          </div>
        )}
      </div>
      {children != null && <div className="set-ctl">{children}</div>}
    </div>
  )
}
