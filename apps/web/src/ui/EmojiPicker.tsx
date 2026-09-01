import { useEffect, useRef, useState } from 'react'
import { Over } from './Over'
import { groupsFor } from '../lib/emoji'
import type { Anchor } from './useAnchored'

/**
 * The emoji, to pick one from.
 *
 * Placed against whatever opened it, measured after it is drawn. The old
 * client positioned this with `right: 290px` — the member list's width plus a
 * gap, a number that was true of one layout and stopped being true the moment
 * panels could be resized, reordered or hidden. On a narrow window it put the
 * panel off the side of the screen and gave the whole app something to scroll
 * sideways.
 */
export function EmojiPicker({ anchor, forReaction = false, onPick, onClose }: {
  anchor: Anchor
  /** Changes only the wording: reacting and writing are the same choice. */
  forReaction?: boolean
  onPick: (glyph: string, name: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [at, setAt] = useState({ left: anchor.x, top: anchor.y })

  useEffect(() => { input.current?.focus() }, [])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const pad = 10
    const { width, height } = el.getBoundingClientRect()
    /* Above whatever opened it where there is room, below where there is not
       — a picker that always opens downwards falls off the bottom when it is
       opened from the message box, which is where it usually is. */
    const above = anchor.y - height - 8
    setAt({
      left: Math.max(pad, Math.min(anchor.x, window.innerWidth - width - pad)),
      top: above >= pad ? above : Math.min(anchor.y + 24, window.innerHeight - height - pad),
    })
  }, [anchor.x, anchor.y])

  const groups = groupsFor(q)

  return (
    <Over>
      {/* Catches the click that closes this, and nothing else — it must not
          dim or blur, which is what the plain scrim does. */}
      <div className="scrim bare" onClick={onClose} />
      <div className="emoji" ref={box}
        style={{ '--px': `${at.left}px`, '--py': `${at.top}px` } as React.CSSProperties}>
        <input
          ref={input}
          placeholder={forReaction ? 'React with…' : 'Search emoji'}
          value={q}
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            /* Enter takes the first match, so a name typed in full does not
               then need finding again with the mouse. */
            if (e.key === 'Enter') {
              const first = groups[0]?.[1][0]
              if (first) { e.preventDefault(); onPick(first[1], first[0]) }
            }
          }}
        />
        <div className="escroll">
          {groups.map(([group, list]) => (
            <div key={group}>
              <p className="hd2">{group}</p>
              <div className="gr">
                {list.map(([name, glyph]) => (
                  <button key={name} title={`:${name}:`} onClick={() => onPick(glyph, name)}>
                    {glyph}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && (
            <p className="hint" style={{ padding: '4px 2px' }}>Nothing by that name.</p>
          )}
        </div>
      </div>
    </Over>
  )
}
