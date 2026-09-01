import { describe, expect, it } from 'vitest'
import {
  LONG_EDGE, SMALL_ENOUGH, couldShrink, fitWithin, shrunkName, worthKeeping,
  AVATAR_EDGE, BANNER_EDGE, PROFILE_SMALL_ENOUGH, ANIMATED_LIMIT,
} from './shrinkimage'

describe('which pictures are worth shrinking', () => {
  const big = SMALL_ENOUGH * 8

  it('a large photo or screenshot is', () => {
    expect(couldShrink('image/jpeg', big)).toBe(true)
    expect(couldShrink('image/png', big)).toBe(true)
    expect(couldShrink('image/webp', big)).toBe(true)
  })

  /*
   * A canvas draws one frame of a GIF, so shrinking one would quietly turn
   * an animation into a picture of its first moment. That is a worse thing
   * to do to somebody than sending a few megabytes.
   */
  it('a GIF is not, whatever size it is', () => {
    expect(couldShrink('image/gif', big)).toBe(false)
    expect(couldShrink('image/gif', 20 * 1024 * 1024)).toBe(false)
  })

  it('and nor is anything that is not a picture', () => {
    expect(couldShrink('video/mp4', big)).toBe(false)
    expect(couldShrink('application/pdf', big)).toBe(false)
    expect(couldShrink('text/plain', big)).toBe(false)
    expect(couldShrink(undefined, big)).toBe(false)
    expect(couldShrink('', big)).toBe(false)
  })

  /* Already cheap, and re-encoding one is as likely to add bytes as remove
     them - a flat PNG of a dialog box being the classic case. */
  it('nor a small one', () => {
    expect(couldShrink('image/png', 40 * 1024)).toBe(false)
    expect(couldShrink('image/png', SMALL_ENOUGH)).toBe(false)
    expect(couldShrink('image/png', SMALL_ENOUGH + 1)).toBe(true)
  })

  it('and the type is read however it was capitalised', () => {
    expect(couldShrink('IMAGE/PNG', big)).toBe(true)
  })
})

describe('the size it comes out at', () => {
  it('caps the long edge and keeps the shape', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048 })
  })

  /* A phone screenshot: very tall, and the tall edge is the one that is capped. */
  it('including a very tall one', () => {
    expect(fitWithin(1179, 2556)).toEqual({ width: 945, height: 2048 })
  })

  it('and leaves alone anything already smaller', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(LONG_EDGE, 100)).toEqual({ width: LONG_EDGE, height: 100 })
  })

  it('and never produces a zero edge', () => {
    const r = fitWithin(10000, 3)
    expect(r.width).toBe(LONG_EDGE)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })

  it('and gives up on a picture with no size', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 })
    expect(fitWithin(-5, 10)).toEqual({ width: 0, height: 0 })
  })
})

describe('whether to keep the smaller one', () => {
  it('yes when it is much smaller', () => {
    expect(worthKeeping(6_000_000, 570_000)).toBe(true)
  })

  /*
   * No when it barely moved. That is a picture that was already about the
   * right size, and swapping it would spend quality for nothing.
   */
  it('no when it barely moved', () => {
    expect(worthKeeping(1_000_000, 950_000)).toBe(false)
    expect(worthKeeping(1_000_000, 850_000)).toBe(false)
    expect(worthKeeping(1_000_000, 840_000)).toBe(true)
  })

  it('and never when re-encoding made it bigger', () => {
    expect(worthKeeping(300_000, 400_000)).toBe(false)
  })

  it('and not on an empty result', () => {
    expect(worthKeeping(300_000, 0)).toBe(false)
  })
})

describe('what it is called afterwards', () => {
  it('keeps the name and corrects the extension', () => {
    expect(shrunkName('holiday.jpg')).toBe('holiday.webp')
    expect(shrunkName('Screenshot 2026-08-26.png')).toBe('Screenshot 2026-08-26.webp')
    expect(shrunkName('already.webp')).toBe('already.webp')
  })

  it('and only the extension on the end', () => {
    expect(shrunkName('my.png.photo.jpeg')).toBe('my.png.photo.webp')
  })

  it('and copes with no name at all', () => {
    expect(shrunkName('')).toBe('picture.webp')
  })
})

