import { describe, expect, it } from 'vitest'
import { FIRST, KEEP, STEP, grown, moreToShow, trimmed, visible } from './messageWindow'

/**
 * Drawing the end of a channel rather than all of it.
 *
 * The list is only windowed at the top. The bottom is always drawn, because
 * windowing both ends means guessing the height of what is not drawn, and a
 * wrong guess is a scrollbar that jumps under somebody's hand.
 */

const list = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('what is drawn', () => {
  it('is the newest end, not the oldest', () => {
    /* The whole point: you open a channel at what was just said. */
    expect(visible(list(100), 3)).toEqual([97, 98, 99])
  })

  it('is all of it when there is less than the window', () => {
    expect(visible(list(5), FIRST)).toEqual([0, 1, 2, 3, 4])
  })

  it('and all of it when the window is exactly the length', () => {
    expect(visible(list(FIRST), FIRST)).toHaveLength(FIRST)
  })

  it('copes with an empty channel', () => {
    expect(visible([], FIRST)).toEqual([])
  })

  it('and never returns more than it was given', () => {
    for (const n of [0, 1, 79, 80, 81, 5000]) {
      expect(visible(list(n), FIRST).length).toBeLessThanOrEqual(n)
    }
  })

  it('and does not touch what it was given', () => {
    const all = list(200)
    visible(all, 10)
    expect(all).toHaveLength(200)
  })
})

describe('growing it', () => {
  it('adds a step at a time', () => {
    expect(grown(1000, FIRST)).toBe(FIRST + STEP)
  })

  it('but never past what is loaded', () => {
    /* A window larger than the list would ask the server for another page
       while there were still messages in hand that had not been drawn. */
    expect(grown(100, 80)).toBe(100)
    expect(grown(100, 100)).toBe(100)
    expect(grown(5, FIRST)).toBe(5)
  })

  it('and reaches everything in a bounded number of steps', () => {
    let shown = FIRST
    let steps = 0
    while (moreToShow(1000, shown) && steps < 100) { shown = grown(1000, shown); steps += 1 }
    expect(moreToShow(1000, shown)).toBe(false)
    expect(steps).toBeLessThan(20)
  })
})

describe('when to ask the server instead', () => {
  it('is once the window has caught up with what is loaded', () => {
    expect(moreToShow(200, 80)).toBe(true)
    expect(moreToShow(200, 200)).toBe(false)
  })

  it('and immediately, for a channel smaller than one window', () => {
    /* Otherwise a short channel would need a pointless growth step before it
       would page, and the top would feel stuck. */
    expect(moreToShow(12, FIRST)).toBe(false)
  })
})

describe('the sizes themselves', () => {
  it('open with more than a screenful', () => {
    /* So opening a channel and scrolling a little does not immediately have
       to grow, which is the case that would feel like a stutter. */
    expect(FIRST).toBeGreaterThanOrEqual(60)
  })

  it('and grow by less than a page from the server', () => {
    /* Growing is instant and can happen twice without anybody noticing; a
       fetch cannot. */
    expect(STEP).toBeLessThanOrEqual(FIRST)
  })
})

describe('what is kept once you have left', () => {
  it('is a page, which is what opening it fresh would have fetched', () => {
    expect(trimmed(list(500))).toHaveLength(KEEP)
  })

  it('and it is the newest page, not the oldest', () => {
    const kept = trimmed(list(500))
    expect(kept[kept.length - 1]).toBe(499)
  })

  it('a channel shorter than a page is left alone', () => {
    expect(trimmed(list(9))).toEqual(list(9))
    expect(trimmed(list(KEEP))).toHaveLength(KEEP)
  })

  it('and the original is not touched', () => {
    const all = list(500)
    trimmed(all)
    expect(all).toHaveLength(500)
  })

  it('gives a different array, so anything comparing lists notices', () => {
    /* Message lists are copy-on-write for exactly this reason - see
       messageIdentity.test.ts. A trim that mutated in place would be
       invisible to React. */
    const all = list(500)
    expect(trimmed(all)).not.toBe(all)
    const short = list(3)
    expect(trimmed(short)).not.toBe(short)
  })
})

describe('the two together', () => {
  it('leave a channel drawable without another fetch', () => {
    /* Going back in shows the kept page immediately: the window opens larger
       than what is kept, so there is nothing to grow into and the next scroll
       to the top goes straight to the server. */
    const kept = trimmed(list(500))
    expect(visible(kept, FIRST)).toHaveLength(KEEP)
    expect(moreToShow(kept.length, FIRST)).toBe(false)
  })
})
