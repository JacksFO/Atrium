/**
 * The emoji this app knows by name.
 *
 * Deliberately a short list rather than the whole of Unicode. A picker with
 * two thousand faces in it is a thing to browse; this is a thing to reach
 * for, and the ones people actually reach for fit on a screen. Anything not
 * here can still be typed or pasted — nothing filters what somebody sends.
 *
 * Names are the shortcode without its colons, so `:fire:` finds 🔥 and the
 * same table answers both the picker and the renderer. Two tables would be
 * two answers to one question, and the one on screen would be the wrong one.
 */

export type EmojiGroup = readonly [string, ReadonlyArray<readonly [string, string]>]

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  ['Smileys', [
    ['grinning', '😀'], ['smile', '😄'], ['joy', '😂'], ['rofl', '🤣'],
    ['slight_smile', '🙂'], ['wink', '😉'], ['blush', '😊'], ['heart_eyes', '😍'],
    ['sunglasses', '😎'], ['thinking', '🤔'], ['neutral', '😐'], ['sleeping', '😴'],
    ['sob', '😭'], ['sweat_smile', '😅'], ['scream', '😱'], ['skull', '💀'],
    ['shush', '🤫'], ['salute', '🫡'], ['melting', '🫠'], ['eyes', '👀'],
  ]],
  ['People', [
    ['thumbsup', '👍'], ['thumbsdown', '👎'], ['clap', '👏'], ['raised_hands', '🙌'],
    ['pray', '🙏'], ['handshake', '🤝'], ['muscle', '💪'], ['wave', '👋'],
    ['point_right', '👉'], ['ok_hand', '👌'],
  ]],
  ['Nature', [
    ['fire', '🔥'], ['sparkles', '✨'], ['star', '⭐'], ['zap', '⚡'],
    ['rainbow', '🌈'], ['moon', '🌙'], ['sun', '☀️'], ['snow', '❄️'], ['leaf', '🍃'],
    ['dog', '🐶'], ['cat', '🐱'],
  ]],
  ['Food', [
    ['pizza', '🍕'], ['burger', '🍔'], ['fries', '🍟'], ['coffee', '☕'],
    ['beer', '🍺'], ['cake', '🍰'], ['popcorn', '🍿'],
  ]],
  ['Things', [
    ['rocket', '🚀'], ['game', '🎮'], ['headphones', '🎧'], ['trophy', '🏆'],
    ['gift', '🎁'], ['bulb', '💡'], ['gear', '⚙️'], ['lock', '🔒'], ['bell', '🔔'],
    ['tada', '🎉'], ['100', '💯'], ['heart', '❤️'], ['broken_heart', '💔'],
    ['check', '✅'], ['x', '❌'], ['warning', '⚠️'], ['question', '❓'],
  ]],
]

export type Emoji = { name: string; glyph: string; group: string }

export const ALL_EMOJI: readonly Emoji[] = EMOJI_GROUPS.flatMap(
  ([group, list]) => list.map(([name, glyph]) => ({ name, glyph, group })),
)

/**
 * The table the renderer reads, so `:fire:` in a message becomes 🔥.
 *
 * The same rows the picker shows. Built once — a map rebuilt on every render
 * is a new object every time, which is enough to make everything downstream
 * of it redraw for no reason.
 */
export const BY_NAME: ReadonlyMap<string, string> = new Map(
  ALL_EMOJI.map((e) => [e.name, e.glyph]),
)

/**
 * What matches what somebody is typing.
 *
 * Names that *start* with it first, then names that merely contain it. Typing
 * "s" should offer smile before melting, and a plain `includes` puts them in
 * table order, which is no order at all from where somebody is sitting.
 */
export function searchEmoji(query: string): Emoji[] {
  const q = query.toLowerCase().trim()
  if (!q) return [...ALL_EMOJI]
  const starts: Emoji[] = []
  const contains: Emoji[] = []
  for (const e of ALL_EMOJI) {
    if (e.name.startsWith(q)) starts.push(e)
    else if (e.name.includes(q)) contains.push(e)
  }
  return [...starts, ...contains]
}

/** The matches, back in their groups, for a picker that shows headings. */
export function groupsFor(query: string): EmojiGroup[] {
  const hits = searchEmoji(query)
  const keep = new Set(hits.map((e) => e.name))
  const out: EmojiGroup[] = []
  for (const [group, list] of EMOJI_GROUPS) {
    const kept = list.filter(([name]) => keep.has(name))
    if (kept.length) out.push([group, kept])
  }
  return out
}
