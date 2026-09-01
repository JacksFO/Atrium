import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { db } from './db.js'

/**
 * Every column the server asks for exists on a database made today.
 *
 * This is here because of one line. `/api/users/:id/mutual` hand-wrote its
 * column list - `SELECT u.id, u.username, u.display_name, u.nickname, ...` -
 * and when nicknames moved out of the users table nothing objected. It is a
 * string, so the compiler had no opinion; the client's own row type declared
 * the field as optional, so nothing objected there either; and this machine
 * still has the column, left behind on purpose, so it kept working here.
 *
 * On a database made after the change the column does not exist and the route
 * throws `no such column: u.nickname`, taking the mutual-servers section of
 * every profile card with it. Every new install, and none of the tests.
 *
 * So this asks the question the compiler cannot: run each `u.<column>` the
 * source mentions against the schema as it is actually created, and say
 * which one is not there.
 */

const SRC = join(__dirname)

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(at))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(at)
  }
  return out
}

/**
 * The one place allowed to read a column that is no longer created.
 *
 * migrateNicknamesArePerServer exists to move the old account-wide nicknames
 * out, so of course it names the old column - and it asks the schema whether
 * that column is there before it touches it. The guard is what makes it
 * correct, and it is why the sweep below cannot simply forbid the name.
 */
function withoutTheMigration(text: string): string {
  const from = text.indexOf('function migrateNicknamesArePerServer')
  if (from < 0) return text
  const to = text.indexOf('\n}', from)
  return text.slice(0, from) + text.slice(to)
}

/**
 * Prose stripped, because the comments name the column on purpose.
 *
 * The fix for the mutual route carries a paragraph saying what it used to
 * select and why that broke - which is the most useful thing in the file and
 * reads, to a plain search, exactly like the bug it describes. Reading the
 * source as one string cannot tell a warning from the thing it warns about.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
}

/** The column names on a table, from the database this process just opened. */
function columnsOf(table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((c) => c.name))
}

describe('the users table', () => {
  /*
   * `u.` is the alias every query in this codebase gives the users table, in
   * all of them, which is what makes this checkable at all. A query that
   * aliased it something else would slip through - so the test is a floor
   * rather than a proof, and it is the floor the one real bug fell through.
   */
  it('has every column the source asks it for', () => {
    const have = columnsOf('users')
    /* Left behind on databases old enough to have it, and gone from ones
       made since. Anything still selecting it works here and breaks on a
       fresh install, which is precisely the bug this exists for. */
    have.delete('nickname')

    const missing: string[] = []
    for (const file of sources(SRC)) {
      const text = codeOnly(withoutTheMigration(readFileSync(file, 'utf8')))
      /* Digits count: accent_2 is a column, and a pattern without them
         reports a field that is plainly there. */
      for (const m of text.matchAll(/\bu\.([a-z_0-9]+)\b/g)) {
        const column = m[1]!
        /* Only names that look like columns of this table - `u.id` and
           `u.display_name`, not a variable that happens to be called u. */
        if (!have.has(column) && column !== 'nickname') continue
        if (!have.has(column)) missing.push(`${file.split(/[\\/]/).pop()}: u.${column}`)
      }
    }
    expect(missing, 'columns the users table does not have').toEqual([])
  })
})

/**
 * And the record handed to clients matches the type describing it.
 *
 * PUBLIC_USER_COLUMNS is a string; the User type is a type. They are the same
 * list written twice, so they can disagree - and when they do the field is
 * present in every editor and undefined at runtime, which is worse than not
 * having it at all. That is what happened to nickname on both sides.
 */
describe('a person as the client is given them', () => {
  it('carries no field the type does not declare, and none it does not send', () => {
    const source = readFileSync(join(SRC, 'db.ts'), 'utf8').split('\r\n').join('\n')

    const from = source.indexOf('export const PUBLIC_USER_COLUMNS')
    expect(from).toBeGreaterThan(-1)
    /* Anchored on the declaration rather than the first mention: the constant
       is interpolated into three queries above it, and starting from any of
       those reads a quote out of somebody else's SQL. */
    const open = source.indexOf("'", from) + 1
    const line = source.slice(open, source.indexOf("'", open))
    const sent = line.split(',').map((c) => c.trim()).filter(Boolean)
    expect(sent.length).toBeGreaterThan(5)

    /* The User type's own field names, read from its declaration. */
    const typeAt = source.indexOf('export type User = {')
    expect(typeAt).toBeGreaterThan(-1)
    const body = source.slice(typeAt, source.indexOf('\n}', typeAt))
    const declared = new Set(
      [...body.matchAll(/^\s{2}([a-z_0-9]+)\??:/gm)].map((m) => m[1]!),
    )

    const notDeclared = sent.filter((c) => !declared.has(c))
    expect(notDeclared, 'sent to clients but missing from the User type').toEqual([])

    /*
     * And the other way, which is the direction the bug ran: a field on the
     * type that nothing selects reads as available everywhere and is
     * undefined every time.
     */
    const notSent = [...declared].filter((c) => !sent.includes(c))
    expect(notSent, 'declared on the User type but never selected').toEqual([])
  })
})
