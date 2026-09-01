import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { db } from './db.js'

/**
 * How much one server may hold.
 *
 * Making a server has been capped at twenty an account since it was written,
 * with a comment saying why: every one is rows on somebody's home machine.
 * The things inside a server had no such limit, which is the worse half —
 * channels and headings go out in the opening frame to every member, so
 * filling a server with them is not a cost the person who made them pays. It
 * is a cost every member pays on every sign-in.
 *
 * All four need a permission, so this is an insider limit rather than a lock.
 * That is the point: a permission somebody was given for one reason should
 * not also be the ability to make the server unusable for everybody.
 */

const admin = readFileSync(resolve(process.cwd(), 'src/routes/admin.ts'), 'utf8')

/** The body of one route, from its registration to the next one. */
function route(path: string, verb = 'post'): string {
  const at = admin.indexOf(`app.${verb}('${path}'`)
  if (at < 0) return ''
  const next = admin.indexOf('\n  app.', at + 10)
  return admin.slice(at, next < 0 ? admin.length : next)
}

describe('what a server may hold', () => {
  it('has a table of the limits', () => {
    /* Or every assertion below is checking a call to something absent. */
    expect(admin).toContain('const MOST =')
    expect(admin).toContain('function roomFor(')
  })

  for (const [path, table] of [
    ['/api/channels', 'channels'],
    ['/api/roles', 'roles'],
    ['/api/categories', 'categories'],
    ['/api/invites', 'invites'],
  ] as const) {
    it(`caps ${table}`, () => {
      const body = route(path)
      expect(body.length).toBeGreaterThan(100)
      expect(body).toContain(`roomFor('${table}'`)
      /* Refused rather than silently ignored, and with the same code the
         server cap already uses. */
      expect(body).toContain('429')
    })

    /* The check has to happen before the row is written, or it is a comment. */
    it(`and does so before writing the ${table} row`, () => {
      const body = route(path)
      const checked = body.indexOf(`roomFor('${table}'`)
      const written = body.indexOf('INSERT INTO')
      expect(checked).toBeGreaterThan(0)
      if (written > 0) expect(checked).toBeLessThan(written)
    })
  }

  /*
   * Nothing sweeps spent or expired invites — they go by hand, or when the
   * whole server does. Counting every row ever written would let dead invites
   * fill the allowance and leave a server unable to make another, with no way
   * to see why. A cap that cannot be relieved is worse than no cap.
   */
  it('but counts only the invites that could still be used', () => {
    const helper = admin.slice(admin.indexOf('function roomFor('),
      admin.indexOf('}', admin.indexOf('return row.c < MOST')))
    expect(helper).toContain('uses_left > 0')
    expect(helper).toContain('expires_at IS NULL OR expires_at >')
  })

  /* And that condition is real SQL against the real shape of the table, not
     a string that happens to look like one. */
  it('and that count is a query this database will actually run', () => {
    const spent = db.prepare(
      `SELECT COUNT(*) c FROM invites WHERE space_id = ?
         AND uses_left > 0 AND (expires_at IS NULL OR expires_at > unixepoch() * 1000)`,
    ).get('no-such-space') as { c: number }
    expect(spent.c).toBe(0)
  })
})
