import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, tightenSpaceColumns, seedRolesFor } from './db.js'

/**
 * The rules the database keeps for itself.
 *
 * space_id arrived on roles, channels and invites by ALTER TABLE, which in
 * SQLite cannot add NOT NULL or a foreign key - so for a long time "a role
 * belongs to a server" was a thing the code believed and the database did
 * not. Where that belief was wrong the old oldest-server fallbacks
 * answered about a different server rather than failing, which is how an
 * ownership check quietly became somebody else's.
 *
 * These check the rules are on, that they refuse the shapes they exist to
 * refuse, that they still accept the shapes the app writes every day, and
 * that turning them on a second time does nothing - it runs on every boot.
 */
let space = ''

function counts() {
  return {
    triggers: (db.prepare(
      "SELECT COUNT(*) c FROM sqlite_master WHERE type = 'trigger'"
    ).get() as { c: number }).c,
    indexes: (db.prepare(
      "SELECT COUNT(*) c FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL"
    ).get() as { c: number }).c,
  }
}

let before = { triggers: 0, indexes: 0 }
let tightened: string[] = []

beforeAll(() => {
  const owner = randomUUID()
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, 'owner', 'Owner', '0001', 'x', 'y', ?)`
  ).run(owner, Date.now())
  space = randomUUID()
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(space, 'Somewhere', owner, Date.now())
  seedRolesFor(space)

  before = counts()
  tightened = tightenSpaceColumns()
})

const refuses = (what: string, sql: string) => {
  it('refuses ' + what, () => {
    expect(() => db.exec(sql), 'the database accepted ' + what).toThrow()
  })
}

describe('turning the rules on', () => {
  it('tightens the three tables that needed it', () => {
    expect(tightened.sort()).toEqual(['channels', 'invites', 'roles'])
  })

  /* Rebuilding a table drops its indexes and triggers with it, silently -
     which for channels means the containment triggers. */
  it('and keeps every index and trigger that hung off them', () => {
    expect(counts()).toEqual(before)
  })

  it('and doing it again does nothing', () => {
    expect(tightenSpaceColumns()).toEqual([])
    expect(counts()).toEqual(before)
  })
})

describe('what the database now refuses', () => {
  refuses('a room in no server',
    "INSERT INTO channels (id, name, kind, position, created_at) VALUES ('a', 'a', 'text', 0, 0)")

  refuses('a conversation inside a server',
    "INSERT INTO channels (id, name, kind, position, created_at, space_id)" +
    " VALUES ('b', 'b', 'dm', 0, 0, (SELECT id FROM spaces LIMIT 1))")

  refuses('a role belonging to nothing',
    "INSERT INTO roles (id, name, created_at) VALUES ('c', 'c', 0)")

  refuses('a role in a server that is not there',
    "INSERT INTO roles (id, name, created_at, space_id) VALUES ('d', 'd', 0, 'nope')")

  refuses('an invite to a server that is not there',
    "INSERT INTO invites (id, code, space_id, created_at) VALUES ('e', 'e', 'nope', 0)")
})

/*
 * And the shapes the app writes every day still go in.
 *
 * Without these the block above passes on a table that refuses everything,
 * which is not a database that keeps a rule - it is a database that is
 * broken.
 */
describe('what it still accepts', () => {
  it('a room in a server', () => {
    const id = randomUUID()
    expect(() => db.prepare(
      'INSERT INTO channels (id, name, kind, position, created_at, space_id) VALUES (?, ?, ?, 0, 0, ?)'
    ).run(id, 'general', 'text', space)).not.toThrow()
  })

  it('a conversation, which has no server and never will', () => {
    const id = randomUUID()
    expect(() => db.prepare(
      'INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, ?, ?, 0, 0)'
    ).run(id, '', 'dm')).not.toThrow()
  })

  it('a group, the same', () => {
    const id = randomUUID()
    expect(() => db.prepare(
      'INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, ?, ?, 0, 0)'
    ).run(id, '', 'group')).not.toThrow()
  })

  it('a role in a server', () => {
    const id = randomUUID()
    expect(() => db.prepare(
      'INSERT INTO roles (id, name, created_at, space_id) VALUES (?, ?, ?, ?)'
    ).run(id, 'Moderator', Date.now(), space)).not.toThrow()
  })
})

/* A server going takes its rooms and its roles with it, which is what the
   foreign key is for - and was not true before, since there was no key. */
describe('deleting a server', () => {
  it('takes its rooms and roles with it', () => {
    const owner = randomUUID()
    db.prepare(
      `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
       VALUES (?, ?, 'O', '0002', 'x', 'y', ?)`
    ).run(owner, 'o' + owner.slice(0, 8), Date.now())
    const doomed = randomUUID()
    db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(doomed, 'Doomed', owner, Date.now())
    seedRolesFor(doomed)
    db.prepare(
      'INSERT INTO channels (id, name, kind, position, created_at, space_id) VALUES (?, ?, ?, 0, 0, ?)'
    ).run(randomUUID(), 'general', 'text', doomed)

    db.prepare('DELETE FROM spaces WHERE id = ?').run(doomed)
    const left = (db.prepare('SELECT COUNT(*) c FROM channels WHERE space_id = ?').get(doomed) as { c: number }).c
    const roles = (db.prepare('SELECT COUNT(*) c FROM roles WHERE space_id = ?').get(doomed) as { c: number }).c
    expect(left).toBe(0)
    expect(roles).toBe(0)
  })
})
