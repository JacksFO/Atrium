import { useEffect, useRef, useState } from 'react'
import { Over } from './Over'
import { CREDIT, searchGifs, type Gif, type GifPage } from '../lib/gifs'
import type { Api } from '../lib/api'
import { Icon } from './Icon'
import type { Anchor } from './useAnchored'

/**
 * The GIF panel.
 *
 * Searches are debounced rather than sent per keystroke — the provider's
 * quota is shared by everybody on this server, and the route rate-limits
 * regardless, so a panel that asks on every letter spends the allowance on
 * prefixes of what somebody meant.
 */
export function GifPicker({ server, onPick, onClose, anchor }: {
  server: Api
  onPick: (g: Gif) => void
  onClose: () => void
  /** The button it was opened from, in the window's own coordinates. */
  anchor: Anchor
}) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState<GifPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ left: -9999, top: -9999 })

  useEffect(() => { input.current?.focus() }, [])

  /*
   * Placed against the window, because it is drawn on the window.
   *
   * This was `right:20px;bottom:100%`, which is measured from whatever the
   * panel's offset parent happens to be — and once it went through a portal
   * that became the page itself. `bottom:100%` then means the whole height of
   * the document above the top of it, so the panel was drawn entirely off the
   * top of the screen: pressing the GIF button dimmed everything and showed
   * nothing, which reads as a button that half works.
   */
  useEffect(() => {
    const el = box.current
    if (!el) return
    const pad = 10
    const { width, height } = el.getBoundingClientRect()
    /* Above the button where there is room, below where there is not — it is
       opened from the message box, which is at the bottom of the screen. */
    const above = anchor.y - height - 8
    setAt({
      left: Math.max(pad, Math.min(anchor.x - width + anchor.w, window.innerWidth - width - pad)),
      top: above >= pad ? above : Math.min(anchor.y + anchor.h + 8, window.innerHeight - height - pad),
    })
  }, [anchor.x, anchor.y, anchor.w, anchor.h, loading])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    /* Long enough that typing a word is one search, short enough that it
       does not feel like waiting for one. */
    const timer = setTimeout(() => {
      searchGifs(server, q)
        .then((p) => { if (alive) { setPage(p); setLoading(false) } })
        .catch((e: unknown) => {
          if (!alive) return
          setLoading(false)
          /* The provider's hourly budget is shared and it refills, so being
             out of it is not a broken server and should not read as one. The
             route says as much; this shows what it said. */
          setError(e instanceof Error ? e.message : 'GIF search is unavailable right now')
        })
    }, 280)
    return () => { alive = false; clearTimeout(timer) }
  }, [server, q])

  const credit = page?.provider ? CREDIT[page.provider] : null

  return (
    <Over>
      {/* Catches the click that closes this, and nothing else — it must not
          dim or blur, which is what the plain scrim does. */}
      <div className="scrim bare" onClick={onClose} />
      <div className="gifs" ref={box}
        style={{ '--px': `${at.left}px`, '--py': `${at.top}px` } as React.CSSProperties}>
        <div className="gifh">
          <input
            ref={input}
            placeholder="Search GIFs"
            value={q}
            autoComplete="off"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
          />
          <button className="icb" onClick={onClose} title="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        {error && <p className="hint">{error}</p>}
        {!error && page?.provider === null && (
          <p className="hint">This server has no GIF provider set up.</p>
        )}
        {!error && loading && !page?.gifs.length && <p className="hint">Looking…</p>}
        {!error && !loading && page?.provider && !page.gifs.length && (
          <p className="hint">Nothing found.</p>
        )}

        {!!page?.gifs.length && (
          <div className="gifgrid">
            {page.gifs.map((g) => (
              <button
                key={g.id}
                className="gifcell"
                title={g.description || 'GIF'}
                onClick={() => onPick(g)}
              >
                {/* Moving before it is picked, and taking up its final room
                    before anything has loaded — the shape comes back with the
                    search, so nothing below a cell jumps as they arrive. */}
                {g.mp4 ? (
                  <video
                    style={{ aspectRatio: ratio(g) }}
                    src={g.mp4}
                    poster={g.still || undefined}
                    autoPlay muted loop playsInline tabIndex={-1}
                  />
                ) : (
                  <img style={{ aspectRatio: ratio(g) }} src={g.still || g.preview} alt=""
                    loading="lazy" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Not decoration: both providers require to be named wherever their
            results are shown, and the search is theirs — this server holds the
            key and asks on your behalf. */}
        {credit && (page?.provider === 'klipy' ? (
          <a className="gifcr" href="https://klipy.com" target="_blank" rel="noopener noreferrer">
            <img src="/klipy/powered-by-klipy-white.svg" alt="Powered by KLIPY" />
          </a>
        ) : (
          <p className="gifcr">Powered by {credit}</p>
        ))}
      </div>
    </Over>
  )
}

const ratio = (g: Gif) => (g.width && g.height ? `${g.width} / ${g.height}` : '1 / 1')
