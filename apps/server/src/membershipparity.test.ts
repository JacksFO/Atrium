import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, dmMembers, isSpaceMember, membersOfSpace, joinSpace, seedRolesFor, grantOwnerRole, joinContainer } from './db.js'

/**
 * The three membership questions, asked both ways.
 *
 * "Is this person in this server", "who is in this server", and "who is in
 * this conversation" are one question about containers and three about
 * separate tables. Before any of them starts reading containment, all three
 * have to give the same answers they give now - for every person and every
 * place in the app, not for cases somebody chose.
 *
 * The reference queries are written out here rather than imported, so they
 * stay the old shape after the functions stop being it. Comparing a function
 * to itself passes always.
 */
const spaceA = randomUUID(), spaceB = randomUUID()
const anna = randomUUID(), bob = randomUUID(), carol = randomUUID()
let talk = ''

function user(id: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
}

beforeAll(() => {
  for (const id of [anna, bob, carol]) user(id)
  for (const [s, owner] of [[spaceA, anna], [spaceB, bob]] as const) {
    db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(s, 'S' + s.slice(0, 4), owner, Date.now())
    seedRolesFor(s); grantOwnerRole(s); joinSpace(owner, s)
  }
  joinSpace(carol, spaceA)

  talk = randomUUID()
  db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', 'dm', 0, ?)")
    .run(talk, Date.now())
  for (const who of [anna, bob]) {
    joinContainer(who, talk)
  }
})

describe('is this person in this server', () => {
  it('is yes for exactly the people who joined it', () => {
    /* Written out rather than compared against another query: the table this
       used to be measured against is gone, and asking containment twice would
       pass whatever the answer was. */
    const expected: Array<[string, string, boolean]> = [
      [anna, spaceA, true], [anna, spaceB, false],
      [bob, spaceB, true], [bob, spaceA, false],
      [carol, spaceA, true], [carol, spaceB, false],
    ]
    for (const [who, where, yes] of expected) {
      expect(isSpaceMember(who, where), `${who} in ${where}`).toBe(yes)
    }
  })

  it('and says yes and no somewhere, so it is not answering one way', () => {
    expect(isSpaceMember(carol, spaceA)).toBe(true)
    expect(isSpaceMember(carol, spaceB)).toBe(false)
  })
})

describe('who is in this server', () => {
  it('is the people who joined it, and nobody else', () => {
    const roster = (s: string) => (membersOfSpace(s) as Array<{ id: string }>).map((u) => u.id).sort()
    expect(roster(spaceA)).toEqual([anna, carol].sort())
    expect(roster(spaceB)).toEqual([bob])
  })
})

describe('who is in this conversation', () => {
  it('is the two people in it', () => {
    expect([...dmMembers(talk)].sort()).toEqual([anna, bob].sort())
  })
})
