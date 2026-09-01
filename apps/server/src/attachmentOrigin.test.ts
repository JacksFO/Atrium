import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, joinSpace, seedRolesFor, grantOwnerRole } from './db.js'

/**
 * A file says where it came from.
 *
 * All of it was derivable before: an attachment knows its message, a message
 * knows its channel, a channel knows its server. Fine for one file, and no
 * use for the questions worth asking - how much is this server holding, what
 * has this person posted, what goes when they leave. Each was three joins and
 * a scan over every attachment there has ever been.
 *
 * The interesting half is the backfill. Adding a column is nothing; filling in
 * everything already there, correctly, without touching rows that were written
 * properly, is where this can be quietly wrong - and it would be wrong in the
 * direction of a file that belongs to nobody.
 */

const space = randomUUID()
const owner = randomUUID()
const channel = randomUUID()
const dm = randomUUID()
const inChannel = randomUUID()
const inDm = randomUUID()

beforeAll(() => {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(owner, 'u' + owner.slice(0, 8), 'U' + owner.slice(0, 8), Date.now())
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(space, 'Somewhere', owner, Date.now())
  seedRolesFor(space)
  grantOwnerRole(space)
  joinSpace(owner, space)

  db.prepare(
    `INSERT INTO channels (id, name, kind, position, space_id, created_at)
     VALUES (?, 'general', 'text', 0, ?, ?)`
  ).run(channel, space, Date.now())
  /* A conversation, which belongs to no server - the case a backfill built
     from "the channel's server" has to leave null rather than invent. */
  db.prepare(
    `INSERT INTO channels (id, name, kind, position, space_id, created_at)
     VALUES (?, 'dm', 'dm', 0, NULL, ?)`
  ).run(dm, Date.now())

  for (const [id, where] of [[inChannel, channel], [inDm, dm]] as const) {
    db.prepare(
      `INSERT INTO messages (id, channel_id, author_id, body, created_at)
       VALUES (?, ?, ?, 'here', ?)`
    ).run(id, where, owner, Date.now())
    /* Written the way a row looked before these columns existed: the file and
       its message, and nothing about where that was. */
    db.prepare(
      `INSERT INTO attachments (id, message_id, filename, mime, bytes, path)
       VALUES (?, ?, 'cat.png', 'image/png', 10, ?)`
    ).run(randomUUID(), id, `/uploads/${id}.png`)
  }

  /* The migration runs at import, so these rows are filled by hand the same
     way it would - the query is the one in db.ts. */
  db.exec(`
    UPDATE attachments SET
      channel_id = (SELECT m.channel_id FROM messages m WHERE m.id = attachments.message_id),
      user_id    = (SELECT m.author_id  FROM messages m WHERE m.id = attachments.message_id),
      space_id   = (SELECT c.space_id FROM messages m
                      JOIN channels c ON c.id = m.channel_id
                     WHERE m.id = attachments.message_id)
    WHERE channel_id IS NULL OR user_id IS NULL
  `)
})

const row = (messageId: string) => db
  .prepare('SELECT space_id, channel_id, user_id FROM attachments WHERE message_id = ?')
  .get(messageId) as { space_id: string | null; channel_id: string; user_id: string }

describe('a file posted in a server', () => {
  it('knows its channel and who posted it', () => {
    const got = row(inChannel)
    expect(got.channel_id).toBe(channel)
    expect(got.user_id).toBe(owner)
  })

  it('and which server that channel is in', () => {
    expect(row(inChannel).space_id).toBe(space)
  })
})

describe('a file sent in a conversation', () => {
  /*
   * Null, not missing and not invented. A conversation has no server, and a
   * backfill that reached for one would either fail or quietly attribute
   * somebody's private message to a server they happen to be in.
   */
  it('belongs to no server, and says so', () => {
    expect(row(inDm).space_id).toBeNull()
  })

  it('while still knowing the channel and the person', () => {
    const got = row(inDm)
    expect(got.channel_id).toBe(dm)
    expect(got.user_id).toBe(owner)
  })
})

describe('the questions this exists to answer', () => {
  it('what one server is holding', () => {
    const held = db
      .prepare('SELECT COUNT(*) n, SUM(bytes) b FROM attachments WHERE space_id = ?')
      .get(space) as { n: number; b: number }
    expect(held.n).toBe(1)
    expect(held.b).toBe(10)
  })

  it('and what one person has posted, wherever they posted it', () => {
    const mine = db
      .prepare('SELECT COUNT(*) n FROM attachments WHERE user_id = ?')
      .get(owner) as { n: number }
    /* Both: the one in the server and the one in the conversation. Counting
       only the server's would be the join this replaces, done wrong. */
    expect(mine.n).toBe(2)
  })

  /* And it is an index rather than a scan, which is the whole reason for
     putting it on the row instead of joining for it. */
  it('without reading every attachment there has ever been', () => {
    const plan = db
      .prepare('EXPLAIN QUERY PLAN SELECT bytes FROM attachments WHERE space_id = ?')
      .all(space) as unknown as Array<{ detail: string }>
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/USING INDEX/i)
  })
})
