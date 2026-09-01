import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyCall, keyOf, tilesOf, watched, withStream, type Call } from './call'

/**
 * Watching several things at once, and stopping.
 *
 * Nothing streams until somebody asks for it: a room of eight where one
 * person shares is one stream or seven depending only on this, and it is the
 * sharer's upload either way. So the two halves both matter — a tile that
 * cannot be opted into is a share nobody can see, and one that cannot be
 * closed is bandwidth nobody can stop paying.
 */

const call = (over: Partial<Call> = {}): Call => ({
  ...emptyCall(),
  channel: 'c1',
  members: [
    { id: 'me', identity: 'me', name: 'Me', muted: false, sharing: true, cam: true },
    { id: 'pat', identity: 'pat', name: 'Pat', muted: false, sharing: true, cam: true },
    { id: 'sam', identity: 'sam', name: 'Sam', muted: false, sharing: true, cam: false },
  ],
  ...over,
})

describe('what has a tile', () => {
  /* Read off who is in the room, not off the streams that have arrived — a
     share nobody has asked for has no stream, which is the point of it. */
  it('is everything anybody is sending, asked for or not', () => {
    const keys = tilesOf(call(), 'me')
    expect(keys).toContain(keyOf('share', 'pat'))
    expect(keys).toContain(keyOf('share', 'sam'))
    expect(keys).toContain(keyOf('cam', 'pat'))
    /* Sam's camera is off, so there is nothing to draw a tile for. */
    expect(keys).not.toContain(keyOf('cam', 'sam'))
  })

  it('and your own, so you can see what you are sending', () => {
    const keys = tilesOf(call(), 'me')
    expect(keys).toContain(keyOf('share', 'me'))
    expect(keys).toContain(keyOf('cam', 'me'))
  })
})

describe('watching more than one at a time', () => {
  it('is two separate answers, not one choice', () => {
    const c = call({ watching: new Set([keyOf('share', 'pat'), keyOf('share', 'sam')]) })
    expect(watched(c, keyOf('share', 'pat'), 'me')).toBe(true)
    expect(watched(c, keyOf('share', 'sam'), 'me')).toBe(true)
    /* And one nobody asked for stays unasked. */
    expect(watched(c, keyOf('cam', 'pat'), 'me')).toBe(false)
  })

  it('and a screen and a camera from one person are separate too', () => {
    const c = call({ watching: new Set([keyOf('share', 'pat')]) })
    expect(watched(c, keyOf('share', 'pat'), 'me')).toBe(true)
    expect(watched(c, keyOf('cam', 'pat'), 'me')).toBe(false)
  })

  /* Stopping one leaves the other running. */
  it('and stopping one stops only that one', () => {
    const both = new Set([keyOf('share', 'pat'), keyOf('cam', 'pat')])
    both.delete(keyOf('share', 'pat'))
    const c = call({ watching: both })
    expect(watched(c, keyOf('share', 'pat'), 'me')).toBe(false)
    expect(watched(c, keyOf('cam', 'pat'), 'me')).toBe(true)
  })
})

describe('your own', () => {
  /* Always watched: it is already on your machine, so there is nothing to
     subscribe to and nothing to save by not. */
  it('needs no asking', () => {
    const c = call()
    expect(watched(c, keyOf('share', 'me'), 'me')).toBe(true)
    expect(watched(c, keyOf('cam', 'me'), 'me')).toBe(true)
  })
})

describe('a stream that arrives', () => {
  it('is filed under the thing it is, not under the person', () => {
    let c = call()
    const s = {} as MediaStream
    c = { ...c, video: withStream(c.video, keyOf('share', 'pat'), s) }
    c = { ...c, video: withStream(c.video, keyOf('cam', 'pat'), s) }
    /* Both, because a screen and a face are two things one person is
       sending — one map keyed by person would have kept only the second. */
    expect(c.video.size).toBe(2)
  })
})

/**
 * Who is watching, told to the room.
 *
 * Nothing streams until somebody asks for it, so until the server carried
 * this, only the media server knew who had asked — and a person sharing had
 * no way of knowing whether anybody was looking at all.
 */
describe('telling the room what you watch', () => {
  const gateway = readFileSync(
    resolve(process.cwd(), '../server/src/gateway.ts'), 'utf8',
  )
  const shell = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')

  it('is a frame the server has a case for', () => {
    expect(gateway).toMatch(/case 'watching': \{/)
    expect(gateway).toContain('state.watching = asked')
  })

  /*
   * Bounded, because it arrives from outside. A client claiming to watch ten
   * thousand things would be ten thousand strings held per connection and
   * sent on to everybody in the room.
   */
  it('and is bounded, because it comes from outside', () => {
    const at = gateway.indexOf("case 'watching': {")
    const body = gateway.slice(at, at + 600)
    expect(body).toMatch(/k\.length <= 80/)
    expect(body).toMatch(/\.slice\(0, 32\)/)
  })

  /* Whole rather than a change: two arriving out of order cannot leave the
     server believing somebody watches a thing they closed. */
  it('and carries the whole list rather than a change', () => {
    expect(shell).toMatch(/send\(watchingFrame\(/)
    const at = shell.indexOf('const watchKey =')
    expect(at).toBeGreaterThan(0)
    expect(shell.slice(at, at + 200)).toContain('sort()')
  })

  it('and the room passes it on to everybody who may see the call', () => {
    /* Through the same filter as the rest of the occupancy, so it cannot
       tell somebody about a call they are not allowed to know about. */
    const at = gateway.indexOf('function announceVoice')
    expect(gateway.slice(at, at + 700)).toContain('canSeeVoice')
  })
})
