import { describe, expect, it } from 'vitest'
import { swipeOutcome } from './swipe'

const shut = { navOpen: false, membersOpen: false }
const quick = (dx: number, dy = 0) => ({ dx, dy, ms: 200 })

describe('a swipe across the app', () => {
  it('opens the channel list going right', () => {
    expect(swipeOutcome(quick(90), shut)).toBe('open-nav')
  })

  it('opens the members going left', () => {
    expect(swipeOutcome(quick(-90), shut)).toBe('open-members')
  })

  /* With a drawer open, the other way puts it back rather than opening the
     opposite one — or a flick left with the channels out would leave both on
     screen and nothing of the conversation. */
  it('closes whichever is open before opening the other', () => {
    expect(swipeOutcome(quick(-90), { navOpen: true, membersOpen: false }))
      .toBe('close-nav')
    expect(swipeOutcome(quick(90), { navOpen: false, membersOpen: true }))
      .toBe('close-members')
  })
})

describe('what is not a swipe', () => {
  it('ignores a short flick', () => {
    expect(swipeOutcome(quick(30), shut)).toBeNull()
    expect(swipeOutcome(quick(-30), shut)).toBeNull()
  })

  it('ignores a slow drag', () => {
    expect(swipeOutcome({ dx: 90, dy: 0, ms: 900 }, shut)).toBeNull()
  })

  /* The one that matters. Get this wrong and every drag down the conversation
     opens a drawer, which makes it unreadable on a phone. */
  it('never mistakes a scroll for one', () => {
    expect(swipeOutcome(quick(60, 300), shut)).toBeNull()
  })

  it('but a diagonal that is mostly sideways still counts', () => {
    expect(swipeOutcome(quick(120, 40), shut)).toBe('open-nav')
  })
})
