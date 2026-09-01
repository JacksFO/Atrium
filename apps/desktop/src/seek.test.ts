import { describe, it, expect } from 'vitest'
import { movedDeliberately, SEEK_MS } from './seek'

/**
 * Telling a rewind from a second passing.
 *
 * Both of the obvious answers are wrong: reporting every position is twelve
 * messages a minute per person to everyone who can see them, and reporting
 * none of them means a rewind never shows - which is what happened, and was
 * reported.
 */

const now = 1_800_000_000_000

describe('a track simply playing', () => {
  it('is not news, however long it has been', () => {
    // Told 30s in, a minute ago: it should be 90s in, and it is.
    expect(movedDeliberately(90_000, 30_000, now - 60_000, now)).toBe(false)
  })

  it('and small drift is still not news', () => {
    // Players round, and a check does not land on the same millisecond twice.
    expect(movedDeliberately(91_500, 30_000, now - 60_000, now)).toBe(false)
    expect(movedDeliberately(88_500, 30_000, now - 60_000, now)).toBe(false)
  })
})

describe('somebody moving it', () => {
  it('a rewind is news', () => {
    // Should be 90s in; the player says 10s.
    expect(movedDeliberately(10_000, 30_000, now - 60_000, now)).toBe(true)
  })

  it('and so is a skip forward', () => {
    expect(movedDeliberately(150_000, 30_000, now - 60_000, now)).toBe(true)
  })

  it('and a rewind to the very start, which is the obvious way to do it', () => {
    expect(movedDeliberately(0, 30_000, now - 60_000, now)).toBe(true)
  })

  /*
   * The edge of the tolerance, both sides of it, so the number means what it
   * says rather than roughly what it says.
   */
  it('at exactly the tolerance it is still just playing', () => {
    expect(movedDeliberately(90_000 + SEEK_MS, 30_000, now - 60_000, now)).toBe(false)
  })

  it('and a millisecond past it, it is not', () => {
    expect(movedDeliberately(90_000 + SEEK_MS + 1, 30_000, now - 60_000, now)).toBe(true)
  })
})

describe('having nothing to compare against', () => {
  it('makes anything news, because there is no prediction to fail', () => {
    expect(movedDeliberately(45_000, 0, 0, now)).toBe(true)
  })
})
