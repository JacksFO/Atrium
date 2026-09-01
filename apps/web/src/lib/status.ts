import type { User } from './wire'

/**
 * What somebody's status says, now.
 *
 * A status can be given a moment to stop at - "back in 20", which nobody
 * wants still saying that tomorrow. The moment goes out with the user, and
 * every place that draws a status asks here rather than reading the field,
 * so an expired one is gone everywhere at once.
 *
 * Worked out on the reader's clock as well as the writer's server, and that
 * is the whole reason this is cheap: nothing sweeps the table, nothing is
 * pushed when a status runs out, and a status already on somebody's screen
 * goes without waiting for anything to be refetched. The cost of being wrong
 * about the clock is a status that lingers or leaves a minute early, which is
 * the right thing to be relaxed about.
 */
export function statusOf(
  user: Pick<User, 'status_text'> & { status_until?: number },
  now = Date.now(),
): string {
  const until = user.status_until ?? 0
  if (until > 0 && now >= until) return ''
  return user.status_text ?? ''
}

/**
 * When the next status on screen runs out, so something can redraw then.
 *
 * A moment rather than an interval: a timer set for the exact second beats
 * asking every thirty of them whether anything has changed, and costs nothing
 * at all while nobody has a timer set.
 *
 * Null when nothing is waiting to expire.
 */
export function nextExpiry(
  users: Iterable<Pick<User, 'status_text'> & { status_until?: number }>,
  now = Date.now(),
): number | null {
  let soonest: number | null = null
  for (const u of users) {
    const until = u.status_until ?? 0
    /* Only ones still to come, and only where there is something to clear:
       a lapsed moment on an empty status would wake the app for nothing. */
    if (until > now && (u.status_text ?? '')) {
      if (soonest === null || until < soonest) soonest = until
    }
  }
  return soonest
}

/** How long a status may be given, as offered. */
export const STATUS_FOR = [
  { label: 'Don’t clear', ms: 0 },
  { label: '30 minutes', ms: 30 * 60_000 },
  { label: '1 hour', ms: 60 * 60_000 },
  { label: '4 hours', ms: 4 * 60 * 60_000 },
  { label: 'Today', ms: -1 },
] as const

/**
 * The moment a choice lands on. 0 stays 0 - "until I say otherwise".
 *
 * "Today" is the end of this day rather than a length of time, which is the
 * one people mean when they set a status in the morning: it should be gone
 * tomorrow, not twenty-four hours from whenever they typed it.
 */
export function statusUntil(ms: number, now = Date.now()): number {
  if (ms === 0) return 0
  if (ms > 0) return now + ms
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  return midnight.getTime()
}
