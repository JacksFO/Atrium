import { describe, expect, it } from 'vitest'
import { canAnimate, coverRect } from './stillframe'

describe('which pictures can move', () => {
  it('says yes to a GIF', () => {
    expect(canAnimate('/uploads/a1b2c3.gif')).toBe(true)
  })

  it('whatever case it was saved in', () => {
    expect(canAnimate('/uploads/A1B2C3.GIF')).toBe(true)
  })

  /*
   * And to WebP, which is the one that mattered. Choosing a GIF from the
   * provider stores whatever the fetch came back as, and that is very often a
   * WebP - so leaving it out meant an avatar chosen the usual way was never
   * stopped at all.
   */
  it('and to a WebP, which is what a GIF from the provider often becomes', () => {
    expect(canAnimate('/uploads/a1b2c3.webp')).toBe(true)
  })

  it('and no to the ones that certainly cannot move', () => {
    expect(canAnimate('/uploads/a1b2c3.png')).toBe(false)
    expect(canAnimate('/uploads/a1b2c3.jpg')).toBe(false)
    expect(canAnimate('/uploads/a1b2c3.jpeg')).toBe(false)
  })

  it('and no to nobody, who has no picture at all', () => {
    expect(canAnimate(null)).toBe(false)
    expect(canAnimate(undefined)).toBe(false)
    expect(canAnimate('')).toBe(false)
  })

  /* The name ends at the query, or a cache-buster would make every GIF look
     like something else. */
  it('ignores anything hung off the end of the name', () => {
    expect(canAnimate('/uploads/a1b2c3.gif?v=2')).toBe(true)
    expect(canAnimate('/uploads/a1b2c3.gif#top')).toBe(true)
    /* Which is not hypothetical: the avatar route stores the signed url. */
    expect(canAnimate('/uploads/a1b2c3.webp?sig=abc123&exp=99')).toBe(true)
  })

  /* ".gif" in a folder name is not a GIF, and a file called "cat.gif.png" is
     a PNG - both are ways of saying the extension is the end of the name. */
  it('and is not fooled by the word appearing elsewhere', () => {
    expect(canAnimate('/uploads/gifs/a1b2c3.png')).toBe(false)
    expect(canAnimate('/uploads/cat.gif.png')).toBe(false)
    expect(canAnimate('/uploads/webp/a1b2c3.jpg')).toBe(false)
  })
})

describe('the part of a picture a square avatar shows', () => {
  /*
   * The avatar is square and object-fit: cover, so the still has to be cut
   * the same way. A still that does not match what it replaced looks like
   * the picture changed rather than stopped, which is worse than the thing
   * being fixed.
   */
  it('takes the middle of a wide picture, full height', () => {
    expect(coverRect(200, 100, 50, 50)).toEqual({ sx: 50, sy: 0, sw: 100, sh: 100 })
  })

  it('and the middle of a tall one, full width', () => {
    expect(coverRect(100, 200, 50, 50)).toEqual({ sx: 0, sy: 50, sw: 100, sh: 100 })
  })

  it('and all of one already the right shape', () => {
    expect(coverRect(120, 120, 50, 50)).toEqual({ sx: 0, sy: 0, sw: 120, sh: 120 })
  })

  /* Trimmed evenly, so the middle of the picture stays the middle. */
  it('trims the same amount from both sides', () => {
    const r = coverRect(300, 100, 50, 50)
    expect(r.sx).toBe((300 - r.sw) / 2)
    expect(r.sw).toBe(100)
  })

  /* Not square boxes too, since the same rule serves a banner. */
  it('handles a box that is not a square', () => {
    expect(coverRect(300, 300, 300, 100)).toEqual({ sx: 0, sy: 100, sw: 300, sh: 100 })
  })

  /* A picture that has not loaded reports 0x0. Returning something rather
     than dividing by it keeps this a saving that quietly does not happen. */
  it('gives up rather than dividing by nothing', () => {
    expect(coverRect(0, 0, 50, 50)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 })
    expect(coverRect(100, 100, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 })
  })
})
