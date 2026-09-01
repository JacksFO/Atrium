import { beforeEach, describe, expect, it } from 'vitest'
import {
  clamp, movedBy, remember, remembered, resizedBy, restingPlace,
  MIN_H, MIN_W, PIP_H, PIP_W, type Box, type Edge,
} from './pipbox'

const view = { w: 1600, h: 900 }
const box = (over: Partial<Box> = {}): Box =>
  ({ x: 400, y: 300, w: 400, h: 260, ...over })

describe('where it starts', () => {
  it('sits in the bottom right, clear of the call bar', () => {
    const at = restingPlace(view)
    expect(at.w).toBe(PIP_W)
    expect(at.h).toBe(PIP_H)
    expect(at.x + at.w).toBe(view.w - 16)
    expect(at.y + at.h).toBe(view.h - 96)
  })

  it('and shrinks to fit a window too small to hold it', () => {
    const at = restingPlace({ w: 320, h: 240 })
    expect(at.w).toBeLessThanOrEqual(320)
    expect(at.h).toBeLessThanOrEqual(240)
  })
})

describe('moving it', () => {
  it('follows the pointer', () => {
    expect(movedBy(box(), 40, -25, view)).toMatchObject({ x: 440, y: 275 })
  })

  it('but never so far that there is nothing left to grab', () => {
    const off = movedBy(box(), 5000, 5000, view)
    expect(off.x, 'still reachable from the right').toBeLessThanOrEqual(view.w - 56)
    expect(off.y).toBeLessThanOrEqual(view.h - 56)
  })

  it('and never above the top, which would take its own bar with it', () => {
    expect(movedBy(box(), 0, -5000, view).y).toBe(0)
  })

  it('though part of it may hang off an edge, if that is where it was put', () => {
    /* Not "fully on screen": nudged half off the right is somewhere somebody
       chose to put it. */
    const at = movedBy(box(), 900, 0, view)
    expect(at.x + at.w).toBeGreaterThan(view.w)
  })
})

describe('resizing it', () => {
  it('grows to the right from the east edge, and stays put', () => {
    const at = resizedBy(box(), 'e', 60, 0, view)
    expect(at).toMatchObject({ x: 400, w: 460 })
  })

  it('grows to the left from the west edge, which also moves it', () => {
    /* The edge under the pointer has to stay under the pointer. Getting this
       backwards makes the window run away from the hand dragging it. */
    const at = resizedBy(box(), 'w', -60, 0, view)
    expect(at).toMatchObject({ x: 340, w: 460 })
  })

  it('and the same upwards from the north edge', () => {
    const at = resizedBy(box(), 'n', 0, -40, view)
    expect(at).toMatchObject({ y: 260, h: 300 })
  })

  it('takes both at once from a corner', () => {
    const at = resizedBy(box(), 'se', 50, 30, view)
    expect(at).toMatchObject({ w: 450, h: 290, x: 400, y: 300 })
  })

  it('stops at a size still worth looking at', () => {
    const at = resizedBy(box(), 'se', -5000, -5000, view)
    expect(at.w).toBe(MIN_W)
    expect(at.h).toBe(MIN_H)
  })

  it('and holds the far edge still once it is that small', () => {
    /* Dragging the left edge rightwards past the minimum used to carry the
       window across the screen, because the width stopped and the x did not. */
    const at = resizedBy(box(), 'w', 5000, 0, view)
    expect(at.w).toBe(MIN_W)
    expect(at.x + at.w, 'the right edge has not moved').toBe(800)
  })
})

describe('what it remembers', () => {
  beforeEach(() => { localStorage.clear() })

  it('nothing, the first time', () => {
    expect(remembered(view)).toBe(null)
  })

  it('and where you left it after that', () => {
    remember(box({ x: 120, y: 90 }))
    expect(remembered(view)).toMatchObject({ x: 120, y: 90, w: 400, h: 260 })
  })

  it('brought back onto a screen that has since got smaller', () => {
    remember(box({ x: 1400, y: 800 }))
    const at = remembered({ w: 800, h: 600 })!
    expect(at.x).toBeLessThanOrEqual(800 - 56)
    expect(at.y).toBeLessThanOrEqual(600 - 56)
  })

  it('and ignores nonsense rather than drawing a window of NaN', () => {
    localStorage.setItem('atrium.pip', '{"x":null,"w":"wide"}')
    expect(remembered(view)).toBe(null)
    localStorage.setItem('atrium.pip', 'not json at all')
    expect(remembered(view)).toBe(null)
  })
})

