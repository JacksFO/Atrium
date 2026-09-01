/**
 * What somebody is doing, as this server is willing to repeat it.
 *
 * Presence is the one thing here that a client asserts about itself and every
 * other client then renders. Nothing checks it, because nothing can: only
 * that machine knows what is playing on it. So the whole of the safety is in
 * what this will carry, and it is deliberately narrow - two kinds, short
 * text, and a picture that has to actually be a picture.
 *
 * Its own file, and pure, because "what may be broadcast to everyone" is a
 * question worth being able to ask directly rather than one buried in a
 * switch statement in the gateway.
 */

export type Activity = {
  /** Games and music. Nothing else, on purpose - see the note on browsers. */
  kind: 'game' | 'music'
  /** The game, or the track. */
  name: string
  /** The artist, or nothing. */
  detail?: string
  /** When it started, for "for 40 minutes". Games only. */
  since?: number
  /** Where it has got to, and how long it is. Music only, both in ms. */
  at?: number
  length?: number
  /** Cover art, small, as a data URI. Music only. */
  art?: string
}

/*
 * Sizes, all of them deliberate.
 *
 * A name and a detail are a line under somebody's name in a list, so anything
 * longer than this is either a mistake or somebody testing what happens. The
 * art is the one that matters: it is repeated to everybody in the server on
 * every track change, so it is a thumbnail or it is nothing. 24KB is a
 * generous 96px JPEG and a tenth of the smallest photo anybody would upload.
 */
const MAX_NAME = 80
const MAX_DETAIL = 80

/**
 * Cover art is the name of a picture, not the picture.
 *
 * It used to be the whole thing, as a data URI, which meant a few kilobytes
 * to everybody who could see somebody on every track change - and almost all
 * of it for profiles nobody opened. The picture is uploaded once and fetched
 * by whoever actually looks; what travels here is where to find it.
 *
 * A hash and nothing else, so it can never be a path, a URL, or anything
 * with a scheme in it that somebody could point at their own server.
 */
const ART = /^[a-f0-9]{64}$/

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  // Control characters out: a line break in a name would break the row it
  // sits in, and the rest of them have no business in a song title.
  const clean = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
  return clean.length > 0 ? clean : undefined
}

const time = (v: unknown): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined
  return Math.floor(v)
}

/**
 * What this server will repeat, out of what a client claimed.
 *
 * Null for anything it will not: an unknown kind, a nameless activity, or
 * simply nothing playing. The caller broadcasts null as "they stopped", so
 * there is no difference between refusing something and it having ended -
 * which is the right way round. Being unable to say something is not an error
 * worth telling ten people about.
 */
export function cleanActivity(raw: unknown): Activity | null {
  if (!raw || typeof raw !== 'object') return null
  const it = raw as Record<string, unknown>

  const kind = it.kind
  if (kind !== 'game' && kind !== 'music') return null

  const name = text(it.name, MAX_NAME)
  if (!name) return null

  const out: Activity = { kind, name }

  const detail = text(it.detail, MAX_DETAIL)
  if (detail) out.detail = detail

  /*
   * Each kind carries only its own fields.
   *
   * Not tidiness: a game with a position and a length would be drawn as a
   * progress bar that never moves, and a track with a start time would be
   * drawn as having been listened to for six hours. Dropping them here means
   * the thing rendering never has to ask whether it was told the truth.
   */
  /* Both kinds may carry a picture now: a track has its cover, and a game has
     the icon out of its own executable. Neither is the picture itself - it is
     the name of one the server already holds. */
  if (typeof it.art === 'string' && ART.test(it.art)) out.art = it.art

  if (kind === 'game') {
    const since = time(it.since)
    // In the past, and not before this program existed. A start time in the
    // future renders as a negative age, which is a thing nobody has played
    // for -3 minutes.
    if (since !== undefined && since <= Date.now() && since > 1_600_000_000_000) {
      out.since = since
    }
  } else {
    const length = time(it.length)
    const at = time(it.at)
    if (length !== undefined && length > 0) out.length = length
    // Never past the end. A player that reports a stale position while the
    // next track is loading would otherwise draw a bar past its own edge.
    if (at !== undefined) out.at = out.length === undefined ? at : Math.min(at, out.length)
  }

  return out
}

/**
 * Everything somebody is doing at once.
 *
 * People play with music on, and showing one and hiding the other picks for
 * them - so both are carried, and the thing displaying them decides how much
 * room it has. Asked for by example: a profile with "Playing a game" and
 * "Listening to Spotify" one above the other.
 *
 * One of each kind at most, and the first of a kind wins. Two games would be
 * a machine with a launcher and a game open, or a list that matched twice,
 * and neither is two things somebody is doing.
 *
 * Also takes a single one, because that is what the desktop app released
 * before this sends, and a copy somebody has not restarted yet should keep
 * working rather than quietly stop reporting.
 */
export function cleanActivities(raw: unknown): Activity[] {
  const list = Array.isArray(raw) ? raw : [raw]
  const out: Activity[] = []
  for (const item of list.slice(0, 4)) {
    const clean = cleanActivity(item)
    if (!clean) continue
    if (out.some((a) => a.kind === clean.kind)) continue
    out.push(clean)
  }
  return out
}
