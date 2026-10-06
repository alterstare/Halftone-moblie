import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import EditionsPanel from './EditionsPanel'
import { TranslateIcon } from './icons'

// 더보기 panel under a list card (phone): an optional 다른 언어 작품 찾기 button
// (the search only starts when pressed) and a 3×3 page preview that pages
// sideways — swipe inside it for pages 1–9, 10–18, … Clicks inside never reach
// the card (which would open the work).
const PER = 9

export default function CardMore({
  getImgs,
  editions
}: {
  getImgs: () => Promise<string[]>
  // Doujin works only: what the editions finder searches with.
  editions?: { code: string | null; artist: string | null; title: string; language?: string | null }
}): JSX.Element {
  const [imgs, setImgs] = useState<string[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [cur, setCur] = useState(0)
  const [edOpen, setEdOpen] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)
  const loader = useRef(getImgs)
  loader.current = getImgs

  useEffect(() => {
    let alive = true
    loader
      .current()
      .then((l) => alive && setImgs(l))
      .catch((e) => alive && setErr(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [])

  const pages = imgs ? Math.max(1, Math.ceil(imgs.length / PER)) : 0
  const onScroll = (): void => {
    const el = stripRef.current
    if (el && el.clientWidth) setCur(Math.round(el.scrollLeft / el.clientWidth))
  }

  return (
    <div
      className="card-more"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {editions && (
        <>
          <button className={`card-more-ed ${edOpen ? 'on' : ''}`} onClick={() => setEdOpen((o) => !o)}>
            <TranslateIcon />
            <span>다른 언어 작품 찾기</span>
          </button>
          {edOpen && (
            <EditionsPanel
              inline
              code={editions.code}
              artist={editions.artist}
              title={editions.title}
              language={editions.language ?? null}
            />
          )}
        </>
      )}
      {err ? (
        <div className="card-more-msg">미리보기를 불러오지 못했습니다.</div>
      ) : !imgs ? (
        <div className="card-more-msg">미리보기 불러오는 중…</div>
      ) : imgs.length === 0 ? (
        <div className="card-more-msg">페이지가 없습니다.</div>
      ) : (
        <>
          <div className="card-more-strip" ref={stripRef} onScroll={onScroll}>
            {Array.from({ length: pages }, (_, p) => (
              <div className="card-more-page" key={p}>
                {/* Only the current page and its neighbours load their images. */}
                {Math.abs(p - cur) <= 1 &&
                  imgs.slice(p * PER, p * PER + PER).map((src, i) => (
                    <div className="card-more-cell" key={i}>
                      <img src={src} alt="" loading="lazy" decoding="async" />
                      <span className="card-more-num">{p * PER + i + 1}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
          <div className="card-more-pos">
            {cur * PER + 1}–{Math.min(imgs.length, cur * PER + PER)} / {imgs.length}
          </div>
        </>
      )}
    </div>
  )
}
