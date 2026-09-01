import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, isDirect, joinContainer, emptyContainer } from './db.js'

/**
 * Whether a channel is a conversation.
 *
 * It used to answer by looking for anybody in dm_members - so a conversation
 * everybody had left stopped being a conversation and started being treated
 * as a room in a server, which is the wrong half of the permission code to
 * fall into. The container says what a thing is directly, and keeps saying it
 * when the membership is empty.
 */
const pair = randomUUID(), group = randomUUID(), room = randomUUID()
const emptied = randomUUID(), space = randomUUID()
const anna = randomUUID(), bob = randomUUID()

function user(id: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
}

beforeAll(() => {
  user(anna); user(bob)
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(space, 'Somewhere', anna, Date.now())
  db.prepare(
    `INSERT INTO channels (id, space_id, name, kind, position, created_at)
     VALUES (?, ?, 'general', 'text', 0, ?)`
  ).run(room, space, Date.now())

  for (const [id, kind] of [[pair, 'dm'], [group, 'group'], [emptied, 'dm']] as const) {
    db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', ?, 0, ?)")
      .run(id, kind, Date.now())
  }
  for (const who of [anna, bob]) {
    joinContainer(who, pair)
    joinContainer(who, group)
    joinContainer(who, emptied)
  }
  /* And then everybody leaves that one. */
  emptyContainer(emptied)
})

describe('is this channel a conversation', () => {
  it('yes for a pair', () => {
    expect(isDirect(pair)).toBe(true)
  })

  it('yes for a group', () => {
    expect(isDirect(group)).toBe(true)
  })

  it('no for a room in a server', () => {
    expect(isDirect(room)).toBe(false)
  })

  it('no for a server itself', () => {
    /* A server has a container too, of a different kind - this must not
       mistake one for a conversation. */
    expect(isDirect(space)).toBe(false)
  })

  it('and still yes for one everybody has left', () => {
    /* The case that changed. Asked of who is in it, this answered no, and a
       conversation that is not a conversation is handled as a room in a
       server by every permission check downstream. */
    expect(db.prepare('SELECT COUNT(*) c FROM container_members WHERE container_id = ?')
      .get(emptied)).toEqual({ c: 0 })
    expect(isDirect(emptied)).toBe(true)
  })

  it('and no for something that does not exist', () => {
    expect(isDirect(randomUUID())).toBe(false)
  })
})
