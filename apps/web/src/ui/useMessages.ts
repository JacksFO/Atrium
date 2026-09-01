import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api } from '../lib/api'
import { KEEP, trimmed } from '../lib/messageWindow'
import type { Id, Message } from '../lib/wire'
import type { World } from '../lib/world'

/**
 * One channel's messages.
 *
 * Loaded when the channel is opened, and put into the world so that events
 * arriving afterwards land in the same list — a message that arrived while
 * the fetch was in the air would otherwise be lost, which is the sort of gap
 * that shows up as one message missing from a conversation and is never
 * explained.
 *
 * The request is abandoned rather than applied if the channel changed while
 * it was out. Switching quickly between two channels used to put one's
 * messages under the other's name.
 */
/** How many the server sends in one go, which is its own default. Asking for
 *  a different number would make "a full page" mean something other than what
 *  the server considers one, and a full page is the only sign there is
 *  anything older. */
const PAGE = 60

export function useMessages(server: Api, world: World | null, channelId: Id | null) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [, bump] = useState(0)

  /*
   * Whether there is anything older, per channel.
   *
   * Kept for the channel it belongs to rather than as one flag: switching to
   * a short conversation and back would otherwise leave a long channel
   * believing it had reached the beginning.
   */
  const more = useRef<Map<Id, boolean>>(new Map())
  const asking = useRef(false)

  /*
   * Leaving a channel puts it back to a page.
   *
   * A channel is fetched once and then kept current by events for as long as
   * the app is open, and nothing was ever dropped - so somebody moving around
   * twenty channels all day, scrolling back through each, held every message
   * of all of them until they closed the tab. Going back in shows the page
   * and fetches the rest again as they scroll, which is the same journey as
   * the first visit.
   *
   * `more` is cleared with it, or the channel would come back believing it
   * had reached the beginning and refuse to fetch what was just dropped.
   */
  const leaving = useRef<string | null>(null)
  useEffect(() => {
    const before = leaving.current
    leaving.current = channelId ?? null
    if (!world || !before || before === channelId) return
    const held = world.messages.get(before)
    if (!held || held.length <= KEEP) return
    world.messages.set(before, trimmed(held))
    more.current.delete(before)
  }, [channelId, world])

  useEffect(() => {
    if (!world || !channelId) return
    let alive = true

    /* Already have them: an event has been keeping this list current since
       the last time it was opened, so re-fetching would only replace it with
       the same thing and lose anything that arrived in between. */
    if (world.messages.has(channelId)) return

    setLoading(true)
    setError('')
    void server
      .get<{ messages?: Message[] }>(`/api/channels/${encodeURIComponent(channelId)}/messages`)
      .then((r) => {
        if (!alive) return
        const got = r.messages ?? []
        /* Anything that arrived while this was in the air is already in the
           world; the fetched history goes underneath it rather than over. */
        const since = world.messages.get(channelId) ?? []
        const seen = new Set(got.map((m) => m.id))
        const all = [...got, ...since.filter((m) => !seen.has(m.id))]
        world.messages.set(channelId, all)
        /* And when this channel last had anything said in it, which is what
           the conversation list is ordered by. */
        const newest = all[all.length - 1]?.created_at ?? 0
        if (newest > (world.lastAt.get(channelId) ?? 0)) world.lastAt.set(channelId, newest)
        /* A full page means there is probably more above it. Fewer means the
           beginning is on screen. */
        more.current.set(channelId, got.length >= PAGE)
        setLoading(false)
        bump((n) => n + 1)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Could not read that channel.')
        setLoading(false)
      })

    return () => { alive = false }
  }, [server, world, channelId])

  /**
   * The page before the oldest one showing.
   *
   * The client never asked for one. The server has taken `before` and `limit`
   * the whole time, so a channel with a thousand messages showed the most
   * recent fifty and nothing above them however far you scrolled - there was
   * no way to read anything older at all. The comment in the shell said as
   * much: "nothing pages back yet".
   *
   * Returns whether it added anything, because the caller has to put the
   * scroll back where it was afterwards: prepending to a scrolled list moves
   * everything down by the height of what was added, and a reader who was
   * looking at the top is suddenly looking at the middle.
   */
  const older = useCallback(async (): Promise<boolean> => {
    if (!world || !channelId) return false
    if (asking.current) return false
    if (more.current.get(channelId) === false) return false

    const have = world.messages.get(channelId) ?? []
    const oldest = have[0]
    if (!oldest) return false

    asking.current = true
    try {
      const r = await server.get<{ messages?: Message[] }>(
        `/api/channels/${encodeURIComponent(channelId)}/messages`
        /* A time, not an id. The server reads this as a number and pages
           back from it; handed an id it binds null, `created_at < null` is
           never true, and it answers with the newest page again - which
           looks exactly like having reached the beginning. */
        + `?before=${encodeURIComponent(String(oldest.created_at))}&limit=${PAGE}`,
      )
      const got = r.messages ?? []
      more.current.set(channelId, got.length >= PAGE)
      if (got.length === 0) return false

      /* Nothing twice: a message can be in both answers if one arrived
         between the two requests. */
      const now = world.messages.get(channelId) ?? []
      const seen = new Set(now.map((m) => m.id))
      const fresh = got.filter((m) => !seen.has(m.id))
      if (fresh.length === 0) return false

      world.messages.set(channelId, [...fresh, ...now])
      bump((n) => n + 1)
      return true
    } catch {
      /* Quietly: this runs from scrolling, and a reader who scrolls up in a
         channel with a flaky connection should not be shouted at. It will be
         tried again the next time they scroll. */
      return false
    } finally {
      asking.current = false
    }
  }, [server, world, channelId])

  const messages = channelId ? world?.messages.get(channelId) ?? [] : []
  /* Unknown means "not asked yet", which reads as "there may be more" - the
     first page has not come back to say otherwise. */
  const hasOlder = channelId ? more.current.get(channelId) !== false : false
  return { messages, loading, error, older, hasOlder }
}
