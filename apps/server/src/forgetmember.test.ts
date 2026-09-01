import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { db, forgetMemberIn, makeContainer } from './db.js'

/**
 * Letting somebody back in does not restore what removing them took away.
 *
 * The kick route already argued this, above the line that clears somebody's
 * personal grants: "the grants sit waiting, and letting them back in
 * silently restores what whoever kicked them had just taken away". It made
 * that argument about two tables and there are four. A private channel's
 * list can name a person directly, and a channel or a category can allow a
 * permission to one person - neither was touched.
 *
 * So somebody specifically added to a private channel, then removed and
 * later readmitted, walked straight back into it. Dormant while they were
 * out - canAccessChannel asks whether they are in the server before it looks
 * at any of this - which is what makes it a thing nobody would notice until
 * it mattered.
 */

function user(): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
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

function channel(spaceId: string): string {
  const id = randomUUID()
  db.prepare(
    "INSERT INTO channels (id, name, topic, kind, position, created_at, space_id) VALUES (?, 'c', '', 'text', 0, ?, ?)"
  ).run(id, Date.now(), spaceId)
  return id
}

function category(spaceId: string): string {
  const id = randomUUID()
  db.prepare('INSERT INTO categories (id, space_id, name, position, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(id, spaceId, 'Heading', Date.now())
  return id
}

function role(spaceId: string): string {
  const id = randomUUID()
  db.prepare(
    "INSERT INTO roles (id, space_id, name, colour, position, permissions, kind, created_at) VALUES (?, ?, 'R', '', 1, '[]', 'custom', ?)"
  ).run(id, spaceId, Date.now())
  return id
}

/** Everything the four tables hold about one person in one server. */
function held(spaceId: string, userId: string) {
  const n = (sql: string, ...args: unknown[]) =>
    (db.prepare(sql).get(...args as never[]) as { c: number }).c
  return {
    roles: n(
      'SELECT COUNT(*) c FROM member_roles WHERE user_id = ? AND role_id IN (SELECT id FROM roles WHERE space_id = ?)',
      userId, spaceId),
    grants: n('SELECT COUNT(*) c FROM member_permissions WHERE space_id = ? AND user_id = ?',
      spaceId, userId),
    named: n(
      `SELECT COUNT(*) c FROM channel_access WHERE kind = 'member' AND subject_id = ?
         AND channel_id IN (SELECT id FROM channels WHERE space_id = ?)`,
      userId, spaceId),
    overrides: n(
      `SELECT COUNT(*) c FROM permission_overrides WHERE kind = 'member' AND subject_id = ?
         AND ((scope = 'channel' AND target_id IN (SELECT id FROM channels WHERE space_id = ?))
           OR (scope = 'category' AND target_id IN (SELECT id FROM categories WHERE space_id = ?)))`,
      userId, spaceId, spaceId),
  }
}

function giveEverything(spaceId: string, userId: string) {
  db.prepare('INSERT INTO member_roles (user_id, role_id) VALUES (?, ?)').run(userId, role(spaceId))
  db.prepare(
    'INSERT INTO member_permissions (space_id, user_id, permission, created_at) VALUES (?, ?, ?, ?)'
  ).run(spaceId, userId, 'manage_messages', Date.now())
  db.prepare("INSERT INTO channel_access (channel_id, kind, subject_id) VALUES (?, 'member', ?)")
    .run(channel(spaceId), userId)
  db.prepare(
    "INSERT INTO permission_overrides (scope, target_id, kind, subject_id, permission, allow) VALUES ('channel', ?, 'member', ?, 'send_messages', 1)"
  ).run(channel(spaceId), userId)
  db.prepare(
    "INSERT INTO permission_overrides (scope, target_id, kind, subject_id, permission, allow) VALUES ('category', ?, 'member', ?, 'view_channels', 1)"
  ).run(category(spaceId), userId)
}

describe('when a membership ends', () => {
  it('nothing it carried is left waiting', () => {
    const boss = user(), them = user()
    const sp = space(boss)
    giveEverything(sp, them)

    /* The precondition, asserted rather than assumed - all four have to be
       there, or clearing them proves nothing. */
    const before = held(sp, them)
    expect(before.roles).toBe(1)
    expect(before.grants).toBe(1)
    expect(before.named).toBe(1)
    expect(before.overrides).toBe(2)

    forgetMemberIn(sp, them)

    expect(held(sp, them)).toEqual({ roles: 0, grants: 0, named: 0, overrides: 0 })
  })

  /*
   * And only in that server.
   *
   * The subject is an account, and the same account may hold roles, grants
   * and a name on a private channel's list in servers that have nothing to
   * do with this one. Clearing by subject alone would empty all of them,
   * which is the mistake removal made once before when it set removed_at on
   * the account.
   */
  it('and nothing at all in anybody else’s server', () => {
    const boss = user(), them = user()
    const here = space(boss), elsewhere = space(boss)
    giveEverything(here, them)
    giveEverything(elsewhere, them)

    forgetMemberIn(here, them)

    expect(held(here, them)).toEqual({ roles: 0, grants: 0, named: 0, overrides: 0 })
    expect(held(elsewhere, them)).toEqual({ roles: 1, grants: 1, named: 1, overrides: 2 })
  })

  /* And somebody else in the same server keeps theirs. */
  it('and nobody else’s in this one', () => {
    const boss = user(), them = user(), other = user()
    const sp = space(boss)
    giveEverything(sp, them)
    giveEverything(sp, other)

    forgetMemberIn(sp, them)

    expect(held(sp, them)).toEqual({ roles: 0, grants: 0, named: 0, overrides: 0 })
    expect(held(sp, other)).toEqual({ roles: 1, grants: 1, named: 1, overrides: 2 })
  })
})

/**
 * And every way of leaving goes through it.
 *
 * Two routes cleared this by hand and each knew about a different subset,
 * which is how walking out came to clear less than being shown out. One
 * function, called from both, so the next thing that has to be cleared is
 * cleared for every way of going at once.
 */
const read = (...p: string[]) =>
  readFileSync(join(__dirname, ...p), 'utf8').split('\r\n').join('\n')
const codeOnly = (t: string) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

describe('the routes that end one', () => {
  const admin = codeOnly(read('routes', 'admin.ts'))
  const spaces = codeOnly(read('routes', 'spaces.ts'))

  it('being removed or banned calls it', () => {
    expect(admin).toContain('forgetMemberIn(target_space, id)')
  })

  it('and so does walking out', () => {
    expect(spaces).toContain('forgetMemberIn(id, user.id)')
  })

  /*
   * And neither keeps its own copy of the sweep.
   *
   * The whole-membership shapes only. Taking one role off somebody, or one
   * permission, is a different act that lives in its own route and is
   * supposed to be there - a blunter check forbids those too, which is what
   * this one did on its first run and is exactly the kind of assertion that
   * gets weakened rather than understood.
   */
  it('and neither keeps its own copy of the sweep', () => {
    const sweeps = [
      'DELETE FROM member_roles WHERE user_id = ? AND role_id IN (SELECT id FROM roles WHERE space_id = ?)',
      "DELETE FROM member_permissions WHERE space_id = ? AND user_id = ?')",
    ]
    for (const [name, src] of [['admin', admin], ['spaces', spaces]] as const) {
      for (const sweep of sweeps) {
        expect(src, `${name} still sweeps by hand`).not.toContain(sweep)
      }
    }
  })
})
