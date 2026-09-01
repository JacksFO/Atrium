/**
 * Where you were on the conversations side, so the home button can put you
 * back.
 *
 * The button on the rail always went to the home page. That is right once -
 * the first time, when there is nothing to go back to - and wrong every time
 * after it: somebody clicking away to a server and back is going back to what
 * they were reading, and being shown the greeting instead means finding the
 * conversation again by hand.
 *
 * It then remembered only conversations, which is wrong in the other
 * direction. The home side is three things - the greeting, the friends list,
 * and whatever conversation is open - and coming back to it should be coming
 * back to whichever of them you left. Remembering only the last of the three
 * meant somebody who was looking at their friends list, or at the greeting
 * itself, was put into a conversation they might have closed an hour before.
 * Reported as the home button always going to the last DM.
 *
 * Kept on this machine and for a day, not for the tab's lifetime: the app
 * reloads whenever an update ships, and a reload is exactly the moment this
 * is worth surviving. Older than that and "where you were" is not a fact
 * about now, it is a fact about Tuesday.
 */
const KEY = 'atrium.lastdm'
const MAX_AGE_MS = 24 * 60 * 60_000

/** One of the three places the conversations side can be. */
export type Spot =
  | { kind: 'dm'; channelId: string }
  | { kind: 'page'; page: 'home' | 'friends' }

type Stored = Spot & { at: number }

export function rememberSpot(spot: Spot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...spot, at: Date.now() } satisfies Stored))
  } catch { /* private window */ }
}

/** Nothing to go back to: cleared when a conversation is closed or gone. */
export function forgetSpot(): void {
  try { localStorage.removeItem(KEY) } catch { /* private window */ }
}

export function lastSpot(): Spot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const spot = JSON.parse(raw) as Partial<Stored> & { channelId?: string }
    if (typeof spot?.at !== 'number' || Date.now() - spot.at > MAX_AGE_MS) return null

    if (spot.kind === 'page') {
      return spot.page === 'home' || spot.page === 'friends'
        ? { kind: 'page', page: spot.page }
        : null
    }
    /*
     * A conversation, including one written before this remembered anything
     * else: that shape had no `kind` at all, only a channel and a time. It
     * costs one line to keep reading it, and the alternative is everybody
     * who has the app open losing their place the moment this ships.
     */
    return spot.channelId ? { kind: 'dm', channelId: spot.channelId } : null
  } catch {
    return null
  }
}
