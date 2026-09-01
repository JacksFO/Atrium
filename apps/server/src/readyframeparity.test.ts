import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, joinSpace, seedRolesFor, grantOwnerRole, joinContainer } from './db.js'

/**
 * Three reads in the frame the socket opens with.
 *
 * The roles of the servers somebody is in, who holds them, and the list of
 * those servers - each a join through space_members. The third is the one to
 * be careful with: container_members holds conversations as well as servers,
 * so asking it for "the servers I am in" without saying which kind you mean
 * hands back conversations too, and the loop that follows treats each answer
 * as a server.
 */
const anna = randomUUID(), bob = randomUUID()
const spaces: string[] = []

function user(id: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
}

const spacesByContainment = (who: string) =>
  (db.prepare(
    `SELECT m.container_id AS space_id FROM container_members m
       JOIN containers k ON k.id = m.container_id
      WHERE m.user_id = ? AND k.kind = 'space'`
  ).all(who) as Array<{ space_id: string }>).map((r) => r.space_id).sort()

const rolesByContainment = (who: string) =>
  (db.prepare(
    `SELECT r.id FROM roles r JOIN container_members m ON m.container_id = r.space_id WHERE m.user_id = ?`
  ).all(who) as Array<{ id: string }>).map((r) => r.id).sort()

beforeAll(() => {
  user(anna); user(bob)
  for (let i = 0; i < 2; i++) {
    const s = randomUUID()
    spaces.push(s)
    db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(s, 'S' + i, anna, Date.now())
    seedRolesFor(s); grantOwnerRole(s); joinSpace(anna, s)
  }
  /* And a conversation, which is a container and is not a server. */
  const talk = randomUUID()
  db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', 'dm', 0, ?)")
    .run(talk, Date.now())
  for (const who of [anna, bob]) {
    joinContainer(who, talk)
  }
})

describe('the servers somebody is in', () => {
  it('is the servers they joined, and only those', () => {
    /* The table this was measured against is gone; asking containment twice
       would agree with itself whatever the answer. So it is checked against
       what the fixture built. */
    expect(spacesByContainment(anna)).toEqual([...spaces].sort())
    expect(spacesByContainment(bob)).toEqual([])
  })

  it('and does not include a conversation', () => {
    /* The mistake this shape invites: anna is in two servers and one
       conversation, and the conversation is a container too. */
    expect(spacesByContainment(anna)).toHaveLength(2)
    expect(spacesByContainment(anna).sort()).toEqual([...spaces].sort())
  })
})

describe('the roles of those servers', () => {
  it("are the roles of those servers, and nobody else's", () => {
    const mine = rolesByContainment(anna)
    const ofMine = (db.prepare(
      `SELECT id FROM roles WHERE space_id IN (${spaces.map(() => '?').join(',')})`
    ).all(...spaces) as Array<{ id: string }>).map((r) => r.id).sort()
    expect(mine).toEqual(ofMine)
    expect(rolesByContainment(bob)).toEqual([])
  })

  it('and somebody in a server has some', () => {
    expect(rolesByContainment(anna).length).toBeGreaterThan(0)
  })
})

/**
 * And the query that actually ships says which kind it means.
 *
 * The two checks above compare SQL written here, so breaking the gateway
 * leaves them green - they say the shape is right, not that it is the shape in
 * use. This one reads the file.
 */
describe('the query in the gateway', () => {
  const gateway = readFileSync(resolve(process.cwd(), 'src/gateway.ts'), 'utf8')

  it('asks container_members for the servers somebody is in', () => {
    expect(gateway).not.toContain('SELECT space_id FROM space_members WHERE user_id = ?')
    expect(gateway).toContain('AS space_id FROM container_members')
  })

  it('and says it means servers, not conversations', () => {
    const at = gateway.indexOf('AS space_id FROM container_members')
    expect(gateway.slice(at, at + 220)).toContain("k.kind = 'space'")
  })
})
