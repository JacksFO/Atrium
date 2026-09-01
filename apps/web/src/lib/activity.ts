import type { Activity } from './wire'

/**
 * What somebody is up to, in the two places it is said.
 *
 * A list and a card read differently, and the same fact belongs in different
 * words in each. That is the whole of this file: a member list wants one
 * short line that does not move, and a profile wants the detail with a clock
 * running on it.
 */

/**
 * The line under somebody's name, for the member list.
 *
 * A game is named because the name is the whole of what is interesting. Music
 * is not: a row of forty people each showing a different song title is a wall
 * of text nobody reads, and the track is on their profile a click away. So it
 * says what they are doing rather than what it is — which is what "it shows
 * the whole song" was asking for.
 *
 * No duration here either. One line among forty is the wrong place for a
 * number that changes every minute.
 */
export function activityLine(a: Activity | null | undefined): string {
  if (!a) return ''
  return a.kind === 'game' ? `Playing ${a.name}` : 'Listening to Spotify'
}

/**
 * The same line, in two pieces.
 *
 * A member list draws it as "Listening to **Spotify**" - the verb quiet and
 * the thing itself carrying the weight, because the verb is the same on
 * every row and the name is the part somebody is scanning for. One function,
 * so the words cannot drift apart from the sentence above.
 */
export function activityParts(
  a: Activity | null | undefined,
): { verb: string; what: string } | null {
  if (!a) return null
  return a.kind === 'game'
    ? { verb: 'Playing', what: a.name }
    : { verb: 'Listening to', what: 'Spotify' }
}

/**
 * Which one gets that single line, when somebody is doing two things.
 *
 * The game, because it is the more particular fact: everybody's music says
 * "Listening to Spotify" and only one of them is in a raid. Both still show
 * on the profile, where there is room for both.
 */
export function primaryActivity(list: readonly Activity[] | undefined): Activity | null {
  return list?.find((a) => a.kind === 'game') ?? list?.[0] ?? null
}

/**
 * The order the cards are drawn in on a profile. Game above music, always, so
 * two people's profiles do not disagree about which comes first depending on
 * which happened to arrive first.
 */
export function orderedActivities(list: readonly Activity[] | undefined): Activity[] {
  const rank = { game: 0, music: 1 } as const
  return [...(list ?? [])].sort((a, b) => rank[a.kind] - rank[b.kind])
}

/**
 * The little heading above a card. Named for what it is rather than for the
 * app doing it — except for music, where naming the player is the honest
 * thing, because it is the only thing being read.
 */
export function activityHeading(a: Activity | null | undefined): string {
  return a?.kind === 'game' ? 'Playing a game' : 'Listening to Spotify'
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * How long it has been running, as a card shows it.
 *
 * Counted up rather than described: "01:03 elapsed" on a card, where the
 * number moves while you look at it, against "for 45 minutes" in a list of
 * forty people where a moving number is noise. Hours only appear once there
 * are any, so a game opened a minute ago does not read as 00:01:03 and invite
 * the question of what the first pair means.
 */
export function elapsedSince(since: number | undefined, now = Date.now()): string {
  if (since === undefined) return ''
  const whole = Math.max(0, Math.floor((now - since) / 1000))
  const hours = Math.floor(whole / 3600)
  const mins = Math.floor((whole % 3600) / 60)
  return hours > 0
    ? `${hours}:${pad(mins)}:${pad(whole % 60)} elapsed`
    : `${pad(mins)}:${pad(whole % 60)} elapsed`
}

/** A time in a track, as a person writes one. */
export function trackTime(ms: number): string {
  const whole = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(whole / 60)}:${pad(whole % 60)}`
}

export type Progress = { at: number; length: number; pct: number }

/**
 * Where a track has got to, or nothing when there is nothing honest to draw.
 *
 * A player reporting a position and no length — which happens — would get a
 * bar filled to some fraction of nothing, and that bar is a lie rather than a
 * missing feature.
 *
 * `ran` is how long ago the player last said. Without it the bar sat exactly
 * where the last report left it until the next one arrived: a progress bar
 * that does not progress. Clamped to the end, because a track that finished
 * while nobody was looking must not draw past its own edge.
 */
export function trackProgress(
  a: Activity | null | undefined,
  ran = 0,
): Progress | null {
  if (!a || a.kind !== 'music') return null
  const { length, at: reported } = a
  if (!Number.isFinite(length) || length === undefined || length <= 0) return null
  if (!Number.isFinite(reported) || reported === undefined || reported < 0) return null
  const at = Math.min(length, reported + Math.max(0, ran))
  return { at, length, pct: Math.max(0, Math.min(100, (at / length) * 100)) }
}

/**
 * When each of these was first heard about.
 *
 * A track's position is where the player said it was, plus however long ago
 * it said so — so the "however long ago" has to belong to the activity, not
 * to whatever happens to be drawing it. Kept in the card, closing a profile
 * and opening it again started the count from nothing and showed 0:00 forty
 * seconds into a song.
 *
 * The same track still playing keeps the moment it was first heard, so a game
 * starting beside it does not reset the bar to where the song was minutes ago.
 */
export type Heard = Activity & { heardAt: number }

export function stamp(
  list: readonly Activity[],
  before: readonly Heard[] = [],
  now = Date.now(),
): Heard[] {
  return list.map((a) => {
    const same = before.find(
      (b) => b.kind === a.kind && b.name === a.name && b.at === a.at,
    )
    return { ...a, heardAt: same ? same.heardAt : now }
  })
}
