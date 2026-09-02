import { describe, expect, it } from 'vitest'
import {
  cleanSlowmode, mayIgnoreSlowmode, slowmodeMessage, SLOWMODE_MAX, waitLeft,
} from './slowmode.js'

/**
 * Waiting between messages.
 *
 * The cheapest moderation there is - it needs nobody awake. The parts worth
 * pinning are the three that have a wrong answer that looks right: who it
 * applies to, how long is left, and whose last message counts.
 */

const at = (over: Partial<Parameters<typeof waitLeft>[0]> = {}) => waitLeft({
  seconds: 10, lastAt: 1_000_000, exempt: false, now: 1_000_000, ...over,
})

describe('how long is left', () => {
  it('is the whole wait straight after speaking', () => {
    expect(at()).toBe(10)
  })

  it('and less as it goes by', () => {
    expect(at({ now: 1_004_000 })).toBe(6)
  })

  it('and nothing once the wait is up', () => {
    expect(at({ now: 1_010_000 })).toBe(0)
    expect(at({ now: 1_099_000 })).toBe(0)
  })

  /*
   * Rounded up. Four tenths of a second reported as "0 seconds" is a refusal
   * that says everything is fine, which is worse than either answer on its
   * own.
   */
  it('and never rounds a real wait down to nothing', () => {
    expect(at({ now: 1_009_600 })).toBe(1)
  })

  it('and is nothing at all when the channel is not slowed', () => {
    expect(at({ seconds: 0 })).toBe(0)
  })

  /* Somebody who has not spoken here waits for nobody. Slow mode is a gap
     between *your* messages, not a queue for the room. */
  it('and nothing for somebody who has not spoken here', () => {
    expect(at({ lastAt: 0 })).toBe(0)
  })
})

describe('who it does not apply to', () => {
  /*
   * The people whose job is the channel. Being told to slow down while trying
   * to calm one down is the opposite of what this is for.
   */
  it('anybody who can manage the messages or the channel', () => {
    expect(mayIgnoreSlowmode((p) => p === 'manage_messages')).toBe(true)
    expect(mayIgnoreSlowmode((p) => p === 'manage_channels')).toBe(true)
    expect(mayIgnoreSlowmode((p) => p === 'administrator')).toBe(true)
  })

  it('but not somebody who can merely send messages', () => {
    expect(mayIgnoreSlowmode((p) => p === 'send_messages')).toBe(false)
  })

  it('and being exempt means no wait at all', () => {
    expect(at({ exempt: true })).toBe(0)
  })
})

describe('what a channel will accept', () => {
  it('a number of seconds', () => {
    expect(cleanSlowmode(30)).toBe(30)
  })

  it('and nought for off', () => {
    expect(cleanSlowmode(0)).toBe(0)
    expect(cleanSlowmode(-5), 'a negative wait would be a wait that never ends').toBe(0)
  })

  /* Anything at all, because this comes off the wire. */
  it('and refuses nonsense rather than storing it', () => {
    expect(cleanSlowmode('banana')).toBe(0)
    expect(cleanSlowmode(null)).toBe(0)
    expect(cleanSlowmode(undefined)).toBe(0)
    expect(cleanSlowmode(Number.POSITIVE_INFINITY)).toBe(0)
    expect(cleanSlowmode(1.7), 'a fraction of a second is not a setting').toBe(1)
  })

  /* Capped, or somebody sets a year by accident and the channel is closed
     with no sign of why. */
  it('and caps it at six hours', () => {
    expect(cleanSlowmode(99_999_999)).toBe(SLOWMODE_MAX)
  })
})

describe('what somebody is told', () => {
  /* With the number in it. "Wait" on its own is a broken app. */
  it('has the number of seconds in it', () => {
    expect(slowmodeMessage(7)).toContain('7 seconds')
    expect(slowmodeMessage(1)).toContain('1 second')
  })

  /* And minutes once seconds stop being readable - "412 seconds" is a number
     nobody converts. */
  it('and minutes when there are a lot of them', () => {
    expect(slowmodeMessage(412)).toContain('7 minutes')
    expect(slowmodeMessage(60)).toContain('1 minute')
  })
})
