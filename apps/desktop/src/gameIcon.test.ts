import { describe, expect, it } from 'vitest'
import {
  ICON_READS_MAX,
  iconFor,
  noIconYet,
  sameIcon,
  wantsIconRead,
  withIconRead,
  type IconPixels,
} from './gameIcon'

/**
 * Reported with a screenshot: Counter-Strike 2, three minutes in, showing
 * Windows' generic application icon instead of its own.
 *
 * Not a failure to read it - a failure to read it again. The shell hands back
 * the generic icon for an entry it has not extracted yet and fills the real
 * one in a moment later, and the icon was read exactly once, seconds after
 * the game launched, which is the coldest that entry is ever going to be.
 * Whatever came back then stood for the whole session.
 */

const icon = (byte: number, size = 2): IconPixels => ({
  width: size,
  height: size,
  rgba: new Uint8Array(size * size * 4).fill(byte),
})

/** The placeholder, and the real one that turns up a moment later. */
const GENERIC = icon(1)
const REAL = icon(2)

describe('asking again', () => {
  /*
   * The whole of the bug, as a test.
   *
   * The old rule was "read it when the game changes", which is this same
   * sequence stopping after the first line - and the generic icon standing
   * for as long as somebody played.
   */
  it('replaces the placeholder when the shell warms up', () => {
    let hunt = noIconYet('Counter-Strike 2')

    hunt = withIconRead(hunt, 'Counter-Strike 2', GENERIC)
    expect(hunt.icon, 'the first read is still worth having').toBe(GENERIC)
    expect(wantsIconRead(hunt, 'Counter-Strike 2'), 'it stopped after one').toBe(true)

    hunt = withIconRead(hunt, 'Counter-Strike 2', REAL)
    expect(hunt.icon).toBe(REAL)
  })

  /* And stops once the answer holds still - the common case, where the cache
     was warm all along and the second read agrees with the first. */
  it('and stops once two reads agree', () => {
    let hunt = withIconRead(noIconYet('Hades'), 'Hades', REAL)
    expect(wantsIconRead(hunt, 'Hades')).toBe(true)

    hunt = withIconRead(hunt, 'Hades', icon(2))
    expect(hunt.settled, 'it kept asking after the answer held still').toBe(true)
    expect(wantsIconRead(hunt, 'Hades')).toBe(false)
    expect(hunt.reads, 'a warm game costs two reads').toBe(2)
  })

  /* Compared by pixels rather than by identity: every read builds a new
     buffer, so two reads of the same icon are never the same object. */
  it('and knows two different buffers holding the same picture', () => {
    expect(sameIcon(icon(7), icon(7))).toBe(true)
    expect(sameIcon(icon(7), icon(8))).toBe(false)
    expect(sameIcon(icon(7, 2), icon(7, 4)), 'a size change is a change').toBe(false)
  })
})

describe('a read that found nothing', () => {
  /*
   * Null is the process being gone, or a path that would not resolve. It must
   * not settle the hunt - settling on nothing is the same bug in its other
   * form, where a game shows no icon at all for a whole session.
   */
  it('does not settle it', () => {
    const hunt = withIconRead(noIconYet('Deep Rock Galactic'), 'Deep Rock Galactic', null)
    expect(hunt.icon).toBeUndefined()
    expect(hunt.settled).toBe(false)
    expect(wantsIconRead(hunt, 'Deep Rock Galactic')).toBe(true)
  })

  /* But still counts as a go, or a game this never works for is asked every
     five seconds for as long as somebody plays. */
  it('but still counts as a go', () => {
    let hunt = noIconYet('Deep Rock Galactic')
    for (let i = 0; i < ICON_READS_MAX; i++) {
      hunt = withIconRead(hunt, 'Deep Rock Galactic', null)
    }
    expect(hunt.settled).toBe(true)
    expect(wantsIconRead(hunt, 'Deep Rock Galactic')).toBe(false)
  })

  /* And never throws away a picture it already had for one. */
  it('and never loses an icon it already had', () => {
    let hunt = withIconRead(noIconYet('Factorio'), 'Factorio', REAL)
    hunt = withIconRead(hunt, 'Factorio', null)
    expect(hunt.icon).toBe(REAL)
  })
})

describe('the cap on how long it keeps asking', () => {
  /* An icon that changes every single time - which nothing really does, but
     the cap is what stops that being an endless read. */
  it('gives up after a fixed number of goes', () => {
    let hunt = noIconYet('Rimworld')
    for (let i = 0; i < ICON_READS_MAX; i++) {
      hunt = withIconRead(hunt, 'Rimworld', icon(i + 1))
    }
    expect(hunt.reads).toBe(ICON_READS_MAX)
    expect(hunt.settled).toBe(true)
    expect(wantsIconRead(hunt, 'Rimworld'), 'it kept asking forever').toBe(false)
    expect(hunt.icon, 'it gave up holding the newest answer').toEqual(icon(ICON_READS_MAX))
  })

  /* The hot path. A game somebody has had open for hours asks for nothing,
     which is the reason the cap and the settle exist at all. */
  it('so a long session asks for nothing', () => {
    let hunt = withIconRead(noIconYet('Elite'), 'Elite', REAL)
    hunt = withIconRead(hunt, 'Elite', icon(2))
    for (let i = 0; i < 500; i++) {
      expect(wantsIconRead(hunt, 'Elite')).toBe(false)
    }
  })
})

describe('a different game', () => {
  /* Starts over, however settled the last one was - otherwise the second
     game of an evening wears the first one's icon. */
  it('starts over', () => {
    let hunt = withIconRead(noIconYet('Hades'), 'Hades', REAL)
    hunt = withIconRead(hunt, 'Hades', icon(2))
    expect(hunt.settled).toBe(true)

    expect(wantsIconRead(hunt, 'Stardew Valley')).toBe(true)
    const next = withIconRead(hunt, 'Stardew Valley', GENERIC)
    expect(next.for).toBe('Stardew Valley')
    expect(next.icon, "it kept the last game's icon").toBe(GENERIC)
    expect(next.reads).toBe(1)
    expect(next.settled).toBe(false)
  })

  /* Including when the new game reads nothing at all - the old picture must
     not survive into it. */
  it('even when the new one reads nothing', () => {
    let hunt = withIconRead(noIconYet('Hades'), 'Hades', REAL)
    hunt = withIconRead(hunt, 'Hades', icon(2))

    const next = withIconRead(hunt, 'Stardew Valley', null)
    expect(next.for).toBe('Stardew Valley')
    expect(next.icon, "it wore the last game's icon").toBeUndefined()
  })

  /*
   * And a game that never gets read at all wears no icon rather than the
   * last one's.
   *
   * The read only happens when the running executable behind a name can be
   * found. When it cannot, nothing updates the hunt - so the picture in it
   * still belongs to whatever was open before, and handing that out puts one
   * game's name over another game's icon.
   */
  it('and shows nothing rather than the last icon when it is never read', () => {
    let hunt = withIconRead(noIconYet('Hades'), 'Hades', REAL)
    hunt = withIconRead(hunt, 'Hades', icon(2))

    expect(iconFor(hunt, 'Hades')).toBe(REAL)
    expect(iconFor(hunt, 'Stardew Valley'), "it wore Hades' icon").toBeUndefined()
  })
})
