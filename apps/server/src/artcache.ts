import { createHash } from 'node:crypto'

/**
 * Album covers, kept only as long as anybody is looking at them.
 *
 * Presence used to carry the picture itself, which meant every track change
 * sent a few kilobytes to everybody who could see that person - and at a
 * hundred people that is a gigabyte an hour of album art, almost all of it
 * for profiles nobody opened.
 *
 * So the picture travels once and its name travels after that. The name is
 * the hash of the bytes, which makes it two useful things at once: an address
 * that can never be stale, so a browser may cache it for ever; and a receipt,
 * because a client that claims a hash and sends something else is caught by
 * arithmetic rather than by trust.
 *
 * In memory, never on disk. What somebody listened to and when is not a thing
 * this server keeps - the whole feature is "what are they doing now" - and a
 * cache that survives a restart would quietly become a record.
 */

/** A cover is a thumbnail. Anything larger is not one, whatever it claims. */
export const MAX_ART_BYTES = 32 * 1024

/**
 * How many to keep.
 *
 * Ten friends listening to different things need a handful; a hundred people
 * across an evening might touch a few hundred. At 32KB apiece the whole cache
 * is single-digit megabytes at its worst, which is cheaper than the traffic
 * it removes by three orders of magnitude.
 */
const KEEP = 400

export type Cover = { type: string; bytes: Buffer }

/*
 * A Map, because JavaScript's keeps insertion order - so the oldest key is
 * simply the first one, and re-inserting on a read moves it to the end. That
 * is a least-recently-used cache in two lines and no bookkeeping.
 */
const covers = new Map<string, Cover>()

/** The name a picture has: the hash of exactly these bytes. */
export function nameFor(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Only what a hash can look like, so a name is never a path. */
export function isName(hash: unknown): hash is string {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)
}

/**
 * Keep a picture, if it really is the one it says it is.
 *
 * Returns false for anything that does not match its own hash, is too big to
 * be a thumbnail, or is not one of the two kinds we know how to draw. A
 * client cannot poison another client's cover this way: the address is the
 * content, so the only thing it can store under a hash is the thing that
 * hashes to it.
 */
export function keep(hash: string, type: string, bytes: Buffer): boolean {
  if (!isName(hash)) return false
  if (bytes.length === 0 || bytes.length > MAX_ART_BYTES) return false
  if (type !== 'image/jpeg' && type !== 'image/png') return false
  if (nameFor(bytes) !== hash) return false

  covers.delete(hash)
  covers.set(hash, { type, bytes })
  while (covers.size > KEEP) {
    const oldest = covers.keys().next().value
    if (oldest === undefined) break
    covers.delete(oldest)
  }
  return true
}

/** A picture by name, and a nudge that it is still wanted. */
export function find(hash: string): Cover | null {
  if (!isName(hash)) return null
  const found = covers.get(hash)
  if (!found) return null
  // Looked at, so not the next one to go.
  covers.delete(hash)
  covers.set(hash, found)
  return found
}

/** Whether it is already here, so a client can skip sending it again. */
export function has(hash: string): boolean {
  return isName(hash) && covers.has(hash)
}

/** For tests, and for anything that wants to know the size of this. */
export function count(): number {
  return covers.size
}

export function forget(): void {
  covers.clear()
}
