import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { db } from './db.js'

/**
 * A colour somebody chose for a voice room.
 *
 * They were already coloured, from a hash of the id, so every room had one
 * and nobody could pick it. Null still means exactly that - keep the one the
 * id gives - which is why the column has no default: "nobody has chosen" and
 * "somebody chose the colour that happens to be the default" want to behave
 * differently if the palette ever changes.
 *
 * The part worth testing is not that a string can be stored. It is that only
 * a colour can be, because this value is written into a style attribute on
 * everybody's screen.
 */

describe('the column', () => {
  it('exists, and starts empty', () => {
    const cols = db.prepare('PRAGMA table_info(channels)').all() as unknown as
      Array<{ name: string; dflt_value: unknown }>
    const mine = cols.find((c) => c.name === 'colour')
    expect(mine, 'channels.colour').toBeTruthy()
    expect(mine!.dflt_value, 'no default: null means "the one its id gives"').toBeNull()
  })

  it('holds a colour and gives it back', () => {
    const id = randomUUID()
    db.prepare(
      `INSERT INTO channels (id, name, kind, position, created_at, colour)
       VALUES (?, 'lounge', 'voice', 0, ?, '#FF6B6B')`
    ).run(id, Date.now())
    const got = db.prepare('SELECT colour FROM channels WHERE id = ?').get(id) as
      unknown as { colour: string | null }
    expect(got.colour).toBe('#FF6B6B')
    db.prepare('DELETE FROM channels WHERE id = ?').run(id)
  })
})

/**
 * And what the route will accept, read from its source.
 *
 * The check itself is three lines and the reason for it is the whole point,
 * so it is asserted rather than left to be noticed: anything that is not a
 * plain six-digit hex is refused, and an empty one is stored as null rather
 * than as an empty string, so "no colour" has one spelling in the database.
 */
describe('what may be stored', () => {
  const src = readFileSync(join(__dirname, 'routes', 'admin.ts'), 'utf8')
    .split('\r\n').join('\n')
  const at = src.indexOf("if ('colour' in body)")
  const to = src.indexOf('\n    }', at)
  const route = src.slice(at, to)

  it('is one bounded piece of the route', () => {
    expect(at, 'the colour branch is there').toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(at)
    expect(route.length).toBeLessThan(800)
  })

  it('refuses anything that is not a plain hex colour', () => {
    expect(route).toMatch(/\^#\[0-9a-f\]\{6\}\$/i)
    expect(route).toContain('reply.code(400)')
  })

  it('and stores nothing rather than an empty string', () => {
    expect(route).toContain('wanted || null')
  })

  /* Present-or-absent, not truthy-or-falsy: a missing field must not clear a
     colour somebody set while they were renaming the room. */
  it('and only touches it when it was actually asked about', () => {
    expect(route).toContain("'colour' in body")
  })
})
