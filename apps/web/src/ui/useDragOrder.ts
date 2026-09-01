import { useState } from 'react'
import { moved } from '../lib/tree'

/**
 * Dragging things into a different order.
 *
 * Four lists want this — the servers on the rail, the channels in a server,
 * its categories, and its roles — and all of them had only "move up" and
 * "move down", which is the same job done one step at a time by somebody who
 * has already worked out where they want it. Ten places down a list of ten is
 * nine presses, each one re-sorting the list under the pointer.
 *
 * The order is written from what is on screen rather than from positions,
 * because two people rearranging at once each send the list they are looking
 * at, and the last one to arrive wins whole rather than interleaving into
 * something neither of them asked for.
 *
 * Keyboard reordering is asked for rather than given, because it costs Space
 * and Enter. In the sidebar a channel row *is* the button that opens the
 * channel, so taking those keys would trade a way to move a channel for the
 * way to open one. In settings the row opens nothing, so there they are free.
 */
export function useDragOrder(
  ids: readonly string[],
  onReorder: (order: string[]) => void,
  opts: {
    /**
     * Grab with Space, move with the arrows, drop with Space, put it back
     * with Escape. Only where the row is not itself a link or a button.
     */
    keyboard?: boolean
    /** What to call a row when saying where it went. Defaults to its id. */
    nameOf?: (id: string) => string
  } = {},
) {
  const [dragging, setDragging] = useState<string | null>(null)
  /** The row picked up by keyboard, which stays picked up between presses. */
  const [held, setHeld] = useState<string | null>(null)
  /** Where it was when it was picked up, so Escape can put it back. */
  const [wasAt, setWasAt] = useState<number>(-1)
  /**
   * What just happened, for a live region.
   *
   * A drag says where a row went by moving it. A keyboard move has to say so
   * out loud, or the only feedback is a list that reorders silently.
   */
  const [said, setSaid] = useState('')

  const nameOf = opts.nameOf ?? ((id: string) => id)

  const step = (id: string, by: -1 | 1) => {
    const next = moved(ids, id, by)
    /* Off either end is not a move, and saying it moved would be a lie. */
    if (next.every((x, i) => x === ids[i])) {
      setSaid(`${nameOf(id)} is already ${by === -1 ? 'first' : 'last'}`)
      return
    }
    onReorder(next)
    setSaid(`${nameOf(id)} moved to ${next.indexOf(id) + 1} of ${next.length}`)
  }

  /** Everything a row needs to be picked up and dropped on. */
  const rowProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDragging(id)
      e.dataTransfer.effectAllowed = 'move'
      /* Firefox will not start a drag with nothing set on it. */
      e.dataTransfer.setData('text/plain', id)
      /* Or the whole panel is dragged along with the row inside it. */
      e.stopPropagation()
    },
    onDragEnd: () => setDragging(null),
    onDragOver: (e: React.DragEvent) => {
      if (!dragging || dragging === id) return
      /* Without this the drop is refused and nothing happens at all — which
         is exactly what "the hand appears but it does not move" looks like. */
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const heldNow = dragging
      setDragging(null)
      if (!heldNow || heldNow === id) return
      const next = [...ids]
      const from = next.indexOf(heldNow)
      const to = next.indexOf(id)
      if (from < 0 || to < 0) return
      next.splice(to, 0, ...next.splice(from, 1))
      onReorder(next)
    },
    'data-dragging': dragging === id ? '' : undefined,

    ...(opts.keyboard
      ? {
        tabIndex: 0,
        'data-held': held === id ? '' : undefined,
        onKeyDown: (e: React.KeyboardEvent) => {
          /* A key pressed inside one of the row's own buttons belongs to that
             button — Space on "delete this channel" is not a grab. */
          if (e.target !== e.currentTarget) return

          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            if (held === id) {
              setHeld(null)
              setSaid(`${nameOf(id)} dropped at ${ids.indexOf(id) + 1} of ${ids.length}`)
            } else {
              setHeld(id)
              setWasAt(ids.indexOf(id))
              setSaid(`${nameOf(id)} picked up. Arrows to move, Escape to put it back.`)
            }
            return
          }

          if (e.key === 'Escape' && held === id) {
            e.preventDefault()
            const back = [...ids]
            const from = back.indexOf(id)
            if (from >= 0 && wasAt >= 0) {
              back.splice(wasAt, 0, ...back.splice(from, 1))
              onReorder(back)
            }
            setHeld(null)
            setSaid(`${nameOf(id)} put back`)
            return
          }

          if (held !== id) return
          if (e.key === 'ArrowUp') { e.preventDefault(); step(id, -1) }
          else if (e.key === 'ArrowDown') { e.preventDefault(); step(id, 1) }
        },
        onBlur: () => {
          /* A row carried out of the list by Tab is a row nobody can put
             down, so it is put down where it stands. */
          if (held === id) setHeld(null)
        },
      }
      : {}),
  })

  return { dragging, held, said, rowProps }
}
