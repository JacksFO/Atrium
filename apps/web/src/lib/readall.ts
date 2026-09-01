import type { Conversation } from './dms'
import type { Id, Space } from './wire'
import type { World } from './world'

/**
 * Everything waiting where you are looking, and nothing else.
 *
 * Scoped on purpose, and the original build learned this the hard way: it
 * counted every channel anywhere, so an unread conversation - or something
 * waiting in a completely different server - put a Read all button in the
 * header of a server with nothing unread in it at all. A conversation belongs
 * to no server, and reading a missing space as "the first one" puts it in the
 * wrong place.
 *
 * So inside a server this is that server's channels; outside one it is the
 * conversations, which are the only thing on that side of the app.
 *
 * Muted channels are left out. Somebody who muted a channel has already said
 * they do not want telling about it, and a button that clears it is a button
 * that had to count it first.
 */
export function waitingHere(
  w: World,
  space: Space | null,
  chats: readonly Conversation[],
): Id[] {
  const out: Id[] = []
  if (space) {
    for (const c of w.channels) {
      if (c.space_id !== space.id) continue
      if (w.muted.has(c.id)) continue
      if ((w.unread.get(c.id) ?? 0) > 0) out.push(c.id)
    }
    return out
  }
  for (const c of chats) {
    if (w.muted.has(c.id)) continue
    if ((w.unread.get(c.id) ?? 0) > 0) out.push(c.id)
  }
  return out
}

/** How much, for the number on the button. */
export function waitingCount(w: World, ids: readonly Id[]): number {
  let n = 0
  for (const id of ids) n += w.unread.get(id) ?? 0
  return n
}
