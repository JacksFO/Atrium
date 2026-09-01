import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, joinContainer, setConversationClosed } from './db.js'

/**
 * A conversation somebody has closed.
 *
 * Closing takes it off your list and nobody else's, and it comes back the
 * moment something is said in it. Both of those are an UPDATE of one column -
 * the same case the rail order needed a trigger for, and the same silent
 * failure without one: the conversation would stay closed for ever, or come
 * back and never leave, depending on which way the update went.
 */
const anna = randomUUID(), bob = randomUUID()
let talk = ''

function user(id: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
}

const closedFor = (who: string) =>
  (db.prepare('SELECT container_id FROM container_members WHERE user_id = ? AND hidden_at IS NOT NULL')
    .all(who) as Array<{ container_id: string }>).map((r) => r.container_id)

beforeAll(() => {
  user(anna); user(bob)
  talk = randomUUID()
  db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', 'dm', 0, ?)")
    .run(talk, Date.now())
  for (const who of [anna, bob]) {
    joinContainer(who, talk)
  }
})

describe('closing a conversation', () => {
  it('starts open for both of them', () => {
    expect(closedFor(anna)).not.toContain(talk)
    expect(closedFor(bob)).not.toContain(talk)
  })

  it('closes it for the one who closed it', () => {
    setConversationClosed(anna, talk, Date.now())
    expect(closedFor(anna), 'the close did not reach containment').toContain(talk)
  })

  it('and not for the other person', () => {
    /* The whole point of it being on the membership. */
    expect(closedFor(bob)).not.toContain(talk)
  })

  it('and it comes back when something is said in it', () => {
    setConversationClosed(null, talk, null)
    expect(closedFor(anna), 'the reopen did not reach containment').not.toContain(talk)
  })
})
