/**
 * What the last few releases said they changed.
 *
 * Asked for: "a Changelog button in the settings so if someone closes the
 * toast they can go into the settings to double check". The toast reads its
 * copy once and deletes it, on purpose - a card that comes back every launch
 * is a card people learn to dismiss without reading - so Settings needs its
 * own source, and one that can show more than the version you happen to be on.
 *
 * Fetched here rather than in the browser, for the same reason link previews
 * and GIF searches are: the server makes the outbound request, so nobody's
 * address reaches GitHub merely because they opened a settings pane. It also
 * means one machine asks on behalf of everybody, and the answer is shared.
 *
 * Held for half an hour. Releases happen a few times a week at the very most,
 * and thirty minutes is the difference between one request per person per
 * curiosity and one request per server per half hour.
 */

export type Release = {
  version: string
  published: string
  notes: string
}

/** Which repository the releases come from. Configurable for anybody who forks. */
const REPO = process.env.CHANGELOG_REPO ?? 'JacksFO/Atrium'

/** How many to offer. Enough to see what you missed, not a history lesson. */
const HOW_MANY = 10

const HELD_FOR_MS = 30 * 60 * 1000

/**
 * Except for somebody on a version this has never heard of.
 *
 * Half an hour is the wrong answer at exactly the moment this pane is opened.
 * Somebody has just been told the app updated and has come to read what it
 * says - and a snapshot taken before that release went out cannot contain it,
 * so the one person guaranteed to be looking is the one guaranteed to be
 * shown a list their own version is missing from.
 *
 * Two minutes rather than none, because a version that is genuinely not a
 * release - anybody running a local build - would otherwise force a fresh
 * request on every single open, for a version that will never be found.
 */
const UNKNOWN_VERSION_MS = 2 * 60 * 1000

/**
 * And how long to leave GitHub alone after a refresh has failed.
 *
 * Without this a failure was retried on every request that arrived, for ever:
 * a fetch that fails does not update the timestamp, so the snapshot stays
 * older than the window and every caller tries again. GitHub allows sixty an
 * hour to an address with no key, which is how a changelog half an hour stale
 * turns itself into one that is permanently stale.
 */
const AFTER_A_FAILURE_MS = 3 * 60 * 1000

/** A release body can be anything somebody typed; this is a settings pane. */
const MOST_NOTES = 4000

let held: { at: number; releases: Release[] } | null = null
let failedAt = 0
let forcedAt = 0
/** So ten people opening Settings at once make one request, not ten. */
let inFlight: Promise<Release[]> | null = null

function tidy(raw: unknown): Release[] {
  if (!Array.isArray(raw)) return []
  const out: Release[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    // Drafts are not released, and prereleases are not for everybody.
    if (r.draft === true || r.prerelease === true) continue
    const version = String(r.tag_name ?? '').replace(/^v/, '')
    if (!version) continue
    out.push({
      version,
      published: String(r.published_at ?? ''),
      notes: String(r.body ?? '').slice(0, MOST_NOTES),
    })
    if (out.length >= HOW_MANY) break
  }
  return out
}

async function askGitHub(): Promise<Release[]> {
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=${HOW_MANY}`

  /*
   * An AbortController with a timer this clears, rather than
   * AbortSignal.timeout.
   *
   * The convenient form leaves its timer running after the request has
   * finished, which keeps a handle alive - and on Windows that turned the
   * server's shutdown into a libuv assertion, every time the route had been
   * called. The test that found it passed all eleven checks and then exited
   * 3221226505, which is a crash pretending to be a failure.
   */
  const giveUp = new AbortController()
  const timer = setTimeout(() => giveUp.abort(), 8000)

  try {
    const res = await fetch(url, {
      signal: giveUp.signal,
      headers: {
        accept: 'application/vnd.github+json',
        // GitHub refuses anonymous requests with no user agent.
        'user-agent': 'atrium-changelog',
      },
    })
    if (!res.ok) throw new Error(`releases: ${res.status}`)
    return tidy(await res.json())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The releases, from memory when they are fresh enough.
 *
 * A failure hands back whatever is held, however old - a settings pane with
 * last week's changelog is better than one with an error in it, and the
 * alternative to stale is nothing at all.
 */
export async function changelog(mine?: string): Promise<Release[]> {
  const now = Date.now()

  /*
   * A snapshot that is missing the version of the person reading it is known
   * to be wrong, however recently it was taken - so this is a reason to go
   * and look rather than merely a shorter hold. The floor is on how often
   * that is allowed to happen, not on how fresh the copy is.
   */
  const theirs = mine && held && !held.releases.some((r) => r.version === mine)
  const goAndLook = theirs && now - forcedAt >= UNKNOWN_VERSION_MS

  if (held && !goAndLook && now - held.at < HELD_FOR_MS) return held.releases

  /* A refresh that just failed will almost certainly fail again. */
  if (held && now - failedAt < AFTER_A_FAILURE_MS) return held.releases

  if (inFlight) return inFlight
  if (goAndLook) forcedAt = now

  inFlight = askGitHub()
    .then((releases) => {
      held = { at: now, releases }
      return releases
    })
    .catch((err) => {
      failedAt = Date.now()
      if (held) return held.releases
      throw err
    })
    .finally(() => { inFlight = null })

  return inFlight
}

/** For tests, which must not depend on what was asked a moment ago. */
export function forgetChangelog(): void {
  held = null
  inFlight = null
  failedAt = 0
  forcedAt = 0
}

export const CHANGELOG_REPO = REPO
