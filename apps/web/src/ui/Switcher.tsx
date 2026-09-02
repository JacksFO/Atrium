import { useEffect, useMemo, useRef, useState } from 'react'
import { Over } from './Over'
import { moved, SIGIL, switcherMatches, type Target } from '../lib/switcher'

/**
 * Get anywhere by typing three letters of its name.
 *
 * The way a busy app stops feeling like a filing cabinet. Everything in here
 * is reachable by clicking too - the point is that reaching it costs a
 * gesture rather than a hunt through a list of servers, then a list of
 * channels, then a scroll.
 *
 * Opens on where you have been rather than on everything there is, because
 * the commonest use of a switcher is going back to the thing you were just
 * looking at. Typing replaces that with matches, best first - the ordering is
 * in switcher.ts and is the part with a decision in it.
 */
export function Switcher({ targets, recent, onGo, onClose }: {
  targets: readonly Target[]
  /** Ids, most recently visited first. */
  recent: readonly string[]
  onGo: (target: Target) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const box = useRef<HTMLInputElement>(null)

  const hits = useMemo(() => switcherMatches(targets, q, recent), [targets, q, recent])

  /* Back to the top whenever the list changes underneath, or the highlight
     sits on row four of a list that now has two. */
  useEffect(() => { setAt(0) }, [q])

  useEffect(() => { box.current?.focus() }, [])

  const go = (target: Target | undefined): void => {
    if (!target) return
    onGo(target)
    onClose()
  }

  return (
    <Over>
      {/* The scrim is a sibling rather than a wrapper, the way every other
          dialog here does it: drawn inside whatever opened it, this would
          inherit that thing's stacking context and appear underneath it. */}
      <div className="scrim" onClick={onClose} />
      <div className="switcher" role="dialog" aria-label="Go to">
        <input
          ref={box}
          className="switcher-q"
          value={q}
          placeholder="Where to? A channel, a conversation, a server"
          aria-label="Where to"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
            if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => moved(n, 1, hits.length)); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => moved(n, -1, hits.length)); return }
            /* Tab moves through it as well, because a list somebody is
               arrowing through is a list they may also tab through, and
               having it leave the dialog instead is a lost keystroke. */
            if (e.key === 'Tab') {
              e.preventDefault()
              setAt((n) => moved(n, e.shiftKey ? -1 : 1, hits.length))
              return
            }
            if (e.key === 'Enter') { e.preventDefault(); go(hits[at]) }
          }}
        />

        {hits.length === 0 ? (
          <p className="switcher-none">
            {q ? 'Nothing by that name.' : 'Somewhere you have been will show up here.'}
          </p>
        ) : (
          <div className="switcher-list" role="listbox">
            {hits.map((h, i) => (
              <button
                key={h.kind + h.id}
                className="switcher-row"
                role="option"
                aria-selected={i === at}
                data-on={i === at ? '' : undefined}
                /* Following the pointer as well as the keyboard: a list that
                   highlights one row while the mouse hovers another is two
                   answers to "what happens if I press Enter". */
                onMouseMove={() => setAt(i)}
                onClick={() => go(h)}
              >
                <span className="switcher-sigil">{SIGIL[h.kind]}</span>
                <span className="switcher-name">{h.name}</span>
                {h.where && <span className="switcher-where">{h.where}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </Over>
  )
}
