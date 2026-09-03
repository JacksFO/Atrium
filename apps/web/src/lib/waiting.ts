import type { Conversation } from './dms'
import { quietIn } from './notifyLevel'
import type { Id } from './wire'
import type { World } from './world'

/**
 * What was said while you were away.
 *
 * The home page has always promised this in its own doc comment and never
 * drawn it - what it showed instead was a grid of the same conversations
 * already listed down the left, which answers a question nobody standing on
 * the home page is asking.
 *
 * Everything here is already known: the server counts what is waiting at
 * sign-in, says which of it names you, and the socket keeps both in step
 * afterwards. So this is arranging what is held rather than asking for
 * anything, and it costs one pass over a handful of maps.
 */

export type Waiting = {
  /** The channel to open. */
  id: Id
  /** Where it is, as somebody would say it out loud. */
  where: string
  /** The server it is in, or null for a conversation. */
  space: string | null
  kind: 'dm' | 'channel'
  count: number
  /** Your name is in it, which is the difference between later and now. */
  named: boolean
  /** When something was last said, for ordering. */
  at: number
}

/**
 * Ordered the way somebody would want to deal with it.
 *
 * Anything naming you comes first however old it is, because that is the
 * whole reason to mark it; the rest is newest first. Muted channels are left
 * out entirely - somebody who muted a channel has already said they do not
 * want to be told about it, and showing it here would be the app arguing.
 */
export function whatWaits(
  w: World,
  chats: readonly Conversation[],
  most = 6,
): Waiting[] {
  const dmById = new Map(chats.map((c) => [c.id, c]))
  const spaceById = new Map(w.spaces.map((s) => [s.id, s.name]))
  const channelById = new Map(w.channels.map((c) => [c.id, c]))

  const out: Waiting[] = []
  for (const [id, count] of w.unread) {
    if (!count) continue

    const dm = dmById.get(id)
    const channel = channelById.get(id)
    /* Asked of the channel and the server it is in, rather than of a set of
       muted channel ids - a server somebody has muted has to stop counting
       here too, and its channels are not in that set. */
    if (quietIn(id, channel?.space_id ?? null, w.prefs, w.spacePrefs, Date.now())) continue
    /* A channel this client has not heard of - one somebody was removed from,
       or a conversation not fetched yet. Naming it "somewhere" would be worse
       than leaving it out. */
    if (!dm && !channel) continue

    out.push({
      id,
      where: dm ? dm.name : `#${channel!.name}`,
      space: dm ? null : spaceById.get(channel!.space_id ?? '') ?? null,
      kind: dm ? 'dm' : 'channel',
      count,
      named: w.mentioned.has(id),
      at: w.lastAt.get(id) ?? 0,
    })
  }

  out.sort((a, b) => {
    if (a.named !== b.named) return a.named ? -1 : 1
    return b.at - a.at
  })
  return out.slice(0, most)
}

/** How long ago, in the fewest words that are still true. */
export function ago(at: number, now = Date.now()): string {
  if (!at) return ''
  const secs = Math.max(0, Math.round((now - at) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
