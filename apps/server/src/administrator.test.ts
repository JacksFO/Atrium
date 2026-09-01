import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, joinSpace, seedRolesFor, grantOwnerRole, ownsSpace } from './db.js'
import { canEditRole, filterGrantable, permissionsFor, PERMISSIONS } from './permissions.js'

/**
 * Administrator is everything, and is not ownership.
 *
 * Asked for as "all the permissions the Owner would have, minus the ability
 * to delete the server or change the owner / owner role and colour".
 *
 * The interesting half is not that it grants things - that is one line. It is
 * that it must not become ownership by a side door, and the side door here is
 * manage_roles: anybody who can edit roles and holds every permission could
 * otherwise rewrite the Owner role, or grant themselves whatever it has. So
 * this asks about the escalation rather than about the grant.
 */

const space = randomUUID()
const owner = randomUUID()
const admin = randomUUID()
const adminRole = randomUUID()
const lesser = randomUUID()

beforeAll(() => {
  for (const id of [owner, admin]) {
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
  joinSpace(admin, space)

  /* One role, holding one thing. */
  db.prepare(
    `INSERT INTO roles (id, name, permissions, position, created_at, space_id, kind)
     VALUES (?, 'Administrator', ?, 50, ?, ?, 'custom')`
  ).run(adminRole, JSON.stringify(['administrator']), Date.now(), space)
  db.prepare('INSERT OR IGNORE INTO member_roles (user_id, role_id) VALUES (?, ?)')
    .run(admin, adminRole)

  /* And something below them to prove the rank guard is not simply refusing
     everything - a test where nothing is editable would pass for the wrong
     reason. */
  db.prepare(
    `INSERT INTO roles (id, name, permissions, position, created_at, space_id, kind)
     VALUES (?, 'Regulars', ?, 5, ?, ?, 'custom')`
  ).run(lesser, JSON.stringify(['view_channels']), Date.now(), space)
})

describe('an administrator', () => {
  it('holds one permission on the role', () => {
    const row = db.prepare('SELECT permissions FROM roles WHERE id = ?').get(adminRole) as
      { permissions: string }
    expect(JSON.parse(row.permissions)).toEqual(['administrator'])
  })

  it('and every permission there is, in practice', () => {
    const held = permissionsFor(admin, space)
    for (const p of PERMISSIONS) {
      expect(held.has(p), `an administrator should hold ${p}`).toBe(true)
    }
  })

  /* The point of expanding rather than ticking seventeen boxes: a permission
     added next month is held the day it exists. */
  it('including whatever is added to the list later', () => {
    expect(permissionsFor(admin, space).size).toBe(PERMISSIONS.length)
  })
})

describe('and is still not the owner', () => {
  it('does not own the server', () => {
    expect(ownsSpace(admin, space)).toBe(false)
    expect(ownsSpace(owner, space)).toBe(true)
  })

  /*
   * The Owner role is the anchor of the ordering and says what ownership is.
   * Editing it is guarded on being the owner rather than on holding
   * manage_roles - which is what stops "everything" from meaning "everything
   * including the definition of everything".
   */
  it('cannot rewrite the Owner role, its colour or its name', () => {
    const ownerRole = db.prepare(
      "SELECT id FROM roles WHERE space_id = ? AND kind = 'owner'"
    ).get(space) as { id: string }
    expect(canEditRole(admin, ownerRole.id)).toBe(false)
    expect(canEditRole(owner, ownerRole.id)).toBe(true)
  })

  /* And the guard is a rank check rather than a blanket refusal. */
  it('while still being able to edit the roles below it', () => {
    expect(canEditRole(admin, lesser)).toBe(true)
  })

  /*
   * Deleting the server is not a permission at all - the route compares
   * owner_id - so there is nothing here for an administrator to hold. Stated
   * as a fact about the list so that adding a `delete_space` permission one
   * day has to walk past this.
   */
  it('and there is no permission that deletes a server', () => {
    expect(PERMISSIONS).not.toContain('delete_space')
    expect(PERMISSIONS.filter((p) => /delete|owner|transfer/.test(p))).toEqual([])
  })
})

describe('what an administrator may hand on', () => {
  /*
   * Everything except the thing that makes another one of them.
   *
   * An administrator who can make administrators is one step from being the
   * owner: they cannot take the server, but they can hand the whole of it to
   * anybody - including back to themselves after being demoted - without the
   * person who made it ever agreeing to it.
   *
   * The rank guard does not cover this. It stops somebody assigning a role at
   * or above their own; it says nothing about writing the permission onto a
   * role well below them and then holding that.
   */
  it('is everything except administrator itself', () => {
    const given = filterGrantable(admin, [...PERMISSIONS], space)
    expect(given).not.toContain('administrator')
    expect(given.length).toBe(PERMISSIONS.length - 1)
  })

  it('while the owner may give it', () => {
    expect(filterGrantable(owner, ['administrator'], space)).toEqual(['administrator'])
  })

  /* And it cannot be smuggled in by writing it onto a lesser role. */
  it('and it cannot be written onto a role below them either', () => {
    expect(filterGrantable(admin, ['administrator', 'kick_members'], space))
      .toEqual(['kick_members'])
  })

  /* Somebody who holds nothing still hands on nothing: the grant rule is
     doing work, rather than being switched off for everybody. */
  it('while somebody holding nothing hands on nothing', () => {
    const nobody = randomUUID()
    expect(filterGrantable(nobody, ['manage_roles', 'administrator'], space)).toEqual([])
  })
})
