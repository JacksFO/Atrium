/**
 * How much of a channel is drawn, as opposed to how much is loaded.
 *
 * These are two different numbers and used not to be. Every message the
 * client had ever fetched for a channel was drawn, and nothing was ever
 * forgotten, so a conversation somebody had scrolled a long way back through
 * stayed on screen in full for the rest of the session. Nothing in the
 * client is memoised, so each one of those was drawn again every time a
 * message arrived: measured at 119 ms of work to add one message to a
 * channel with five hundred loaded, and it grows from there.
 *
 * So a channel opens showing what fits a screen and a bit more, and the
 * window grows upwards as somebody scrolls into it. Only when the window has
 * caught up with everything loaded is the next page asked for from the
 * server - which makes scrolling back two stages, one instant and one over
 * the network, rather than one that is sometimes slow.
 *
 * The bottom of the list is always drawn. Windowing at both ends means
 * guessing the height of what is not drawn, and a wrong guess is a scrollbar
 * that jumps under somebody's hand.
 */

/**
 * What a channel opens with.
 *
 * Comfortably more than a screen at any sensible window size and density, so
 * opening a channel and scrolling a little does not immediately have to grow.
 */
export const FIRST = 80

/**
 * How much more each time.
 *
 * Smaller than the page fetched from the server, because growing is instant
 * and can happen twice in a row without anybody noticing, while a fetch
 * cannot.
 */
export const STEP = 60

/** The end of the list, which is the part always drawn. */
export function visible<T>(all: readonly T[], shown: number): T[] {
  if (shown >= all.length) return [...all]
  return all.slice(all.length - Math.max(0, shown))
}

/** Whether there is more already loaded than is being drawn. */
export function moreToShow(loaded: number, shown: number): boolean {
  return shown < loaded
}

/**
 * The next window up.
 *
 * Never past what is loaded: a window larger than the list would mean the
 * next scroll to the top asked for another page while there were still
 * messages in hand that had not been drawn.
 */
export function grown(loaded: number, shown: number): number {
  return Math.min(loaded, shown + STEP)
}

/**
 * How much of a channel is kept once you have left it.
 *
 * One page, which is what opening it fresh would have fetched anyway.
 *
 * Drawing less than is loaded stops the cost of a message arriving growing
 * with the session, but it does not stop the *holding* growing: somebody
 * moving around twenty channels all day, scrolling back through each, ends
 * up with every message of all of them in memory until the tab is closed.
 * Nothing is ever forgotten otherwise - a channel is fetched once and then
 * kept current by events for as long as the app is open.
 *
 * So leaving a channel puts it back to a page. Going back into it shows that
 * page and fetches the rest again as you scroll, which is the same journey
 * as the first visit and costs one request nobody is waiting on.
 */
export const KEEP = 60

/** A channel put back to its last page, or left alone if it is already short. */
export function trimmed<T>(all: readonly T[], keep: number = KEEP): T[] {
  if (all.length <= keep) return [...all]
  return all.slice(all.length - keep)
}
