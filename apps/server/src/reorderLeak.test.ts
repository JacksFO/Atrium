import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A reorder tells each person about their own channels and no others.
 *
 * pushChannelEvent decides who hears an event at all, which is the whole
 * answer when the event is about one channel: it asks canAccessChannel and
 * withholds it. A reorder is about all of them at once, so passing that gate
 * handed over the id and position of every channel in the server - private
 * ones included. No names and no contents, but "there is a room here you
 * cannot see, and it is third" is exactly what a private channel must not
 * say.
 *
 * The fix costs a serialisation per recipient instead of one for everybody,
 * which is a handful of channels for a handful of people.
 */

const src = readFileSync(join(__dirname, 'gateway.ts'), 'utf8').split('\r\n').join('\n')

const fn = (() => {
  const from = src.indexOf('export function pushChannelEvent')
  const to = src.indexOf('\n}', src.indexOf('for (const c of clients)', from))
  return { from, to, body: src.slice(from, to) }
})()

describe('an event about a list of channels', () => {
  it('is one function, bounded at both ends', () => {
    expect(fn.from).toBeGreaterThan(-1)
    expect(fn.to).toBeGreaterThan(fn.from)
    expect(fn.body.length).toBeLessThan(5000)
  })

  it('is cut down to the channels that person can reach', () => {
    expect(fn.body).toMatch(/listed\.filter\([\s\S]{0,160}canAccessChannel\(c\.user\.id, one\.id\)/)
  })

  /* Serialised per person, because the payload now differs per person. One
     shared string is what made this wrong. */
  it('and serialised for them rather than once for everybody', () => {
    expect(fn.body).toMatch(/JSON\.stringify\(\{ \.\.\.\(payload as object\), channels: theirs \}\)/)
  })

  /*
   * And nothing at all rather than an empty list: an event saying "the
   * channels you cannot see have moved" is the same disclosure in a quieter
   * voice.
   */
  it('and says nothing when none of them were theirs', () => {
    expect(fn.body).toContain('if (theirs.length === 0) continue')
  })

  /*
   * The single-channel path is untouched. Every other event through here
   * carries one channel and is already decided by the checks above - routing
   * those through the filter would be asking the same question twice.
   */
  it('while an event about one channel goes out as it always did', () => {
    expect(fn.body).toContain('if (!listed || !anySecret) { c.socket.send(data); continue }')
    expect(fn.body).toContain('if (channel?.id && !canAccessChannel(c.user.id, channel.id)) continue')
  })

  /*
   * And a server with nothing private in it pays nothing.
   *
   * Asking canAccessChannel for every listed channel for every client is
   * right and does not scale: 73us a check, measured here, is 13ms at
   * fourteen channels and thirteen people and seven seconds at five hundred
   * and two hundred - with SQLite synchronous, that is the whole server
   * stopped. A public channel is visible to anybody past the checks above, so
   * only the private ones were ever worth asking about, and usually there
   * are none.
   */
  it('and only asks about the channels that could leak', () => {
    expect(fn.body).toContain('is_private = 1')
    expect(fn.body).toMatch(/!secret\.has\(one\.id\) \|\| canAccessChannel/)
  })

  it('and takes the shared payload when nothing in the server is private', () => {
    expect(fn.body).toContain('const anySecret = secret.size > 0')
  })
})

/**
 * And the event that made this matter still names its server.
 *
 * Without spaceId there is no single channel to read the server off, and the
 * whole fan-out falls back to the wrong one - which is a bug this file has
 * had before, in the other direction.
 */
describe('the reorder that sends one', () => {
  const admin = readFileSync(join(__dirname, 'routes', 'admin.ts'), 'utf8')
    .split('\r\n').join('\n')

  it('names the server and lists that server’s channels', () => {
    const at = admin.indexOf("t: 'channels-reordered'")
    expect(at).toBeGreaterThan(-1)
    const push = admin.slice(at, at + 500)
    expect(push).toContain('spaceId: firstOf')
    expect(push).toContain('WHERE space_id IS ?')
  })
})
