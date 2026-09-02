import { conversation } from './dms'
import type { World } from './world'

/**
 * What the quick switcher offers, and in what order.
 *
 * Its own file and pure, because the ordering is the whole feature. A list
 * that merely contains the right answer is not a switcher - the answer has to
 * be first, after two or three letters, or somebody may as well have used the
 * mouse. Everything else about it is a text box and a list.
 *
 * The rules, in the order they matter:
 *
 *   - what starts with what you typed beats what merely contains it, because
 *     people type the beginning of a name
 *   - a shorter name beats a longer one on the same footing: "art" should
 *     offer #art before #articles
 *   - where you already were beats where you were not, so returning to the
 *     last thing is two keys rather than a hunt
 *
 * Nothing here knows how to open anything. It takes a list and gives back a
 * shorter one in a better order.
 */

/** One thing somebody can jump to. */
export type Target = {
  id: string
  /** The name as it is drawn, without any # or @. */
  name: string
  kind: 'channel' | 'voice' | 'dm' | 'group' | 'space'
  /** The server it lives in, where that is a different place to get to. */
  spaceId?: string | undefined
  /** The server's name, drawn beside a channel so two #generals can be told
   *  apart - which is the only reason anybody needs it. Undefined rather than
   *  absent, because a server that has gone is a lookup that came back with
   *  nothing rather than a field somebody chose to leave out. */
  where?: string | undefined
}

/** What each kind is written with, the way people say them. */
export const SIGIL: Record<Target['kind'], string> = {
  channel: '#',
  voice: '🔊',
  dm: '@',
  group: '@',
  space: '',
}

const norm = (s: string): string => s.toLowerCase().trim()

/**
 * A score, or null for no match at all.
 *
 * Lower is better, which keeps the sort the plain one. The bands are far
 * enough apart that no amount of shortness lets a mere containment overtake
 * something that starts with what was typed.
 */
function score(target: Target, query: string, recent: readonly string[]): number | null {
  const name = norm(target.name)
  const q = norm(query)
  if (!q) {
    /* With nothing typed, the list is where you have been - most recent
       first, and nothing else at all. A switcher that opens showing every
       channel in alphabetical order is a directory. */
    const at = recent.indexOf(target.id)
    return at === -1 ? null : at
  }
  const at = name.indexOf(q)
  if (at === -1) return null

  const band = at === 0 ? 0 : 1000
  /* Among equals, the shorter name: #art before #articles. */
  const length = Math.min(name.length, 200)
  /* And among those, somewhere you have been recently. Small enough that it
     only ever breaks a tie. */
  const seen = recent.indexOf(target.id)
  const familiar = seen === -1 ? 0.9 : seen / (recent.length * 10 + 1)
  return band + length + familiar
}

/**
 * The matches, best first.
 *
 * `most` is what the list can show; asking for more than that is work nobody
 * sees, and a switcher is asked again on every keystroke.
 */
export function switcherMatches(
  targets: readonly Target[],
  query: string,
  recent: readonly string[] = [],
  most = 12,
): Target[] {
  const scored: Array<{ t: Target; s: number }> = []
  for (const t of targets) {
    const s = score(t, query, recent)
    if (s !== null) scored.push({ t, s })
  }
  scored.sort((a, b) => a.s - b.s)
  return scored.slice(0, most).map((x) => x.t)
}

/**
 * Moving up and down a list that wraps.
 *
 * Wrapping because the list is short and the alternative is a key that
 * silently does nothing at the end - which reads as the switcher having
 * frozen rather than as having reached the bottom.
 */
export function moved(at: number, by: number, length: number): number {
  if (length <= 0) return 0
  return ((at + by) % length + length) % length
}

/**
 * Everywhere somebody can get to, out of the world.
 *
 * Here rather than in the pane that draws it: what this is made of is a fact
 * about the app's shape - channels, conversations, servers - and the pane
 * should only have to say where it goes when one is chosen.
 *
 * Nothing is filtered. The gateway only ever sent the channels this account
 * may know about, so the list is already exactly what may be seen, and a
 * filter here would be a second answer to a question already answered.
 */
export function targetsOf(world: World): Target[] {
  const named = new Map(world.spaces.map((sp) => [sp.id, sp.name]))
  const out: Target[] = []

  for (const c of world.channels) {
    if (c.kind !== 'text' && c.kind !== 'voice') continue
    out.push({
      id: c.id,
      name: c.name,
      /* 'text' is what the wire calls it; 'channel' is what somebody reading
         a list of places calls it. */
      kind: c.kind === 'voice' ? 'voice' : 'channel',
      spaceId: c.space_id,
      /* The server's name beside the channel, so two #generals can be told
         apart - the only reason it is there. */
      where: named.get(c.space_id),
    })
  }

  for (const d of world.dms) {
    /* Named the way the conversation list names it - the people in it, which
       is the only name a conversation has. */
    const conv = conversation(world, d)
    out.push({ id: d.id, name: conv.name, kind: conv.group ? 'group' : 'dm' })
  }

  for (const sp of world.spaces) out.push({ id: sp.id, name: sp.name, kind: 'space' })

  return out
}
