import { describe, expect, it } from 'vitest'
import {
  PANELS, columnsFor, columnOf, isDefaultOrder, move, place, readOrder, type Panel,
} from './panelOrder'

/**
 * The arrangement somebody chose, and what has to be true of it later.
 *
 * The interesting part is not the rearranging - it is what happens to a
 * stored arrangement when the app it was stored by is not the app reading it.
 * Somebody who moved their member list a year ago should still find it there
 * after an update that added a column, and after one that took one away.
 */

describe('reading a stored order', () => {
  it('takes one it wrote itself', () => {
    expect(readOrder(['members', 'conversation', 'channels', 'servers']))
      .toEqual(['members', 'conversation', 'channels', 'servers'])
  })

  it('and falls back to the default when there is nothing stored', () => {
    expect(readOrder(undefined)).toEqual([...PANELS])
    expect(readOrder(null)).toEqual([...PANELS])
  })

  /* The update case, in both directions. */
  it('keeps the arrangement when a new column is added', () => {
    /* What an older version stored: it had never heard of members. */
    const older = ['conversation', 'channels', 'servers']
    expect(readOrder(older)).toEqual(['conversation', 'channels', 'servers', 'members'])
  })

  it('and ignores a column it has never heard of', () => {
    /* What a newer version stored, read after going back a version. */
    const newer = ['servers', 'threads', 'channels', 'conversation', 'members']
    expect(readOrder(newer)).toEqual(['servers', 'channels', 'conversation', 'members'])
  })

  it('and is not fooled by the same panel twice', () => {
    expect(readOrder(['members', 'members', 'servers']))
      .toEqual(['members', 'servers', 'channels', 'conversation'])
  })

  it('or by something that is not a list of panels at all', () => {
    for (const rubbish of ['members', 42, {}, [1, 2, 3], [null]]) {
      expect(readOrder(rubbish), String(rubbish)).toEqual([...PANELS])
    }
  })

  it('and always returns every panel exactly once', () => {
    for (const stored of [undefined, ['members'], ['x', 'y'], ['members', 'members'],
      ['conversation', 'servers', 'channels', 'members']]) {
      const got = readOrder(stored)
      expect(new Set(got).size, String(stored)).toBe(PANELS.length)
      expect(got.length).toBe(PANELS.length)
    }
  })
})

describe('the columns it produces', () => {
  it('gives each panel its own width, wherever it is', () => {
    /* The width belongs to the panel. Moving the members to the left has to
       take the members' width with it, or the rail lands in a 254px column. */
    expect(columnsFor(['members', 'servers', 'channels', 'conversation']))
      .toBe('var(--rightw) var(--railw) var(--sidew) minmax(0,1fr)')
  })

  it('and the default is the layout as it always was', () => {
    expect(columnsFor([...PANELS]))
      .toBe('var(--railw) var(--sidew) minmax(0,1fr) var(--rightw)')
  })

  it('and a panel knows which column it is in, counting from one', () => {
    const order: Panel[] = ['members', 'servers', 'channels', 'conversation']
    expect(columnOf(order, 'members')).toBe(1)
    expect(columnOf(order, 'conversation')).toBe(4)
  })

  it('and no two panels share a column', () => {
    const order: Panel[] = ['conversation', 'members', 'servers', 'channels']
    const columns = order.map((p) => columnOf(order, p))
    expect(new Set(columns).size).toBe(order.length)
  })
})

describe('moving one along', () => {
  it('goes left and right', () => {
    expect(move([...PANELS], 'members', -1))
      .toEqual(['servers', 'channels', 'members', 'conversation'])
    expect(move([...PANELS], 'servers', 1))
      .toEqual(['channels', 'servers', 'conversation', 'members'])
  })

  /* Wrapping would mean a panel disappearing off one edge and turning up at
     the other, which reads as losing it rather than moving it. */
  it('and stops at the ends rather than wrapping round', () => {
    expect(move([...PANELS], 'servers', -1)).toEqual([...PANELS])
    expect(move([...PANELS], 'members', 1)).toEqual([...PANELS])
  })

  it('and never loses or duplicates a panel', () => {
    let order: Panel[] = [...PANELS]
    for (let i = 0; i < 20; i++) {
      const panel = PANELS[i % PANELS.length]!
      order = move(order, panel, i % 2 ? 1 : -1)
      expect(new Set(order).size).toBe(PANELS.length)
    }
  })
})

describe('dragging one onto another', () => {
  /* A drag slides the others along, the way dragging into a list does. A swap
     would send whatever was there to the far side of the window, which is not
     what anybody dragging one thing onto another expects. */
  it('slides the ones between along rather than swapping', () => {
    expect(place([...PANELS], 'members', 'servers'))
      .toEqual(['members', 'servers', 'channels', 'conversation'])
  })

  it('and dropping to the right lands after the target', () => {
    expect(place([...PANELS], 'servers', 'members'))
      .toEqual(['channels', 'conversation', 'members', 'servers'])
  })

  it('and dropping something on itself changes nothing', () => {
    expect(place([...PANELS], 'channels', 'channels')).toEqual([...PANELS])
  })

  it('and never loses a panel', () => {
    for (const a of PANELS) {
      for (const b of PANELS) {
        expect(new Set(place([...PANELS], a, b)).size, `${a} onto ${b}`).toBe(PANELS.length)
      }
    }
  })
})

describe('knowing when it has been changed', () => {
  it('says so', () => {
    expect(isDefaultOrder([...PANELS])).toBe(true)
    expect(isDefaultOrder(move([...PANELS], 'members', -1))).toBe(false)
  })
})
