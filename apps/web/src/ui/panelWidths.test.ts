import { describe, expect, it } from 'vitest'
import { fit, GRIPS } from './usePanelWidths'
import { DEFAULTS } from '../lib/settings'

describe('a width somebody dragged to', () => {
  it('is kept between the limits', () => {
    expect(fit(GRIPS.side, 10)).toBe(GRIPS.side.min)
    expect(fit(GRIPS.side, 9999)).toBe(GRIPS.side.max)
    expect(fit(GRIPS.side, 300)).toBe(300)
  })

  /*
   * Nothing saved, or something that is not a number, falls back to the width
   * the panel counts as normal — not to the minimum, which would be a layout
   * quietly collapsing to its narrowest the first time anybody opened the app
   * on a new machine.
   */
  it('and nothing saved is the ordinary width, not the smallest', () => {
    expect(fit(GRIPS.side, 0)).toBe(GRIPS.side.at)
    expect(fit(GRIPS.side, Number.NaN)).toBe(GRIPS.side.at)
    expect(fit(GRIPS.side, -50)).toBe(GRIPS.side.at)
  })
})

describe('the defaults and the limits', () => {
  /* A default outside its own limits is a layout that moves the first time
     anybody drags anything, without being asked to. */
  it('agree with each other', () => {
    for (const [name, g] of Object.entries(GRIPS)) {
      const saved = DEFAULTS[g.key]
      expect(fit(g, saved), name).toBe(saved)
    }
  })

  /* Each panel is laid out from its own property, and two sharing one would
     move together. */
  it('and every panel is sized by a property of its own', () => {
    const props = Object.values(GRIPS).map((g) => g.prop)
    expect(new Set(props).size).toBe(props.length)
  })
})
