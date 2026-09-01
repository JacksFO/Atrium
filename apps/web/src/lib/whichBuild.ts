/**
 * Which build of Atrium this is, said the way somebody would repeat it.
 *
 * Two different things, because the two clients are versioned differently and
 * pretending otherwise would mean printing something untrue on one of them.
 *
 * The desktop app has a real version: it is installed, it updates itself, and
 * the number is baked in when the shell is built. That is what people mean by
 * "what version are you on", and it is what a bug report needs.
 *
 * A page has no version. It is whatever the server is serving at the moment
 * it was loaded, and reloading can change it - so the honest answer is the
 * build stamp, which is a hash of what was actually delivered. Short, because
 * the whole point is that somebody can read it out.
 */

/** How much of a build stamp is worth showing. Enough to tell two apart. */
const STAMP = 7

export function versionLabel(
  shellVersion: string | undefined | null,
  build: string | undefined | null,
): string {
  const version = (shellVersion ?? '').trim()
  /*
   * A packaged build always knows its version. `0.1.0` was the placeholder it
   * fell back to when nothing defined one, and every packaged copy reported it
   * for a while - so it is treated as "no answer" rather than printed as
   * though it were true.
   */
  if (version && version !== '0.1.0') return `Version ${version}`

  const stamp = (build ?? '').trim()
  if (stamp) return `Build ${stamp.slice(0, STAMP)}`

  /* Neither: a page served straight out of the dev server, which has no
     stamp because nothing built it. Saying so beats an empty line. */
  return 'Development build'
}
