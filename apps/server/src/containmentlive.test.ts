import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { db, joinSpace, seedRolesFor, grantOwnerRole, joinContainer, leaveContainer, emptyContainer } from './db.js'

/**
 * Containment keeps up with things made after boot.
 *
 * The backfill fills in history. What matters for reading from these tables
 * is the other half: a server made a minute ago, a conversation started just
 * now, somebody who joined while the machine was up. If those do not appear,
 * switching any read onto containment makes new things invisible until a
 * restart - which is the failure that would look like the app losing a
 * server somebody had just created.
 *
 * Nothing here calls a backfill. Every row below is made the way the app
 * makes it, and the question is whether the database kept up on its own.
 */
function user(id: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
}

const contains = (container: string, who: string) =>
  Boolean(db.prepare('SELECT 1 FROM container_members WHERE container_id = ? AND user_id = ?')
    .get(container, who))

const containerOf = (id: string) =>
  db.prepare('SELECT kind FROM containers WHERE id = ?').get(id) as { kind: string } | undefined

describe('a server made while the machine is running', () => {
  it('gets a container, and its members appear in it', () => {
    const space = randomUUID(); const owner = randomUUID(); const guest = randomUUID()
    user(owner); user(guest)
    db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(space, 'Fresh', owner, Date.now())
    seedRolesFor(space); grantOwnerRole(space); joinSpace(owner, space)

    expect(containerOf(space)?.kind).toBe('space')
    expect(contains(space, owner)).toBe(true)

    joinSpace(guest, space)
    expect(contains(space, guest)).toBe(true)
  })

  it('and somebody leaving stops being in it', () => {
    const space = randomUUID(); const owner = randomUUID(); const guest = randomUUID()
    user(owner); user(guest)
    db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(space, 'Fresh', owner, Date.now())
    seedRolesFor(space); grantOwnerRole(space); joinSpace(owner, space); joinSpace(guest, space)
    expect(contains(space, guest)).toBe(true)

    leaveContainer(guest, space)
    expect(contains(space, guest)).toBe(false)
    /* And the person who stayed, stayed. */
    expect(contains(space, owner)).toBe(true)
  })

  it('and deleting the server takes the container with it', () => {
    const space = randomUUID(); const owner = randomUUID()
    user(owner)
    db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(space, 'Doomed', owner, Date.now())
    seedRolesFor(space); grantOwnerRole(space); joinSpace(owner, space)
    expect(containerOf(space)).toBeTruthy()

    emptyContainer(space)
    db.prepare('DELETE FROM roles WHERE space_id = ?').run(space)
    db.prepare('DELETE FROM spaces WHERE id = ?').run(space)
    expect(containerOf(space)).toBeUndefined()
    expect(contains(space, owner)).toBe(false)
  })
})

describe('a conversation started while the machine is running', () => {
  it('gets a container, and both people are in it', () => {
    const talk = randomUUID(); const a = randomUUID(); const b = randomUUID()
    user(a); user(b)
    db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', 'dm', 0, ?)")
      .run(talk, Date.now())
    for (const who of [a, b]) {
      joinContainer(who, talk)
    }
    expect(containerOf(talk)?.kind).toBe('dm')
    expect(contains(talk, a)).toBe(true)
    expect(contains(talk, b)).toBe(true)
  })

  it('and a group is a container of its own kind', () => {
    const talk = randomUUID(); const a = randomUUID()
    user(a)
    db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', 'group', 0, ?)")
      .run(talk, Date.now())
    joinContainer(a, talk)
    expect(containerOf(talk)?.kind).toBe('group')
    expect(contains(talk, a)).toBe(true)
  })

  it('while an ordinary channel is not a container at all', () => {
    /* A room in a server is contained; it does not contain. */
    const space = randomUUID(); const owner = randomUUID(); const room = randomUUID()
    user(owner)
    db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(space, 'Fresh', owner, Date.now())
    db.prepare(
      `INSERT INTO channels (id, space_id, name, kind, position, created_at)
       VALUES (?, ?, 'general', 'text', 0, ?)`
    ).run(room, space, Date.now())
    expect(containerOf(room)).toBeUndefined()
  })
})
