import { useLayoutEffect, useRef, useState } from 'react'

export type Anchor = { x: number; y: number; w: number; h: number }

/** Where something was, in the page's own coordinates. */
export const anchorOf = (el: Element): Anchor => {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/**
 * Putting a panel beside the thing that opened it, without it leaving the
 * screen.
 *
 * Measured after it is drawn rather than guessed at before. The old client
 * worked its height out from the number of rows at 36 pixels each, and a menu
 * is not made of equal rows — separators are thin, a danger row is not — so
 * the guess drifted further the longer the menu was, and right-clicking a
 * message near the bottom put Delete off the end of the screen.
 *
 * Below the phone width nothing is placed at all: there it is a sheet pinned
 * to the edges by the stylesheet, and an inline position would fight it. That
 * fight is exactly what put the whole conversation off the side of a phone,
 * because an inline style beats every media query there is.
 */
export function useAnchored(anchor: Anchor | null, phone: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor || phone) { setAt(null); return }

    const place = () => {
      const pad = 10
      const { width, height } = el.getBoundingClientRect()

      /* Beside it if there is room to the right, otherwise to its left — and
         never past either edge. */
      let left = anchor.x + anchor.w + 8
      if (left + width > window.innerWidth - pad) left = anchor.x - width - 8
      left = Math.max(pad, Math.min(left, window.innerWidth - width - pad))

      /* Its top level with the thing, then lifted until it fits. This is the
         one that mattered: a card opened from a name near the bottom of a
         conversation used to run off the end of the screen. */
      let top = anchor.y
      if (top + height > window.innerHeight - pad) top = window.innerHeight - height - pad
      top = Math.max(pad, top)

      setAt({ left, top })
    }
    place()

    /*
     * And again whenever what is inside it changes size.
     *
     * Measuring the thing itself is the whole point of this hook - but it was
     * measured once, and a panel that fetches what it shows is short when it
     * opens and tall a moment later. So the lifting that keeps it on screen
     * was worked out from a height that no longer existed, and whether it
     * ended up in the right place came down to whether the fetch beat the
     * layout. The pinned messages landed in two different places on the same
     * machine depending on how busy it was.
     *
     * Nothing moves for a panel whose contents are already there: the
     * observer only says anything when the size actually changes, and a
     * position is not a size, so this cannot chase its own tail.
     */
    if (typeof ResizeObserver === 'undefined') return
    const watching = new ResizeObserver(place)
    watching.observe(el)
    return () => watching.disconnect()
  }, [anchor, phone])

  return { ref, at }
}
