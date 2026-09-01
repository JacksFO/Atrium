/**
 * A fixed-window rate limiter, in memory.
 *
 * Deliberately not a dependency: seven users on a private network do not need
 * a distributed limiter, and one Map is easier to reason about than a plugin.
 * If this ever runs more than one process, this needs to move to the database.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Returns true if the call is allowed, false if the caller is over budget. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (bucket.count >= max) return false

  bucket.count += 1
  return true
}

/** Seconds until the caller may try again. */
export function retryAfter(key: string): number {
  const bucket = buckets.get(key)
  if (!bucket) return 0
  return Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000))
}

/** Clear a key early — used so a successful login does not stay penalised. */
export function reset(key: string): void {
  buckets.delete(key)
}

// Expired buckets would otherwise accumulate for every IP that ever connected.
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}, 60_000).unref()
