import type { Category, Channel, Id } from './wire'

/**
 * The channel list, as headings with channels under them.
 *
 * Channels were drawn as one flat run sorted by position, which is right
 * within a heading and says nothing between them — so a server that had
 * arranged its rooms into categories showed them jumbled together, and the
 * categories it had made were invisible.
 *
 * Text and Voice are headings too, holding whatever nobody has filed. They
 * are not rows in the categories table, so their place in the order comes
 * from the space itself — which is why it has to be passed in rather than
 * read off a category that does not exist.
 */

export type Section = {
  /** Null for the two that hold whatever is unfiled. */
  category: Category | null
  label: string
  position: number
  channels: Channel[]
}

export type LoosePlace = { text: number; voice: number }

/** Where the unfiled sections sit when the server has not said. */
const DEFAULT_LOOSE: LoosePlace = { text: -2, voice: -1 }

/**
 * What a heading is called when its order is written down.
 *
 * A category has an id; the two unfiled groups do not, and the server names
 * them `loose:text` and `loose:voice` in the same list - it has taken them
 * in a category order all along and this end never sent them, so the two
 * headings everybody has were the only ones that could not be moved.
 */
export function sectionId(s: Section): string {
  if (s.category) return s.category.id
  return s.label === 'Voice' ? 'loose:voice' : 'loose:text'
}

export function sectionsOf(
  channels: readonly Channel[],
  categories: readonly Category[],
  spaceId: Id,
  loose: LoosePlace | undefined,
  /**
   * Whether to keep a heading with nothing under it.
   *
   * For somebody who can move channels about, yes: they have just made it,
   * and a category that appears only once something is in it is a button
   * that does nothing - there is nowhere to drop a channel and no sign the
   * thing was created at all.
   *
   * For everybody else, no. To them it is a label with nothing under it,
   * which reads as a room they cannot see rather than as a category nobody
   * has used yet.
   */
  keepEmpty = false,
): Section[] {
  const here = channels
    .filter((c) => c.space_id === spaceId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))

  const at = loose ?? DEFAULT_LOOSE
  const out: Section[] = []

  const mine = categories.filter((c) => c.space_id === spaceId)
  /*
   * The headings this server actually has, so that a channel filed under one
   * that is missing can be found again.
   *
   * A channel went into a section only if its category was in the list, and
   * into the unfiled section only if it had no category at all - so a channel
   * whose category was not here belonged to no section and was drawn nowhere.
   * Not hidden, not empty: gone, with nothing on screen to say so. That is
   * how one server's headings replacing another's emptied a whole server.
   *
   * The list can be short for ordinary reasons - a heading made a moment ago
   * on somebody else's screen, a request that failed - and none of them are
   * reasons to lose a room. Unfiled is where a channel with nowhere to go
   * goes.
   */
  const known = new Set(mine.map((c) => c.id))

  /* The two unfiled ones first, so a channel with no category is never lost:
     a section is built for them whether or not anything is in it, and dropped
     below if it turns out to be empty. */
  const unfiled = (kind: 'text' | 'voice', position: number): Section => ({
    category: null,
    label: kind === 'text' ? 'Text' : 'Voice',
    position,
    channels: here.filter(
      (c) => (!c.category_id || !known.has(c.category_id)) && c.kind === kind,
    ),
  })

  out.push(unfiled('text', at.text), unfiled('voice', at.voice))

  for (const cat of mine) {
    out.push({
      category: cat,
      label: cat.name,
      position: cat.position,
      channels: here.filter((c) => c.category_id === cat.id),
    })
  }

  return out
    /* The two unfiled ones are dropped when empty whoever is looking: "Text"
       with nothing under it is not a category anybody made. */
    .filter((s) => s.channels.length > 0 || (keepEmpty && !!s.category))
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label))
}

/**
 * One channel moved, as the whole list in its new order.
 *
 * The route takes every id rather than a moved one and a destination, which
 * is the only version that cannot drift out of step with what is on screen:
 * two people reordering at once both send what they are looking at, and the
 * second one wins entirely rather than landing half in the first one's list.
 */
export function moved(order: readonly Id[], id: Id, by: -1 | 1): Id[] {
  const from = order.indexOf(id)
  if (from < 0) return [...order]
  const to = from + by
  /* Off either end is not a move. Wrapping would put the top channel at the
     bottom, which nobody pressing "up" is asking for. */
  if (to < 0 || to >= order.length) return [...order]
  const next = [...order]
  const [it] = next.splice(from, 1)
  next.splice(to, 0, it!)
  return next
}
