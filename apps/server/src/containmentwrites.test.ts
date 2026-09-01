import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  db, joinContainer, leaveContainer, emptyContainer, setRailPosition, setConversationClosed,
  makeContainer, unmakeContainer,
} from './db.js'

/**
 * Membership is written once, in one place.
 *
 * Reads moved to container_members first, with triggers mirroring the old
 * tables into it - which is what made it safe to start reading before
 * anything else changed. But the old tables were still the thing being
 * written, and they cannot be dropped while that is true.
 *
 * So the writes go through five functions. These check the two tables agree
 * after each one, which is what has to hold for as long as both exist, and
 * that nothing outside db.ts writes them directly - which is what has to hold
 * for the old ones to go at all.
 */

function user(): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
  return id
}

function space(owner: string): string {
  const id = randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(id, 'S', owner, now)
  makeContainer(id, 'space', now)
  return id
}

function conversation(): string {
  const id = randomUUID()
  const now = Date.now()
  db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', 'dm', 0, ?)")
    .run(id, now)
  makeContainer(id, 'dm', now)
  return id
}

/* What each table thinks, as a comparable shape. */
const inNew = (c: string) => (db.prepare(
  'SELECT user_id, position, hidden_at, joined_at FROM container_members WHERE container_id = ? ORDER BY user_id'
).all(c) as Array<Record<string, unknown>>)

describe('joining a server', () => {
  it('is recorded in containment', () => {
    const anna = user(), sp = space(anna)
    joinContainer(anna, sp)
    expect(inNew(sp).map((r) => r.user_id)).toEqual([anna])
  })

  it('and twice is once', () => {
    const anna = user(), sp = space(anna)
    joinContainer(anna, sp)
    joinContainer(anna, sp)
    expect(inNew(sp)).toHaveLength(1)
  })
})

describe('being in a conversation', () => {
  it('goes to containment', () => {
    const anna = user(), bob = user(), talk = conversation()
    joinContainer(anna, talk)
    joinContainer(bob, talk)
    expect(inNew(talk).map((r) => r.user_id).sort()).toEqual([anna, bob].sort())
  })

  /* The trigger and the backfill both wrote the conversation's own time, so
     a row written directly has to say the same thing or it is a row that
     disagrees with the ones beside it. */
  it('and says they joined when the conversation was made', () => {
    const anna = user(), talk = conversation()
    const made = (db.prepare('SELECT created_at FROM channels WHERE id = ?').get(talk) as
      { created_at: number }).created_at
    joinContainer(anna, talk, Date.now() + 5000)
    const row = inNew(talk)[0] as { joined_at: number }
    expect(row.joined_at, 'the column has to be selected for this to mean anything')
      .not.toBeUndefined()
    expect(row.joined_at).toBe(made)
  })
})

describe('closing a conversation', () => {
  it('closes it for one person and not the other', () => {
    const anna = user(), bob = user(), talk = conversation()
    joinContainer(anna, talk); joinContainer(bob, talk)
    const changed = setConversationClosed(anna, talk, 1234)
    expect(changed).toBe(1)
    const mine = inNew(talk).find((r) => r.user_id === anna)
    const theirs = inNew(talk).find((r) => r.user_id === bob)
    expect(mine?.hidden_at).toBe(1234)
    expect(theirs?.hidden_at ?? null).toBe(null)
  })

  it('and something being said reopens it for everybody', () => {
    const anna = user(), bob = user(), talk = conversation()
    joinContainer(anna, talk); joinContainer(bob, talk)
    setConversationClosed(anna, talk, 1234)
    setConversationClosed(bob, talk, 5678)
    setConversationClosed(null, talk, null)
    expect(inNew(talk).every((r) => r.hidden_at === null)).toBe(true)
  })

  it('and closing one that is not yours changes nothing', () => {
    const anna = user(), outsider = user(), talk = conversation()
    joinContainer(anna, talk)
    expect(setConversationClosed(outsider, talk, 1234)).toBe(0)
  })
})

describe('the order of the rail', () => {
  it('is one person, not everybody', () => {
    const anna = user(), bob = user(), sp = space(anna)
    joinContainer(anna, sp); joinContainer(bob, sp)
    setRailPosition(anna, sp, 7)
    expect(inNew(sp).find((r) => r.user_id === anna)?.position).toBe(7)
    expect(inNew(sp).find((r) => r.user_id === bob)?.position ?? null).toBe(null)
  })
})

describe('leaving', () => {
  it('takes the row out', () => {
    const anna = user(), bob = user(), sp = space(anna)
    joinContainer(anna, sp); joinContainer(bob, sp)
    leaveContainer(anna, sp)
    expect(inNew(sp).map((r) => r.user_id)).toEqual([bob])
  })

  it('and emptying takes everybody', () => {
    const anna = user(), bob = user(), sp = space(anna)
    joinContainer(anna, sp); joinContainer(bob, sp)
    emptyContainer(sp)
    expect(inNew(sp)).toEqual([])
  })
})

