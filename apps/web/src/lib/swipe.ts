/**
 * Opening the side panels with a thumb.
 *
 * On a phone both panels are drawers, and reaching a button in the header to
 * open one is the slowest possible way to do it — the whole point of a drawer
 * is that it comes from the edge you are already holding.
 *
 * Right opens the channel list, left opens the members, and either gesture
 * closes whichever is already open first. That last part matters: with a
 * drawer open, a swipe the other way should put it back rather than open the
 * opposite one, or a flick left with the channels showing would leave both on
 * screen at once.
 *
 * The decision is separated from the listener so it can be asked without a
 * finger. The hard part is not the gesture — it is being sure a scroll is
 * never mistaken for one, because getting that wrong makes a conversation
 * unreadable on a phone: every drag down would open a drawer.
 */

/** Far enough to mean it, in CSS pixels. */
const FAR = 55
/** How much more sideways than up, so scrolling is never hijacked. */
const SLOPE = 1.6
/** Longer than this and it is a drag, not a swipe. */
const TIME_MS = 700

export type Gesture = { dx: number; dy: number; ms: number }
export type Drawers = { navOpen: boolean; membersOpen: boolean }
export type SwipeOutcome =
  | 'open-nav'
  | 'close-nav'
  | 'open-members'
  | 'close-members'

/** What a swipe should do, or null when it was not one. */
export function swipeOutcome(
  { dx, dy, ms }: Gesture,
  { navOpen, membersOpen }: Drawers,
): SwipeOutcome | null {
  if (ms > TIME_MS) return null
  if (Math.abs(dx) < FAR) return null
  // Vertical intent wins, always: this must never fight the scroller.
  if (Math.abs(dx) < Math.abs(dy) * SLOPE) return null
  if (dx > 0) return membersOpen ? 'close-members' : 'open-nav'
  return navOpen ? 'close-nav' : 'open-members'
}
