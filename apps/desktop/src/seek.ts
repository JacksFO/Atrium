/**
 * Did somebody move the track, or is it just playing?
 *
 * A position moves on its own, so being told one is only news when it is not
 * where it would have got to by now. That distinction is the whole of the
 * difference between two bad options:
 *
 *   report every position  - twelve messages a minute per person, to everyone
 *                            who can see them, for a bar the receiving card
 *                            already advances by itself
 *   report none of them    - a rewind never shows at all, which is what was
 *                            reported after the first attempt at this
 *
 * Its own file and pure, because it is a rule with an answer worth checking
 * rather than a line buried in a timer.
 */

/** How far out it has to be before somebody clearly moved it. */
export const SEEK_MS = 3000

export function movedDeliberately(
  /** Where the player says it is now. */
  at: number,
  /** Where it was when we last said so, and when that was. */
  told: number,
  toldTime: number,
  now: number,
  tolerance = SEEK_MS,
): boolean {
  // Nothing said yet, so anything is news.
  if (toldTime <= 0) return true
  const expected = told + (now - toldTime)
  return Math.abs(at - expected) > tolerance
}
