import { describe, expect, it } from 'vitest'
import { foldSide, PANELS, readOrder, type Panel } from './panelOrder'

/**
 * Which way the channel list folds, and what the way back is drawn on.
 *
 * Reported as the arrow sitting at the far left of the window rather than on
 * the panel it belongs to - which is only right for the arrangement it was
 * written against. Panels can be dragged anywhere, so both the direction and
 * the thing it is attached to have to come out of the order.
 */

const order = (...p: Panel[]) => readOrder(p)

describe('the way a panel folds', () => {
  it('is left, for the channel list where it starts', () => {
    expect(foldSide([...PANELS], 'channels').side).toBe('left')
  })

  it('and left for anything at the very left', () => {
    expect(foldSide([...PANELS], 'servers').side).toBe('left')
  })

  it('but right once it has been dragged past the middle', () => {
    /* The member list's usual place. Folding a panel there off to the left
       would send it across the whole window to get out of the way. */
    expect(foldSide([...PANELS], 'members').side).toBe('right')
    expect(foldSide(order('servers', 'conversation', 'channels', 'members'), 'channels').side)
      .toBe('right')
  })

  it('and right at the far right, whichever panel is there', () => {
    expect(foldSide(order('servers', 'conversation', 'members', 'channels'), 'channels').side)
      .toBe('right')
  })
})

describe('what the way back is drawn on', () => {
  it('is the panel that moves into its place, folding left', () => {
    expect(foldSide([...PANELS], 'channels').against).toBe('conversation')
  })

  it('and the panel it sat after, folding right', () => {
    expect(foldSide(order('servers', 'conversation', 'members', 'channels'), 'channels').against)
      .toBe('members')
  })

  it('following the arrangement rather than a fixed neighbour', () => {
    /* The whole point: it is the conversation only in the arrangement it was
       written against. Third of four is nearer the right edge, so that one
       folds right and leaves the arrow on the member list beside it. */
    const moved = foldSide(order('servers', 'members', 'channels', 'conversation'), 'channels')
    expect(moved.side).toBe('right')
    expect(moved.against).toBe('members')

    const first = foldSide(order('members', 'channels', 'servers', 'conversation'), 'channels')
    expect(first.side).toBe('left')
    expect(first.against).toBe('servers')
  })

  it('and is never the panel itself, wherever it is', () => {
    for (const arrangement of [
      [...PANELS],
      order('channels', 'servers', 'conversation', 'members'),
      order('servers', 'conversation', 'members', 'channels'),
    ]) {
      expect(foldSide(arrangement, 'channels').against).not.toBe('channels')
    }
  })
})
