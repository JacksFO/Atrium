/**
 * How long somebody has to wait before saying something again.
 *
 * The cheapest moderation there is: it needs nobody awake, which is the whole
 * point of it. A channel gets busy, or somebody's keyboard gets stuck, and the
 * room stays readable without anybody having to notice in time.
 *
 * Its own file and pure, because the rule has three parts and each of them has
 * a wrong answer that looks right:
 *
 *   - who it applies to. Not the people who are there to moderate it: being
 *     told to slow down while trying to calm a channel is the opposite of
 *     what this is for.
 *   - how long is left, which is what somebody is told rather than a flat
 *     refusal. "Wait" with no number is a broken app.
 *   - what counts as their last message. The one they sent, not the last one
 *     in the channel - otherwise everybody is held up by whoever spoke most
 *     recently, which is not slow mode, it is one queue for the room.
 */

/** The most a channel can be slowed to. Six hours, the way Discord caps it. */
export const SLOWMODE_MAX = 21600

/** Whatever was asked for, as a number of seconds this will accept. */
export function cleanSlowmode(raw: unknown): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, SLOWMODE_MAX)
}

export type SlowmodeCheck = {
  /** Seconds set on the channel. Nought is off. */
  seconds: number
  /** When this person last said something here, or 0 for never. */
  lastAt: number
  /** Whether they are exempt - see mayIgnoreSlowmode. */
  exempt: boolean
  now: number
}

/**
 * How long is left, in whole seconds, or 0 to let it through.
 *
 * Rounded up, because a wait of 0.4 seconds reported as "0 seconds" is a
 * refusal that says everything is fine.
 */
export function waitLeft({ seconds, lastAt, exempt, now }: SlowmodeCheck): number {
  if (exempt || seconds <= 0 || lastAt <= 0) return 0
  const ready = lastAt + seconds * 1000
  if (now >= ready) return 0
  return Math.ceil((ready - now) / 1000)
}

/**
 * Who it does not apply to.
 *
 * The people whose job is the channel. Being told to slow down while trying
 * to calm one down is the opposite of what this is for, and every app that
 * has this exempts them - so somebody who has used one of those will expect
 * it and will not think to check.
 *
 * Asked as "may they manage this" rather than by naming roles, because the
 * answer has to follow the permissions rather than a second copy of them.
 */
export function mayIgnoreSlowmode(has: (permission: string) => boolean): boolean {
  return has('manage_messages') || has('manage_channels') || has('administrator')
}

/** What somebody is told, with the number in it. */
export function slowmodeMessage(left: number): string {
  if (left >= 60) {
    const mins = Math.ceil(left / 60)
    return `This channel is in slow mode. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`
  }
  return `This channel is in slow mode. Try again in ${left} second${left === 1 ? '' : 's'}.`
}