/**
 * A picture of a person, at the size a person is drawn.
 *
 * Reported from real use: opening somebody's profile from an @ in chat was
 * laggy, and the member column with it. Measured on the live server - ten and
 * a half megabytes of avatars and banners across five files, one of them a
 * 2,948 KB PNG drawn as a circle about thirty pixels across. Pictures shared
 * in a conversation had been shrunk before sending for a long time; profile
 * pictures went up untouched, so the same photo was cheap in a message and
 * enormous as an avatar.
 */
describe('a profile picture is capped much harder than a photo', () => {
  it('an avatar is stored near the size it is drawn', () => {
    // A member list circle is about 30px and a profile card about 80. 256 is
    // four times the largest of those, so it is still right on a good screen.
    expect(AVATAR_EDGE).toBe(256)
    expect(fitWithin(2000, 2000, AVATAR_EDGE)).toEqual({ width: 256, height: 256 })
    expect(fitWithin(1920, 1080, AVATAR_EDGE)).toEqual({ width: 256, height: 144 })
  })

  it('and a banner gets more room, being drawn across a card', () => {
    expect(BANNER_EDGE).toBe(1024)
    expect(fitWithin(4000, 1500, BANNER_EDGE)).toEqual({ width: 1024, height: 384 })
  })

  it('one already small enough is left alone', () => {
    expect(fitWithin(96, 96, AVATAR_EDGE)).toEqual({ width: 96, height: 96 })
  })

  /*
   * The threshold that matters. SMALL_ENOUGH is 256 KB, which is a sensible
   * floor for a photograph somebody might open full screen and a ridiculous
   * one for a circle - a 200 KB avatar would have been left exactly as it was.
   */
  it('is judged against a far lower floor than a shared photo', () => {
    expect(PROFILE_SMALL_ENOUGH).toBeLessThan(SMALL_ENOUGH)
    const avatarSized = 200 * 1024
    expect(couldShrink('image/png', avatarSized), 'as a photo, left alone').toBe(false)
    expect(couldShrink('image/png', avatarSized, PROFILE_SMALL_ENOUGH),
      'as an avatar, shrunk').toBe(true)
  })

  it('but a genuinely tiny one is still not worth re-encoding', () => {
    expect(couldShrink('image/jpeg', 8 * 1024, PROFILE_SMALL_ENOUGH)).toBe(false)
  })

  /*
   * An animation cannot be resized here at all: a canvas draws one frame, so
   * shrinking a GIF would quietly turn it into a picture of its first moment.
   * That is why couldShrink refuses them, and why the only lever left is
   * refusing an oversized one outright.
   */
  it('an animation is never redrawn, at any size', () => {
    for (const bytes of [100 * 1024, 5 * 1024 * 1024]) {
      expect(couldShrink('image/gif', bytes, PROFILE_SMALL_ENOUGH)).toBe(false)
    }
  })

  it('so there is a limit on how large an animated one may be', () => {
    expect(ANIMATED_LIMIT).toBe(2 * 1024 * 1024)
    // The banner that prompted this was 4,823 KB.
    expect(4823 * 1024).toBeGreaterThan(ANIMATED_LIMIT)
  })

  /* The real files, and what the cap would have done to them. */
  it('and the numbers are what was actually on the server', () => {
    const measured = [
      { what: 'a PNG avatar', bytes: 2948 * 1024, type: 'image/png' },
      { what: 'a PNG banner', bytes: 2617 * 1024, type: 'image/png' },
      { what: 'a WebP avatar', bytes: 171 * 1024, type: 'image/webp' },
      { what: 'a JPEG avatar', bytes: 16 * 1024, type: 'image/jpeg' },
    ]
    const shrinkable = measured.filter((m) => couldShrink(m.type, m.bytes, PROFILE_SMALL_ENOUGH))
    // Everything but the 16 KB one, which is already smaller than the floor.
    expect(shrinkable.map((m) => m.what)).toEqual([
      'a PNG avatar', 'a PNG banner', 'a WebP avatar',
    ])
  })
})
