import { useLayoutEffect, useRef, useState } from 'react'
import type { User } from '../lib/wire'
import { Avatar } from './Avatar'
import { Over } from './Over'

/**
 * Who is watching this screen, and their names on asking.
 *
 * The faces alone answer "is anybody watching", which is what somebody
 * sharing wants to know at a glance. Which people is a second question, and
 * it used to be answered by a `title` - a native tooltip, which appears after
 * a second of stillness, cannot be styled, and puts four names on one line
 * with no faces beside them. It is a list, so it is drawn as one.
 *
 * Nothing is drawn at all when nobody is watching. "Spectators - 0" is a
 * count of an empty room, and the faces are the affordance: no faces, nothing
 * to press.
 */
export function Spectators({ people, size = 'xs', nameFor }: {
  people: readonly User[]
  /** Smaller on a tile than in the header above one. */
  size?: 'xs' | 'sm'
  /**
   * What to call each of them.
   *
   * A function rather than a world and a server, because this component has
   * no other reason to know about either - and the answer depends on which
   * server's room the tile is in, which only its caller knows. Defaults to
   * their own name, which is right wherever there is no server.
   */
  nameFor?: (u: User) => string
}) {
  const called = nameFor ?? ((u: User) => u.display_name || u.username)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  /*
   * Placed under the faces and pulled back onto the screen, measured rather
   * than guessed - these sit in the top right corner of a tile, so a panel
   * dropped straight down from them hangs off the right edge every time.
   */
  useLayoutEffect(() => {
    if (!at || !button.current || !panel.current) return
    const from = button.current.getBoundingClientRect()
    const box = panel.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(from.right - box.width, window.innerWidth - box.width - 8))
    const top = from.bottom + 6 + box.height > window.innerHeight
      ? Math.max(8, from.top - box.height - 6)
      : from.bottom + 6
    if (left !== at.left || top !== at.top) setAt({ left, top })
  }, [at])

  if (people.length === 0) return null

  const open = () => {
    const from = button.current?.getBoundingClientRect()
    setAt({ left: from?.left ?? 0, top: from?.bottom ?? 0 })
  }

  return (
    <>
      <button ref={button} className="watchers" onClick={open}
        aria-label={`${people.length} watching`}>
        {people.slice(0, 4).map((u) => (
          <Avatar key={u.id} user={u} size={size} />
        ))}
        {people.length > 4 && <span className="more">+{people.length - 4}</span>}
      </button>
      {at && (
        <Over>
          <div className="ctxscrim" onClick={() => setAt(null)}
            onContextMenu={(e) => { e.preventDefault(); setAt(null) }} />
          <div className="ctx spects" ref={panel} style={{ left: at.left, top: at.top }}>
            <div className="specthead">
              Spectators — {people.length}
            </div>
            {people.map((u) => (
              <div className="spect" key={u.id}>
                <Avatar user={u} size="sm" />
                <span className="spectname">{called(u)}</span>
              </div>
            ))}
          </div>
        </Over>
      )}
    </>
  )
}
