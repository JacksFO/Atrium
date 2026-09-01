import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, canSeeMember, visibleWith, joinSpace, seedRolesFor, grantOwnerRole, joinContainer } from './db.js'

/**
 * Who you can see at all.
 *
 * Three reasons: you share a server, you are friends, or you are in a
 * conversation together. Anybody else is a stranger who happens to have an
 * account on the same machine, and this is the predicate that says so - so a
 * mistake here is not a bug, it is a stranger appearing in somebody's member
 * list.
 *
 * Two of those three reasons are the same question about containers, and the
 * point of this file is to make sure that collapsing them changes nobody's
 * answer. The reference is written out in full below and stays the old shape.
 */
const spaceA = randomUUID(), spaceB = randomUUID()
const anna = randomUUID(), bob = randomUUID(), carol = randomUUID(), dave = randomUUID(), eve = randomUUID()

function user(id: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
}

beforeAll(() => {
  for (const id of [anna, bob, carol, dave, eve]) user(id)

  /* anna and bob share a server; carol is in the other one. */
  for (const [s, owner] of [[spaceA, anna], [spaceB, carol]] as const) {
    db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(s, 'S' + s.slice(0, 4), owner, Date.now())
    seedRolesFor(s); grantOwnerRole(s); joinSpace(owner, s)
  }
  joinSpace(bob, spaceA)

  /* dave shares nothing but a conversation with anna. */
  const talk = randomUUID()
  db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', 'dm', 0, ?)")
    .run(talk, Date.now())
  for (const who of [anna, dave]) {
    joinContainer(who, talk)
  }

  /* eve shares nothing at all with anybody - the stranger case. */
})

describe('who a person can see', () => {
  it('is themselves, the people in their servers, and the people they talk to', () => {
    /* This compared against the same predicate written over space_members and
       dm_members. Those are gone, and containment cannot check itself, so the
       expected answer is written out from how the fixture was built. */
    expect([...visibleWith(anna)].sort()).toEqual([anna, bob, dave].sort())
    expect([...visibleWith(bob)].sort()).toEqual([anna, bob].sort())
    expect([...visibleWith(carol)].sort()).toEqual([carol])
    expect([...visibleWith(dave)].sort()).toEqual([anna, dave].sort())
  })

  it('and the reasons are real, not everybody seeing everybody', () => {
    /* If this predicate ever answered "yes" to everything the test above
       would still pass, so the shape of the answer is checked too. */
    expect(canSeeMember(anna, bob)).toBe(true)    // same server
    expect(canSeeMember(anna, dave)).toBe(true)   // a conversation
    expect(canSeeMember(anna, eve)).toBe(false)   // nothing at all
    expect(canSeeMember(bob, carol)).toBe(false)  // different servers
  })

  it('and a stranger sees only themselves', () => {
    expect([...visibleWith(eve)]).toEqual([eve])
  })
})
