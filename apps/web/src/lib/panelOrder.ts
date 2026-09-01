/**
 * Which order the four columns sit in, left to right.
 *
 * Servers, channels, the conversation and the member list. Everybody has
 * opinions about which side a member list belongs on, and it costs nothing to
 * let each person decide - the arrangement is a fact about one person's
 * window, not about the app, so it is theirs and nobody else sees it.
 */

/** The columns there are. The order here is the one somebody gets by default. */
export const PANELS = ['servers', 'channels', 'conversation', 'members'] as const

export type Panel = (typeof PANELS)[number]

/** What each column is called where somebody can read it. */
export const PANEL_NAMES: Record<Panel, string> = {
  servers: 'Servers',
  channels: 'Channels',
  conversation: 'Conversation',
  members: 'Members',
}

/**
 * How wide each column is, in the order they happen to be arranged.
 *
 * The width belongs to the panel and not to the position, so moving the
 * member list to the left has to take its width with it - otherwise the rail
 * lands in a 254px column and the members in a 66px one, which is not a
 * rearrangement, it is a mess. Every width but the conversation's is a
 * variable somebody can drag; the conversation takes what is left.
 */
const WIDTHS: Record<Panel, string> = {
  servers: 'var(--railw)',
  channels: 'var(--sidew)',
  conversation: 'minmax(0,1fr)',
  members: 'var(--rightw)',
}

/**
 * Make sense of whatever was stored, rather than trusting or discarding it.
 *
 * This is the part that has to survive a version change, and there are three
 * ways it can meet something it did not write:
 *
 *   - a panel it has never heard of, from a newer version somebody has since
 *     gone back from. Dropped, because there is nothing to draw for it.
 *   - a panel missing entirely, because the stored order predates it. Added
 *     at the end, in the default order, so a new column appears rather than
 *     the whole arrangement being thrown away and reset.
 *   - the same panel twice, or a value that is not a list at all. Ignored.
 *
 * The alternative - "if it does not match exactly, use the defaults" - loses
 * somebody's arrangement the first time a column is added, which is precisely
 * the moment they would least expect to lose it.
 */
export function readOrder(stored: unknown): Panel[] {
  const known = new Set<string>(PANELS)
  const seen = new Set<Panel>()
  const out: Panel[] = []

  if (Array.isArray(stored)) {
    for (const item of stored) {
      if (typeof item !== 'string') continue
      if (!known.has(item)) continue
      const panel = item as Panel
      if (seen.has(panel)) continue
      seen.add(panel)
      out.push(panel)
    }
  }

  /* Anything the stored order did not mention, in the order it would have
     had by default. */
  for (const panel of PANELS) if (!seen.has(panel)) out.push(panel)
  return out
}

/** Whether this is the order somebody gets without arranging anything. */
export function isDefaultOrder(order: readonly Panel[]): boolean {
  return order.length === PANELS.length && order.every((p, i) => p === PANELS[i])
}

/**
 * The grid's columns, in the arranged order.
 *
 * Given to the shell as one value rather than four rules, so there is one
 * place where a width and a position meet and no way for them to disagree.
 */
export function columnsFor(
  order: readonly Panel[], hidden: readonly Panel[] = [],
): string {
  /*
   * A folded panel has no column, rather than a column of nothing.
   *
   * Zero width is not the same as gone: the shell puts a gap between every
   * column, so a nought-wide track still leaves a gap either side of it - a
   * strip of nothing where the panel used to be, which is what folding it
   * away was meant to get rid of.
   */
  return order.filter((p) => !hidden.includes(p)).map((p) => WIDTHS[p]).join(' ')
}

/** Which column a panel sits in, counting from one, as CSS grid counts. */
export function columnOf(
  order: readonly Panel[], panel: Panel, hidden: readonly Panel[] = [],
): number {
  /* Counted among the ones actually drawn: a folded panel takes its column
     with it, so everything after it moves up one. */
  const shown = order.filter((p) => !hidden.includes(p))
  const at = shown.indexOf(panel)
  /* Not in the list at all should be impossible - readOrder puts everything
     in - but a panel drawn in column zero is a panel drawn on top of another
     one, so it goes last rather than nowhere. */
  return at < 0 ? shown.length + 1 : at + 1
}

/**
 * Move one panel one place left or right.
 *
 * Stops at the ends rather than wrapping: a member list that vanishes off one
 * side and reappears on the other has not been moved, it has been lost and
 * found, and somebody holding an arrow key would never see where it went.
 */
export function move(order: readonly Panel[], panel: Panel, by: -1 | 1): Panel[] {
  const from = order.indexOf(panel)
  if (from < 0) return [...order]
  const to = from + by
  if (to < 0 || to >= order.length) return [...order]
  const out = [...order]
  const [taken] = out.splice(from, 1)
  out.splice(to, 0, taken!)
  return out
}

/**
 * Put one panel where another one is, which is what a drag means.
 *
 * Not a swap: dragging the member list onto the servers should slide
 * everything between them along, the way dragging anything into a list does,
 * rather than teleporting the servers to the far right.
 */
export function place(order: readonly Panel[], panel: Panel, onto: Panel): Panel[] {
  if (panel === onto) return [...order]
  const out = [...order]
  const from = out.indexOf(panel)
  if (from < 0) return out
  out.splice(from, 1)
  const to = out.indexOf(onto)
  if (to < 0) return [...order]
  /* Dropped on something to its right, it goes after it; to its left, before.
     Which is what the pointer was over at the moment it was let go. */
  out.splice(order.indexOf(panel) < order.indexOf(onto) ? to + 1 : to, 0, panel)
  return out
}

/**
 * Which way a panel folds away, and what it folds against.
 *
 * A panel folds towards the nearer edge of the window, because that is the
 * shorter journey and the one somebody watching it expects. Which edge that
 * is depends entirely on where the panel has been arranged - the channel list
 * is second from the left by default, but somebody who has dragged it to the
 * far right should not watch it fold across the whole window to get out.
 *
 * `against` is the panel it leaves behind: folding left it is the one that
 * moves into its place, folding right it is the one it was sitting after. The
 * way back is drawn on that panel's edge, so it stays with the arrangement
 * rather than sitting somewhere near the side of the screen and hoping.
 */
export function foldSide(
  order: readonly Panel[], panel: Panel,
): { side: 'left' | 'right'; against: Panel } {
  const at = order.indexOf(panel)
  /* Nearer the left edge than the right, counting the panels either side.
     A tie folds left, and the far side of an arrangement of one is left. */
  const left = at >= 0 && at * 2 <= order.length - 1
  const next = order[left ? at + 1 : at - 1]
  return {
    side: left ? 'left' : 'right',
    /* Nothing beside it on the side it folds from can only happen if it is
       the only panel there is, and then there is nothing to hide from. */
    against: next ?? panel,
  }
}
