import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { db } from './db.js'

/**
 * A migration that turns foreign keys off must turn them back on.
 *
 * Two migrations rebuild a table, and SQLite will not drop a referenced table
 * with foreign keys enforced - so both switch the pragma off, and both have to
 * put it back whatever happens in between. It is a connection-wide setting: a
 * migration that throws on the way out leaves every query for the rest of the
 * process running without referential integrity, which is the kind of fault
 * that shows up months later as rows pointing at nothing.
 *
 * rebuildTable always did this properly. widenUsernames restored the pragmas
 * in its catch and again after the index it builds afterwards - and that index
 * is unique over (username, discriminator), so a database holding a duplicate
 * pair throws between the two, leaving both pragmas wrong. Unreachable on any
 * database that has already migrated, because it returns early once the index
 * exists. Unreachable is not a thing to leave load-bearing.
 */

const src = readFileSync(join(__dirname, 'db.ts'), 'utf8').split('\r\n').join('\n')

/** One function's body, bounded rather than run to the end of the file. */
function bodyOf(name: string): string {
  const from = src.indexOf(`function ${name}`)
  expect(from, `${name} exists`).toBeGreaterThan(-1)
  const to = src.indexOf('\n}', from)
  expect(to, `${name} is bounded`).toBeGreaterThan(from)
  return src.slice(from, to)
}

describe('every migration that disables foreign keys', () => {
  for (const name of ['rebuildTable', 'widenUsernames']) {
    describe(name, () => {
      const body = bodyOf(name)

      it('turns them off', () => {
        expect(body).toContain("PRAGMA foreign_keys = OFF")
      })

      /* A finally, not a line after the last statement that could throw. */
      it('and puts them back in a finally', () => {
        expect(body).toContain('} finally {')
        const after = body.slice(body.lastIndexOf('} finally {'))
        expect(after).toMatch(/foreign_keys = ON|restore\(\)/)
      })

      /* And the same for the rename behaviour, which is the other pragma
         these two change and is just as connection-wide. */
      it('and the legacy rename behaviour with them', () => {
        expect(body).toContain('legacy_alter_table = OFF')
      })
    })
  }
})

/**
 * And the boot that just happened left them on.
 *
 * The source checks above say the code is shaped right; this says the process
 * running these tests actually has enforcement enabled, having run every
 * migration in the file on a fresh database seconds ago.
 */
describe('after every migration has run', () => {
  it('foreign keys are enforced on this connection', () => {
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
    expect(row.foreign_keys).toBe(1)
  })

  it('and the legacy rename behaviour is off', () => {
    const row = db.prepare('PRAGMA legacy_alter_table').get() as { legacy_alter_table: number }
    expect(row.legacy_alter_table).toBe(0)
  })

  /* Nothing dangling, on the database these tests just built. */
  it('with nothing pointing at a row that is not there', () => {
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
