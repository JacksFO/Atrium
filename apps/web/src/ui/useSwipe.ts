import { useEffect } from 'react'
import { swipeOutcome, type SwipeOutcome } from '../lib/swipe'

/**
 * Listening for the gesture that swipeOutcome decides about.
 *
 * The listener is here and the decision is in swipe.ts, so what a swipe means
 * can be asked without a finger — which is the only way to be sure a scroll
 * is never mistaken for one. Get that wrong and a conversation is unreadable
 * on a phone: every drag down opens a drawer.
 *
 * Bound to the window rather than to the panels, because the gesture starts
 * wherever the thumb happens to be — usually over the conversation, which is
 * the thing the drawers slide across.
 */
export function useSwipe(
  on: boolean,
  drawers: { navOpen: boolean; membersOpen: boolean },
  act: (what: SwipeOutcome) => void,
) {
  useEffect(() => {
    if (!on) return

    let from: { x: number; y: number; at: number } | null = null

    const down = (e: PointerEvent) => {
      /* A mouse has a scrollbar and a window edge; this is for thumbs. */
      if (e.pointerType === 'mouse') return
      /* Not from inside something that scrolls sideways of its own accord —
         the emoji rows, the GIF grid, a code block. A swipe there is that
         thing being scrolled, and hijacking it makes it unusable. */
      if ((e.target as Element | null)?.closest?.('.escroll, .gifgrid, pre, .tri')) return
      from = { x: e.clientX, y: e.clientY, at: Date.now() }
    }

    const up = (e: PointerEvent) => {
      const start = from
      from = null
      if (!start) return
      const outcome = swipeOutcome(
        { dx: e.clientX - start.x, dy: e.clientY - start.y, ms: Date.now() - start.at },
        drawers,
      )
      if (outcome) act(outcome)
    }

    /* Passive: this only reads the gesture. A non-passive listener on
       pointerdown makes every drag on the page worse whether or not it turns
       out to be a swipe. */
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('pointercancel', () => { from = null }, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  /* The two drawer states this reads. Depending on the object would tear
     the listeners down and put them back on every render. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, drawers.navOpen, drawers.membersOpen, act])
}