describe('where membership is written', () => {
  const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')

  /* The old tables are gone. What has to stay true is that nothing anywhere
     writes membership except through the helpers - so the check is now that
     no file outside db.ts writes container_members either. */
  const WRITES = [
    'INTO container_members', 'UPDATE container_members', 'DELETE FROM container_members',
  ]

  it('is db.ts and nowhere else', () => {
    for (const file of ['src/gateway.ts', 'src/index.ts', 'src/routes/spaces.ts', 'src/routes/admin.ts']) {
      const src = read(file)
      const guilty = WRITES.filter((w) => src.includes(w))
      expect(guilty, file + ' writes membership directly: ' + guilty.join(', ')).toEqual([])
    }
  })

  /* And db.ts still writes both, which is the whole point of the helpers
     while the old tables are still there - a check that would pass on a
     db.ts that had stopped writing either one. */
  it('and db.ts does all three', () => {
    const src = read('src/db.ts')
    for (const w of WRITES) expect(src, w + ' is written nowhere').toContain(w)
  })
})

/**
 * The two triggers that stayed, and why they are the two.
 *
 * Eight of the ten went with the old tables. Of the four on `spaces` and
 * `channels`, the pair that made a container went too: makeContainer is
 * called where a server or a conversation is born, and a container that is
 * missing announces itself - the foreign key on container_members refuses the
 * first person to join, and joinContainer makes it rather than throwing.
 *
 * The pair that removes one stayed, for the opposite reason. A container left
 * behind after its server is deleted breaks nothing at the moment it happens:
 * the row sits there with its members, and a server nobody can name turns up
 * in somebody's list. Nothing throws and nothing logs. No foreign key can
 * catch it either, because a container's id is a server's id or a channel's
 * and SQLite cannot reference one-of-two. So the guard is kept where the
 * failure would be silent, and dropped where it would be loud.
 */
describe('the guards that remain', () => {
  it('are the two that clean up, and nothing else', () => {
    const names = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'containment_%' ORDER BY name"
    ).all() as Array<{ name: string }>).map((r) => r.name)
    expect(names).toEqual(['containment_space_gone', 'containment_talk_gone'])
  })

  it('and deleting a server takes its container with it', () => {
    const anna = user(), sp = space(anna)
    joinContainer(anna, sp)
    db.prepare('DELETE FROM spaces WHERE id = ?').run(sp)
    expect(db.prepare('SELECT 1 FROM containers WHERE id = ?').get(sp)).toBeUndefined()
    expect(inNew(sp), 'its memberships should have cascaded').toEqual([])
  })

  it('and deleting a conversation does too', () => {
    const anna = user(), talk = conversation()
    joinContainer(anna, talk)
    db.prepare('DELETE FROM channels WHERE id = ?').run(talk)
    expect(db.prepare('SELECT 1 FROM containers WHERE id = ?').get(talk)).toBeUndefined()
    expect(inNew(talk)).toEqual([])
  })
})

/*
 * And joining something whose container was never made still works.
 *
 * The trigger used to make it. Nothing has to remember now either, because
 * joinContainer works the kind out from the tables that already know it - a
 * server is a row in spaces, a conversation is a channel that says so - and
 * writes the row rather than failing on the foreign key. On the live server
 * the difference is a 500 when somebody accepts an invite.
 */
describe('joining something whose container is missing', () => {
  it('makes it rather than throwing', () => {
    const anna = user()
    const id = randomUUID()
    db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(id, 'Orphan', anna, Date.now())
    expect(db.prepare('SELECT 1 FROM containers WHERE id = ?').get(id)).toBeUndefined()

    expect(() => joinContainer(anna, id)).not.toThrow()
    expect(db.prepare('SELECT kind FROM containers WHERE id = ?').get(id)).toEqual({ kind: 'space' })
    expect(inNew(id).map((r) => r.user_id)).toEqual([anna])
  })

  it('and refuses something that is not a container at all', () => {
    const anna = user()
    expect(() => joinContainer(anna, randomUUID())).toThrow()
  })
})

/**
 * Unmaking a container.
 *
 * container_members references containers ON DELETE CASCADE, which does
 * nothing at all unless foreign keys are switched on for the connection - so
 * this is as much a check that they are as it is a check of the function.
 */
describe('unmaking a container', () => {
  it('takes its members with it', () => {
    const anna = user(), bob = user(), sp = space(anna)
    joinContainer(anna, sp); joinContainer(bob, sp)
    expect(inNew(sp)).toHaveLength(2)
    unmakeContainer(sp)
    expect(db.prepare('SELECT 1 FROM containers WHERE id = ?').get(sp)).toBeUndefined()
    expect(inNew(sp), 'the cascade did not fire - are foreign keys on?').toEqual([])
  })
})
