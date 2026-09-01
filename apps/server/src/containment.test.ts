import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, channelsForClient, joinSpace, seedRolesFor, grantOwnerRole, joinContainer } from './db.js'

/**
 * The channels somebody gets, and whether they are the right ones.
 *
 * This used to compare the answer against the same question asked of
 * space_members and dm_members - the shape it replaced - which was the right
 * check while both existed. They are gone, and comparing containment to a
 * containment query would be comparing a thing to itself: it passes always
 * and means nothing.
 *
 * So the fixture writes down what each person should be able to see as it
 * builds them, and the answers are checked against that. It is a stronger
 * check than the parity one was, because parity only ever said "the same as
 * before" - it would have agreed happily if both had been wrong.
 *
 * "What channels does this person get" is the question worth asking here: it
 * is the one the sign-in frame asks, and the one that used to be answered by
 * reading every channel in the app.
 */
const alpha = randomUUID()
const beta = randomUUID()
const anna = randomUUID()
const bob = randomUUID()
const carol = randomUUID()

/** What each person should see, written down as the fixture is built. */
const shouldSee = new Map<string, Set<string>>()
const willSee = (who: string, channelId: string) => {
  const mine = shouldSee.get(who) ?? new Set<string>()
  mine.add(channelId)
  shouldSee.set(who, mine)
}

function user(id: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
  shouldSee.set(id, new Set())
}

function space(id: string, owner: string, channels: number) {
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(id, 'S' + id.slice(0, 4), owner, Date.now())
  seedRolesFor(id); grantOwnerRole(id); joinSpace(owner, id)
  for (let i = 0; i < channels; i++) {
    const c = randomUUID()
    db.prepare(
      `INSERT INTO channels (id, space_id, name, kind, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(c, id, 'c' + i, i % 2 ? 'voice' : 'text', i, Date.now())
    willSee(owner, c)
  }
}

/** Somebody else joins a server, and so gets everything in it. */
function alsoJoins(who: string, spaceId: string) {
  joinSpace(who, spaceId)
  for (const r of db.prepare('SELECT id FROM channels WHERE space_id = ?').all(spaceId) as
    Array<{ id: string }>) willSee(who, r.id)
}

function dm(a: string, b: string, kind: 'dm' | 'group' = 'dm') {
  const id = randomUUID()
  db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', ?, 0, ?)")
    .run(id, kind, Date.now())
  for (const who of [a, b]) {
    joinContainer(who, id)
    willSee(who, id)
  }
  return id
}

beforeAll(() => {
  for (const id of [anna, bob, carol]) user(id)
  space(alpha, anna, 4)
  space(beta, bob, 3)
  alsoJoins(carol, alpha)
  dm(anna, bob)
  dm(bob, carol)
  dm(anna, carol, 'group')
})

const sorted = (xs: Iterable<string>) => [...xs].sort()
const gets = (who: string) =>
  sorted(channelsForClient(who).map((c) => String((c as { id: unknown }).id)))

describe('the channels somebody gets', () => {
  for (const [name, who] of [['somebody who joined a server', () => carol],
                             ['somebody in a server they own', () => anna],
                             ['somebody in two servers', () => bob]] as const) {
    it(`are exactly the right ones for ${name}`, () => {
      const id = who()
      expect(gets(id)).toEqual(sorted(shouldSee.get(id)!))
    })
  }

  it('and everybody gets something, so this is not comparing two empty lists', () => {
    for (const id of [anna, bob, carol]) {
      expect(gets(id).length, 'nothing at all for ' + id).toBeGreaterThan(0)
    }
  })

  it('and nobody gets a channel from a server they are not in', () => {
    const betasRooms = (db.prepare('SELECT id FROM channels WHERE space_id = ?').all(beta) as
      Array<{ id: string }>).map((r) => r.id)
    expect(betasRooms.length).toBeGreaterThan(0)
    for (const id of gets(carol)) expect(betasRooms).not.toContain(id)
  })

  it('and somebody in nothing gets nothing', () => {
    const nobody = randomUUID()
    user(nobody)
    expect(channelsForClient(nobody)).toEqual([])
  })

  it('with a container for every server and every conversation', () => {
    const spaces = (db.prepare('SELECT COUNT(*) c FROM spaces').get() as { c: number }).c
    const talks = (db.prepare("SELECT COUNT(*) c FROM channels WHERE kind IN ('dm','group')").get() as { c: number }).c
    const containers = (db.prepare('SELECT COUNT(*) c FROM containers').get() as { c: number }).c
    expect(containers).toBe(spaces + talks)
  })
})
