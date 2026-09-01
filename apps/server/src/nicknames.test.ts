import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  db, joinSpace, makeContainer, membersOfSpace, nicknameIn, nicknamesIn, setNicknameIn,
  PUBLIC_USER_COLUMNS,
} from './db.js'

/**
 * What one server calls somebody stops at that server.
 *
 * It was a column on the account, so it was one name everywhere: being
 * renamed by a moderator in their server renamed you in every other server
 * you were in, and in your conversations with people who had never heard of
 * theirs. The route that set it already took a spaceId - it had to, because
 * who may rename somebody is a question about a server - and then wrote a
 * value that belonged to no server at all. The comment above it said so and
 * left it there.
 *
 * So the tests are about the boundary. A nickname that does not stop at one
 * server is the bug, and it is silent: everything looks right in the server
 * that set it.
 */

function user(): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', ?, 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'Real Name', 'x', Date.now())
  return id
}

function space(owner: string): string {
  const id = randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(id, 'S', owner, now)
  makeContainer(id, 'space', now)
  return id
}

describe('a nickname belongs to one server', () => {
  /*
   * The whole point, and the test that fails against the old column: setting
   * it in one place set it in all of them, because there was only one place
   * for it to be.
   */
  it('so being renamed in one does not rename you in another', () => {
    const boss = user(), them = user()
    const here = space(boss), elsewhere = space(boss)
    joinSpace(them, here)
    joinSpace(them, elsewhere)

    setNicknameIn(here, them, 'Patricia')

    expect(nicknameIn(here, them)).toBe('Patricia')
    expect(nicknameIn(elsewhere, them)).toBe('')
  })

  it('and two servers can call the same person two things', () => {
    const boss = user(), them = user()
    const a = space(boss), b = space(boss)
    setNicknameIn(a, them, 'Pat')
    setNicknameIn(b, them, 'Trish')

    expect(nicknameIn(a, them)).toBe('Pat')
    expect(nicknameIn(b, them)).toBe('Trish')
  })

  /* And it goes with the server, like every other fact about one. */
  it('and it goes when the server does', () => {
    const boss = user(), them = user()
    const sp = space(boss)
    setNicknameIn(sp, them, 'Pat')

    db.prepare('DELETE FROM spaces WHERE id = ?').run(sp)
    expect(nicknameIn(sp, them)).toBe('')
  })
})

describe('clearing one', () => {
  /*
   * Blank is a deletion rather than a stored empty string. "No nickname" and
   * "a nickname that happens to be blank" read identically to everybody and
   * would be two different things to every query that touches them.
   */
  it('removes the row rather than storing nothing', () => {
    const boss = user(), them = user()
    const sp = space(boss)
    setNicknameIn(sp, them, 'Pat')
    setNicknameIn(sp, them, '   ')

    expect(nicknameIn(sp, them)).toBe('')
    const rows = db.prepare('SELECT COUNT(*) c FROM member_nicknames WHERE space_id = ?')
      .get(sp) as { c: number }
    expect(rows.c).toBe(0)
  })

  it('and the list leaves out anybody without one', () => {
    const boss = user(), them = user(), other = user()
    const sp = space(boss)
    setNicknameIn(sp, them, 'Pat')

    const named = nicknamesIn(sp)
    expect(named[them]).toBe('Pat')
    expect(named[other]).toBeUndefined()
  })

  /* Bounded on the way in: it is drawn in a member list on every render. */
  it('and a nickname cannot be arbitrarily long', () => {
    const boss = user(), them = user()
    const sp = space(boss)
    expect(setNicknameIn(sp, them, 'x'.repeat(500))).toHaveLength(32)
  })
})

describe('what a person record carries', () => {
  /*
   * Not a nickname, and that is the point.
   *
   * A record is shared - the same person is in the directory once and drawn
   * in every server they are in - so a name on the row is a name in all of
   * them. Putting it back would reintroduce the bug quietly, through a
   * per-space copy of the row overwriting the directory's.
   */
  it('does not carry one', () => {
    expect(PUBLIC_USER_COLUMNS).not.toContain('nickname')
  })

  it('so a member list answers with records and names separately', () => {
    const boss = user(), them = user()
    const sp = space(boss)
    joinSpace(them, sp)
    setNicknameIn(sp, them, 'Pat')

    const rows = membersOfSpace(sp) as Array<Record<string, unknown>>
    const row = rows.find((r) => r.id === them)
    expect(row).toBeTruthy()
    expect(row).not.toHaveProperty('nickname')
    expect(nicknamesIn(sp)[them]).toBe('Pat')
  })

  /*
   * And the list is ordered by what this server calls them.
   *
   * The two cross-server directories order by display_name, because a
   * nickname does not apply across servers - but a server's own list is the
   * one place it does, and a list sorted by a name nobody can see is a list
   * in no order at all.
   */
  it('and orders that list by the name it shows', () => {
    const boss = user()
    const sp = space(boss)
    const zed = user(), amy = user()
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('Zed', zed)
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('Amy', amy)
    joinSpace(zed, sp)
    joinSpace(amy, sp)
    /* Zed is called Aaron here, so Zed comes first. */
    setNicknameIn(sp, zed, 'Aaron')

    const order = (membersOfSpace(sp) as Array<{ id: string }>)
      .map((r) => r.id)
      .filter((id) => id === zed || id === amy)
    expect(order).toEqual([zed, amy])
  })
})

/**
 * And the route, which cannot be reached without standing a server up.
 *
 * What matters here is the one line that was wrong for the whole life of the
 * feature: it wrote the account, having been handed the server.
 */
const admin = readFileSync(join(__dirname, 'routes', 'admin.ts'), 'utf8')
  .split('\r\n').join('\n')

const route = (() => {
  const from = admin.indexOf("app.post('/api/admin/members/:id/nickname'")
  expect(from).toBeGreaterThan(-1)
  const to = admin.indexOf('\n  app.', from + 10)
  expect(to).toBeGreaterThan(from)
  return admin.slice(from, to)
})()

describe('setting one', () => {
  it('writes into the server it was given', () => {
    expect(route).toContain('setNicknameIn(forSpace, id, nickname)')
  })

  /*
   * The line this replaced, which must not come back.
   *
   * Comments stripped first: the comment above the write names the old
   * statement on purpose, so that nobody restores it by reflex - and reading
   * the file as one string cannot tell the warning from the thing it warns
   * about. Removing the prose is what makes this about the code.
   */
  it('and never into the account', () => {
    const code = route
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    expect(code).not.toMatch(/UPDATE users SET nickname/)
    /* And the warning itself is still there to be read. */
    expect(route).toContain('UPDATE users SET nickname')
  })

  /*
   * Told to that server's members, and carrying the server.
   *
   * A member-update with the whole user row cannot express this any more -
   * the name is not on the row - and it went to everybody who could see the
   * person, which now includes people for whom this is not news.
   */
  it('and announces it to that server, saying which', () => {
    expect(route).toContain("t: 'nickname-changed'")
    expect(route).toContain('spaceId: forSpace')
    expect(route).toContain('membersOfContainer(forSpace)')
  })

  /* Rank still applies: nobody renames somebody above them. */
  it('and still refuses somebody who outranks you', () => {
    expect(route).toContain('outranks(user.id, target.id, forSpace)')
  })
})
