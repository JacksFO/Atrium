/**
 * Which game, out of everything running.
 *
 * Its own file, and pure, because this is where the promise the Activity page
 * makes is actually kept: the list of what is running is read here, compared,
 * and dropped. What comes back is one name or nothing at all - so nothing
 * downstream, not the page and not the socket, has ever been in a position to
 * send the rest of it anywhere.
 *
 * That is worth being able to test directly rather than reading carefully and
 * hoping, which is the whole reason it is not three lines inside the poller.
 */

/**
 * The name of the first recognised game, or null.
 *
 * First rather than best: two games running at once is somebody who left one
 * open, and picking between them would need a rule about which they meant
 * that would be wrong as often as it was right. The order is the order
 * Windows gave, which is stable enough that it does not flicker between two.
 */
export function matchGame(
  running: readonly string[],
  list: Readonly<Record<string, string>>,
): string | null {
  for (const raw of running) {
    // Guarded rather than assumed: the list is keyed in lower case, and a
    // process name arriving in any other case would silently match nothing.
    const exe = String(raw ?? '').toLowerCase()
    const name = list[exe]
    if (typeof name === 'string' && name.length > 0) return name
  }
  return null
}
