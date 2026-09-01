import { describe, it, expect } from 'vitest'
import { cleanActivity, cleanActivities } from './activity.js'

/**
 * What the server will repeat about somebody.
 *
 * Presence is the one thing a client asserts about itself and every other
 * client then draws. Nothing can check it - only that machine knows what is
 * playing on it - so the whole of the safety is in what is allowed through,
 * and this is where that is decided.
 *
 * Written from the other side deliberately: most of these are things that
 * must NOT come out the far end.
 */

const music = (over = {}) => ({ kind: 'music', name: 'Song', ...over })
const game = (over = {}) => ({ kind: 'game', name: 'Tarkov', ...over })

describe('what it carries', () => {
  it('a game, with what it is and when it started', () => {
    const since = Date.now() - 60_000
    expect(cleanActivity(game({ since }))).toEqual({ kind: 'game', name: 'Tarkov', since })
  })

  it('a track, with the artist and where it has got to', () => {
    expect(cleanActivity(music({ detail: 'Someone', at: 30_000, length: 200_000 })))
      .toEqual({ kind: 'music', name: 'Song', detail: 'Someone', at: 30_000, length: 200_000 })
  })

  it('and the name of a cover, when it looks like one', () => {
    const art = 'a'.repeat(64)
    expect(cleanActivity(music({ art }))?.art).toBe(art)
  })
})

describe('what it refuses', () => {
  it('anything that is not one of the two kinds', () => {
    expect(cleanActivity({ kind: 'watching', name: 'you' })).toBe(null)
    expect(cleanActivity({ kind: 'game' })).toBe(null)
    expect(cleanActivity(null)).toBe(null)
    expect(cleanActivity('Tarkov')).toBe(null)
  })

  /*
   * The row is one line under a name. Anything longer is a mistake or
   * somebody finding out what happens, and either way it is not going out at
   * full length to ten people.
   */
  it('a name longer than a line', () => {
    const long = cleanActivity(game({ name: 'x'.repeat(500) }))
    expect(long?.name.length).toBe(80)
  })

  it('line breaks and control characters in a title', () => {
    const out = cleanActivity(music({ name: 'Song\n\r\u0000 name' }))
    expect(out?.name).toBe('Song    name')
    expect(out?.name).not.toMatch(/[\u0000-\u001f\u007f]/)
  })

  /*
   * Cover art is repeated to everybody in the server every time a track
   * changes, so it is a thumbnail or it is nothing.
   */
  /*
   * A name, and only ever a name. Anything with a scheme or a slash in it
   * would be a picture fetched from wherever the sender fancied, which is
   * the whole reason this is a hash and not a URL.
   */
  it('a cover name that is anything but a hash', () => {
    expect(cleanActivity(music({ art: 'javascript:alert(1)' }))?.art).toBeUndefined()
    expect(cleanActivity(music({ art: 'https://example.com/cover.jpg' }))?.art).toBeUndefined()
    expect(cleanActivity(music({ art: '../../etc/passwd' }))?.art).toBeUndefined()
    expect(cleanActivity(music({ art: 'data:image/jpeg;base64,AAAA' }))?.art).toBeUndefined()
    expect(cleanActivity(music({ art: 'A'.repeat(64) }))?.art).toBeUndefined()
    expect(cleanActivity(music({ art: 'a'.repeat(63) }))?.art).toBeUndefined()
  })

  /* A game has a picture too now - the icon out of its own executable - so
     what is refused is a name that is not a name, whichever kind it is on. */
  it('a bad cover name on a game, the same as on a track', () => {
    expect(cleanActivity(game({ art: 'https://example.com/icon.png' }))?.art).toBeUndefined()
    expect(cleanActivity(game({ art: 'b'.repeat(64) }))?.art).toBe('b'.repeat(64))
  })
})

/*
 * Each kind carries only its own fields. Not tidiness: a game with a length
 * would be drawn as a progress bar that never moves, and a track with a start
 * time as having been played for six hours.
 */
describe('the two kinds do not borrow from each other', () => {
  it('a game has no position or length', () => {
    expect(cleanActivity(game({ at: 10, length: 100 }))).toEqual({ kind: 'game', name: 'Tarkov' })
  })

  it('a track has no start time', () => {
    expect(cleanActivity(music({ since: Date.now() - 1000 })))
      .toEqual({ kind: 'music', name: 'Song' })
  })
})

describe('times that could not be true', () => {
  it('a start in the future, which would read as not yet begun', () => {
    expect(cleanActivity(game({ since: Date.now() + 60_000 }))?.since).toBeUndefined()
  })

  it('a start before any of this existed', () => {
    expect(cleanActivity(game({ since: 1 }))?.since).toBeUndefined()
  })

  it('a position past the end of the track', () => {
    expect(cleanActivity(music({ at: 999_000, length: 200_000 }))?.at).toBe(200_000)
  })

  it('and anything that is not a number at all', () => {
    expect(cleanActivity(game({ since: 'now' }))?.since).toBeUndefined()
    expect(cleanActivity(music({ at: Number.NaN, length: -5 }))).toEqual({ kind: 'music', name: 'Song' })
  })
})

/*
 * Both at once, because people play with music on. Showing one and hiding the
 * other would be picking for them.
 */
describe('more than one thing at a time', () => {
  it('carries a game and a track together', () => {
    const out = cleanActivities([game(), music({ detail: 'Someone' })])
    expect(out.map((a) => a.kind)).toEqual(['game', 'music'])
  })

  it('but only one of each kind, keeping the first', () => {
    const out = cleanActivities([game({ name: 'First' }), game({ name: 'Second' })])
    expect(out).toEqual([{ kind: 'game', name: 'First' }])
  })

  it('dropping the ones it would refuse on their own', () => {
    const out = cleanActivities([{ kind: 'watching', name: 'you' }, music()])
    expect(out).toEqual([{ kind: 'music', name: 'Song' }])
  })

  /*
   * The desktop app released before this sends one rather than a list. A copy
   * nobody has restarted should keep reporting rather than quietly stop.
   */
  it('and still takes the single one an older app sends', () => {
    expect(cleanActivities(game())).toEqual([{ kind: 'game', name: 'Tarkov' }])
    expect(cleanActivities(null)).toEqual([])
  })
})
