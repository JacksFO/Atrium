import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, joinSpace, seedRolesFor, grantOwnerRole } from './db.js'
import { permissionsFor, rolesFor } from './permissions.js'

/**
 * A permission you have just been given.
 *
 * independence.mjs says granting somebody a role pushes them the role, and
 * then pushes a permission set that does not contain what the role unlocks.
 * This is the same thing asked of the functions underneath, to find out which
 * half is wrong: the union, or the push.
 */
const space = randomUUID()
const owner = randomUUID()
const member = randomUUID()
const role = randomUUID()

beforeAll(() => {
  for (const id of [owner, member]) {
    db.prepare(
      `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
       VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
    ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
  }
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(space, 'Somewhere', owner, Date.now())
  seedRolesFor(space)
  grantOwnerRole(space)
  joinSpace(owner, space)
  joinSpace(member, space)

  db.prepare(
    `INSERT INTO roles (id, name, permissions, position, created_at, space_id, kind)
     VALUES (?, 'Helpers', ?, 5, ?, ?, 'custom')`
  ).run(role, JSON.stringify(['view_channels', 'read_history', 'manage_nicknames']), Date.now(), space)
})

describe('being handed a role', () => {
  it('starts with the member not holding it', () => {
    expect(rolesFor(member, space).map((r) => r.id)).not.toContain(role)
    expect(permissionsFor(member, space).has('manage_nicknames')).toBe(false)
  })

  it('puts the role among the ones they hold', () => {
    db.prepare('INSERT OR IGNORE INTO member_roles (user_id, role_id) VALUES (?, ?)').run(member, role)
    expect(rolesFor(member, space).map((r) => r.id)).toContain(role)
  })

  it('and the permission it carries is in what they may do', () => {
    /* If this passes, the union is right and the fault is in what gets
       pushed. If it fails, the fault is further down than the push. */
    expect([...permissionsFor(member, space)]).toContain('manage_nicknames')
  })
})