describe('keeping the shape of the picture', () => {
  /*
   * Freely resized, the window stops being the shape of what is in it and
   * `object-fit: contain` letterboxes the difference - reported as black bars
   * down a very wide window. Cropping instead would hide part of somebody's
   * screen, so the window is kept the right shape and there is nothing to
   * letterbox.
   */
  const wide = 16 / 9
  const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  it('starts the shape of the picture', () => {
    const at = restingPlace(view, wide)
    expect(at.w / at.h).toBeCloseTo(wide, 5)
  })

  it('and stays that shape however it is dragged', () => {
    for (const edge of EDGES) {
      for (const [dx, dy] of [[120, 0], [0, 90], [-70, -70], [200, -160]]) {
        const at = resizedBy(box(), edge, dx!, dy!, view, wide)
        expect(at.w / at.h, `${edge} by ${dx},${dy}`).toBeCloseTo(wide, 5)
      }
    }
  })

  it('follows the width from a side, and the height from a top or bottom', () => {
    const from = { x: 400, y: 300, w: 320, h: 180 }
    expect(resizedBy(from, 'e', 80, 0, view, wide).w).toBe(400)
    expect(resizedBy(from, 's', 0, 45, view, wide).h).toBe(225)
  })

  it('and holds the edges that were not dragged', () => {
    const from = { x: 400, y: 300, w: 320, h: 180 }
    const at = resizedBy(from, 'nw', -80, 0, view, wide)
    expect(at.x + at.w, 'the right edge').toBeCloseTo(720, 5)
    expect(at.y + at.h, 'and the bottom').toBeCloseTo(480, 5)
  })

  it('keeps the shape at the smallest size too', () => {
    const at = resizedBy(box(), 'se', -5000, -5000, view, wide)
    expect(at.w / at.h).toBeCloseTo(wide, 5)
    expect(at.w).toBeGreaterThanOrEqual(MIN_W)
    expect(at.h).toBeGreaterThanOrEqual(MIN_H)
  })

  it('and a tall picture is allowed to be tall', () => {
    /* A phone screen shared. Its minimum is set by the height, not the width,
       and forcing MIN_W on it would letterbox it at the smallest size. */
    const tall = 9 / 16
    const at = resizedBy(box(), 'se', -5000, -5000, { w: 1600, h: 900 }, tall)
    expect(at.w / at.h).toBeCloseTo(tall, 5)
  })

  it('never grows past the screen, in either direction', () => {
    const at = resizedBy(box(), 'se', 9000, 9000, { w: 1200, h: 400 }, wide)
    expect(at.w).toBeLessThanOrEqual(1200)
    expect(at.h).toBeLessThanOrEqual(400)
    expect(at.w / at.h).toBeCloseTo(wide, 5)
  })

  it('and moving one never reshapes it', () => {
    /* Carrying a window is not resizing it, whatever shape it happens to be. */
    const from = { x: 100, y: 100, w: 333, h: 155 }
    expect(movedBy(from, 40, 40, view)).toMatchObject({ w: 333, h: 155 })
  })
})

describe('clamping', () => {
  it('never returns a box smaller than the minimum', () => {
    const at = clamp({ x: 0, y: 0, w: 10, h: 10 }, view)
    expect(at.w).toBe(MIN_W)
    expect(at.h).toBe(MIN_H)
  })

  it('nor one larger than the window it is in', () => {
    const at = clamp({ x: 0, y: 0, w: 9000, h: 9000 }, view)
    expect(at.w).toBe(view.w)
    expect(at.h).toBe(view.h)
  })
})
