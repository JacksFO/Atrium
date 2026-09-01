/**
 * The faces you actually reach for.
 *
 * The row on a message menu was four fixed emoji and a way to the rest. Fine
 * as a starting point, and wrong a week later: somebody whose group answers
 * everything with one particular face has to go through the picker for it
 * every single time, while four they never use sit in front of them.
 *
 * So the row learns. What you last used goes to the front, the defaults fill
 * whatever is left, and the count stays the same - this makes the row more
 * useful, not longer.
 */

/** Where the row starts, for somebody who has not reacted to anything yet. */
export const DEFAULT_QUICK = ['👍', '😂', '🔥', '❤️'] as const

/** How many faces the row holds, not counting the way to all the others. */
export const QUICK_COUNT = DEFAULT_QUICK.length

const KEY = 'atrium.recentEmoji'

/**
 * Read what is remembered, and never trust it.
 *
 * Anything in browser storage was written by some version of this app and
 * might have been written by a different one, or edited by hand. A row built
 * from rubbish is a menu of blank buttons, so it is filtered down to strings
 * that could plausibly be an emoji and capped.
 */
export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const seen = JSON.parse(raw) as unknown
    if (!Array.isArray(seen)) return []
    const out: string[] = []
    for (const e of seen) {
      /* Short, non-empty, and not something with a newline in it. Emoji vary
         wildly in length once skin tones and joiners are involved, so this
         cannot be exact - it only has to keep a menu drawable. */
      if (typeof e !== 'string') continue
      const face = e.trim()
      if (!face || face.length > 16 || face.includes('\n')) continue
      if (out.includes(face)) continue
      out.push(face)
      if (out.length >= QUICK_COUNT * 3) break
    }
    return out
  } catch {
    return []
  }
}

/** Remember one, at the front. */
export function remember(face: string): string[] {
  const next = [face, ...readRecent().filter((e) => e !== face)].slice(0, QUICK_COUNT * 3)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* A row that forgets when the tab closes is worse than one that
       remembers, and much better than an app that will not react at all. */
  }
  return next
}

/**
 * The row to draw: what they use, then the defaults, to a fixed length.
 *
 * The defaults are still there behind whatever has been used, so a row never
 * looks half-empty - somebody who has reacted exactly once sees their one
 * face and three familiar ones rather than one face and three gaps.
 */
export function quickRow(recent: readonly string[] = readRecent()): string[] {
  const out: string[] = []
  for (const face of [...recent, ...DEFAULT_QUICK]) {
    if (out.includes(face)) continue
    out.push(face)
    if (out.length === QUICK_COUNT) break
  }
  return out
}
