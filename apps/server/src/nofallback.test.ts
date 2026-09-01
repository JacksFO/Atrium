import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, everyoneRoleId, isSpaceMember, ownsSpace, joinSpace, seedRolesFor, grantOwnerRole } from './db.js'
import { directPermissions, permissionsFor, rolesFor } from './permissions.js'

/**
 * No server means no server.
 *
 * Six functions took a space and, given none, quietly answered about
 * whichever server happened to be created first. That is a leftover from when
 * there was exactly one, and it is the worse kind of wrong answer: it looks
 * like an answer.
 *
 * Nothing was broken by it today, because the paths that have no server - a
 * conversation - are handled before they get here. It is a loaded gun for the
 * next thing that has no server, which is the whole point of asking now
 * rather than after building communities on top of it.
 */
const space = randomUUID()
const owner = randomUUID()
const outsider = randomUUID()

beforeAll(() => {
  for (const id of [owner, outsider]) {
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
})

describe('asked about no server at all', () => {
  it('nobody is a member of it', () => {
    expect(isSpaceMember(owner, null)).toBe(false)
  })

  it('nobody owns it', () => {
    expect(ownsSpace(owner, null)).toBe(false)
  })

  it('it has no @everyone role', () => {
    expect(everyoneRoleId(null)).toBeNull()
  })

  it('nobody holds a role in it', () => {
    expect(rolesFor(owner, null)).toEqual([])
  })

  it('and nobody has been given anything in it by name', () => {
    expect(directPermissions(owner, null)).toEqual([])
  })
})

describe('while a named server still answers properly', () => {
  /* So none of the above is passing because the whole thing is broken. */
  it('knows its members and its owner', () => {
    expect(isSpaceMember(owner, space)).toBe(true)
    expect(ownsSpace(owner, space)).toBe(true)
    expect(isSpaceMember(outsider, space)).toBe(false)
  })

  it('has an @everyone role', () => {
    expect(everyoneRoleId(space)).toBeTruthy()
  })

  it('and grants its members what that role carries', () => {
    expect(permissionsFor(owner, space).size).toBeGreaterThan(0)
  })
})
