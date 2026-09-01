import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

/**
 * Links to attachments that only work if we issued them.
 *
 * Files were served to anybody who asked. The names are random, so nothing
 * could be guessed, but a link is a thing people copy - and a file posted in
 * a private channel was then readable by whoever the link reached, for ever,
 * including after the message it belonged to was deleted.
 *
 * This is the model every serious file host moved to. The name still
 * identifies the file; the signature says we meant you to have it, and when
 * that stops being true.
 *
 * Avatars and banners are deliberately not signed. Everybody in the space
 * can see them anyway, they are referenced from a dozen places, and an
 * expiring link to somebody's profile picture buys nothing.
 */

const DAY_MS = 24 * 60 * 60_000

/** How long an issued link stays good for. */
const LIFETIME_MS = 7 * DAY_MS

function digest(name: string, expires: number): string {
  return createHmac('sha256', config.authSecret)
    .update(`${name}:${expires}`)
    .digest('base64url')
    .slice(0, 32)
}

/**
 * When a link issued now should stop working.
 *
 * Rounded to the day on purpose. A fresh expiry on every read would mean a
 * different URL every time a channel was opened, and the browser would
 * download every image again rather than using the copy it already has.
 */
export function expiryFor(now: number = Date.now()): number {
  return Math.ceil(now / DAY_MS) * DAY_MS + LIFETIME_MS
}

/** A stored path with proof attached. Takes and returns `/uploads/<name>`. */
export function signPath(path: string, now: number = Date.now()): string {
  const name = path.split('/').pop() ?? ''
  if (!name) return path
  const expires = expiryFor(now)
  return `${path}?e=${expires}&s=${digest(name, expires)}`
}

/** Whether this name may be served on the strength of these parameters. */
export function signatureValid(
  name: string,
  expires: string | undefined,
  signature: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!expires || !signature) return false
  const at = Number(expires)
  if (!Number.isFinite(at) || at < now) return false

  const expected = Buffer.from(digest(name, at))
  const given = Buffer.from(signature)
  // Same length is a precondition of the comparison, not a hint about it:
  // timingSafeEqual throws rather than returning false on a mismatch.
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}
