import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, joinSpace, seedRolesFor, grantOwnerRole, joinContainer } from './db.js'
import { mentionedBy } from './mentions.js'

/**
 * Who a message can name.
 *
 * In a server: its members and its mentionable roles. In a conversation: the
 * people in it. Two different tables, chosen by a ternary on whether there is
 * a server - which is the same shape containment exists to remove.
 *
 * Worth checking rather than assuming, because being wrong here is either a
 * notification somebody should not have had, or one they should have and did
 * not.
 */
const space = randomUUID()
const anna = randomUUID(), bob = randomUUID(), carol = randomUUID()
let room = '', talk = ''

function user(id: string, name: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, name, name, Date.now())
}

beforeAll(() => {
  user(anna, 'anna' + anna.slice(0, 4))
  user(bob, 'bob' + bob.slice(0, 4))
  user(carol, 'carol' + carol.slice(0, 4))

  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(space, 'Somewhere', anna, Date.now())
  seedRolesFor(space); grantOwnerRole(space)
  joinSpace(anna, space); joinSpace(bob, space)

  room = randomUUID()
  db.prepare(
    `INSERT INTO channels (id, space_id, name, kind, position, created_at)
     VALUES (?, ?, 'general', 'text', 0, ?)`
  ).run(room, space, Date.now())

  talk = randomUUID()
  db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', 'dm', 0, ?)")
    .run(talk, Date.now())
  for (const who of [anna, carol]) {
    joinContainer(who, talk)
  }
})

const nameOf = (id: string) =>
  (db.prepare('SELECT username FROM users WHERE id = ?').get(id) as { username: string }).username

describe('naming somebody in a server channel', () => {
  it('reaches a member of that server', () => {
    const hit = mentionedBy(`hello @${nameOf(bob)}`, {
      channelId: room, spaceId: space, authorId: anna, broadcastAllowed: false, audience: [anna, bob],
    })
    expect(hit).toContain(bob)
  })

  it('and not somebody who is not in it', () => {
    /* Carol shares a conversation with anna, not this server. */
    const hit = mentionedBy(`hello @${nameOf(carol)}`, {
      channelId: room, spaceId: space, authorId: anna, broadcastAllowed: false, audience: [anna, bob],
    })
    expect(hit).not.toContain(carol)
  })
})

describe('naming somebody in a conversation', () => {
  it('reaches the person you are talking to', () => {
    const hit = mentionedBy(`hello @${nameOf(carol)}`, {
      channelId: talk, spaceId: null, authorId: anna, broadcastAllowed: false, audience: [anna, carol],
    })
    expect(hit).toContain(carol)
  })

  it('and not somebody who is merely in a server with you', () => {
    /* Bob is in anna's server and not in this conversation. */
    const hit = mentionedBy(`hello @${nameOf(bob)}`, {
      channelId: talk, spaceId: null, authorId: anna, broadcastAllowed: false, audience: [anna, carol],
    })
    expect(hit).not.toContain(bob)
  })
})
