/**
 * Reading a game's icon until Windows gives us the real one.
 *
 * The icon comes out of the running game's own executable, by way of the
 * shell's image lists. That works because the shell keeps an extracted copy
 * of every icon it has been asked for - and the catch is what happens when it
 * has not been asked for this one yet. A cold entry does not fail: it hands
 * back the generic application icon, a perfectly valid picture of nothing in
 * particular, and fills the real one in a moment later.
 *
 * Which was fine, until the read happened once and never again. The icon was
 * read when the game changed, so the one moment it was ever asked was seconds
 * after a game launched - the coldest the entry is ever going to be. Get the
 * placeholder there and it stood for the whole session, however many hours
 * that ran. Seen once in a week of playing: the cache is usually warm from
 * last time, and goes cold when the file changes, which for a game that
 * updates as often as it is played is every few days.
 *
 * So: read it again until the answer stops changing. Two reads that agree is
 * the shell having settled, and the cap is there because a program whose icon
 * genuinely will not resolve should cost a handful of reads rather than one
 * every five seconds for as long as somebody plays.
 *
 * Its own file and pure, because it is a rule worth checking rather than a
 * line buried in a timer. What it never does is decide a picture is "the
 * generic one" by looking at it - there is no honest way to tell a placeholder
 * from a game that really does ship a plain icon, and a rule that guessed
 * would throw away the correct answer for somebody.
 */

/** An icon as the native side hands it over: raw pixels and a size. */
export type IconPixels = { width: number; height: number; rgba: Uint8Array }

/** Where the reading of one game's icon has got to. */
export type IconHunt = {
  /** The game this is about, so a different one starts over. */
  for: string
  /** The best answer so far, if there has been one. */
  icon?: IconPixels
  /** How many times it has been asked. */
  reads: number
  /** Asked enough: either it stopped changing, or it has had its go. */
  settled: boolean
}

/**
 * How many times to ask before letting it be.
 *
 * Five, at a read every five seconds, is up to twenty seconds of asking - and
 * the common case costs two, because a warm read agrees with itself the
 * second time. A warm read is about ten milliseconds; the first, cold one is
 * about half a second and happens either way.
 */
export const ICON_READS_MAX = 5

/** Nothing read yet for this game. */
export function noIconYet(name: string): IconHunt {
  return { for: name, reads: 0, settled: false }
}

/**
 * Is it worth reading the icon this tick?
 *
 * A different game always is. The same one is until it has settled or run out
 * of goes, which is what keeps this off the hot path: a game somebody has had
 * open for three hours answers false here every time.
 */
export function wantsIconRead(hunt: IconHunt, name: string): boolean {
  if (hunt.for !== name) return true
  return !hunt.settled && hunt.reads < ICON_READS_MAX
}

/**
 * The icon for this game, and only for this game.
 *
 * The hunt carries the last game's picture until the next read replaces it,
 * and a read only happens when the running executable behind a name can be
 * found. It nearly always can - but "nearly" is how somebody ends up looking
 * at one game's name over another game's icon, so the name is checked at the
 * point of use rather than assumed at the point of reading.
 */
export function iconFor(hunt: IconHunt, name: string): IconPixels | undefined {
  return hunt.for === name ? hunt.icon : undefined
}

/** The same picture, to the pixel. */
export function sameIcon(a: IconPixels, b: IconPixels): boolean {
  if (a.width !== b.width || a.height !== b.height) return false
  if (a.rgba.length !== b.rgba.length) return false
  for (let i = 0; i < a.rgba.length; i++) if (a.rgba[i] !== b.rgba[i]) return false
  return true
}

/**
 * Fold in what a read came back with.
 *
 * `got` being null is a read that found nothing - the process was gone, or
 * the path would not resolve. That counts as a go, so a game this never works
 * for is not asked forever, but it must not settle the hunt: settling on
 * nothing is how one bad read at launch used to last all session.
 */
export function withIconRead(
  hunt: IconHunt,
  name: string,
  got: IconPixels | null,
): IconHunt {
  const from = hunt.for === name ? hunt : noIconYet(name)
  const reads = from.reads + 1
  /* Out of goes, whatever came back. Keep the best answer so far rather than
     the last one, which may be the nothing that just arrived. */
  const spent = reads >= ICON_READS_MAX

  if (!got) return { ...from, reads, settled: spent }

  /* The same answer twice: the shell has stopped changing its mind, and there
     is nothing to gain by asking a third time. */
  if (from.icon && sameIcon(from.icon, got)) {
    return { ...from, reads, settled: true }
  }

  /* Changed, so the shell warmed up between the two - this is the newer and
     therefore better answer, and it is worth one more read to see whether it
     changes again. */
  return { for: name, icon: got, reads, settled: spent }
}
