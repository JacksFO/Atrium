import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, startingMembers, joinContainer } from './db.js'

/**
 * Who is in the conversations somebody is in.
 *
 * Four places ask this: the frame the socket opens with, the people it starts
 * knowing about, the search box, and the audit screen. They asked it of
 * dm_members, which knows about conversations and nothing else - so each had
 * to know, separately, that a conversation is a different kind of thing from
 * a server. Asking container_members is the same question without that.
 */
const anna = randomUUID(), bob = randomUUID(), cass = randomUUID()
let talk = '', group = '', space = ''

function user(id: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
}

function conversation(kind: 'dm' | 'group', who: string[]): string {
  const id = randomUUID()
  db.prepare('INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(id, '', kind, Date.now())
  for (const u of who) {
    joinContainer(u, id)
  }
  return id
}

/* "channel, member" pairs, as the frame builds them. */
const pairs = (rows: Array<{ channel_id: string; user_id: string }>) =>
  rows.map((r) => r.channel_id + '/' + r.user_id).sort()

const byContainment = (who: string) => pairs(db.prepare(
  `SELECT m.container_id AS channel_id, m.user_id FROM container_members m
    WHERE m.container_id IN (SELECT container_id FROM container_members WHERE user_id = ?)
      AND m.container_id IN (SELECT id FROM containers WHERE kind IN ('dm','group'))`
).all(who) as Array<{ channel_id: string; user_id: string }>)

beforeAll(() => {
  for (const u of [anna, bob, cass]) user(u)
  talk = conversation('dm', [anna, bob])
  group = conversation('group', [anna, bob, cass])
  /* And a server anna is in, which is a container and is not a conversation. */
  space = randomUUID()
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(space, 'Somewhere', anna, Date.now())
  joinContainer(anna, space, Date.now())
})

describe('the members of my conversations', () => {
  it('are exactly the people in them', () => {
    /* Measured against dm_members until it went. Written out now, because
       containment compared with containment agrees with itself whatever the
       answer is. */
    expect(byContainment(anna)).toEqual([
      `${talk}/${anna}`, `${talk}/${bob}`,
      `${group}/${anna}`, `${group}/${bob}`, `${group}/${cass}`,
    ].sort())
    expect(byContainment(cass)).toEqual([
      `${group}/${anna}`, `${group}/${bob}`, `${group}/${cass}`,
    ].sort())
  })

  it('include a pair', () => {
    expect(byContainment(anna).filter((p) => p.startsWith(talk + '/'))).toHaveLength(2)
  })

  it('and a group, not only a pair', () => {
    /* The regression this shape invites, and which it caused once already:
       narrowing to kind='dm' quietly drops every group conversation. */
    const mine = byContainment(anna)
    expect(mine.some((p) => p.startsWith(group + '/'))).toBe(true)
    expect(mine.filter((p) => p.startsWith(group + '/'))).toHaveLength(3)
  })

  it('and never a server', () => {
    expect(byContainment(anna).some((p) => p.startsWith(space + '/'))).toBe(false)
  })
})

/**
 * The people somebody starts out knowing about.
 *
 * Same question, asked to decide whose name can appear on screen. Checked
 * through the function rather than by repeating its SQL, so it is the
 * shipping answer being compared.
 */
describe('the people I start knowing about', () => {
  it('include everybody I share a conversation with', () => {
    const known = new Set((startingMembers(anna) as Array<{ id: string }>).map((u) => u.id))
    expect(known.has(bob)).toBe(true)
    expect(known.has(cass)).toBe(true)
  })

  it('and not somebody I only share a server with', () => {
    const outsider = randomUUID()
    user(outsider)
    joinContainer(outsider, space, Date.now())
    const known = new Set((startingMembers(anna) as Array<{ id: string }>).map((u) => u.id))
    expect(known.has(outsider)).toBe(false)
  })
})

describe('the queries that ship', () => {
  const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')

  /**
   * The backfill is the one place that still reads the old tables, and has
   * to - it is what put their contents into the new one. Excised by name, so
   * this cannot quietly start excusing the whole file.
   */
  function outsideTheBackfill(src: string): string {
    const at = src.indexOf('function backfillContainment')
    if (at < 0) return src
    const end = src.indexOf('export function', at)
    expect(end, 'could not find the end of the backfill').toBeGreaterThan(at)
    return src.slice(0, at) + src.slice(end)
  }

  /* Written out rather than as a pattern: the escapes in a regular
     expression do not survive every tool between here and the file, and a
     pattern that quietly stops matching passes for ever. */
  const STILL_ASKING_THE_OLD_TABLE = [
    'FROM dm_members mine',
    'JOIN dm_members theirs',
    'FROM dm_members dm',
    'FROM dm_members WHERE user_id',
    'JOIN space_members m ON m.user_id = u.id',
    'JOIN dm_members dm ON dm.channel_id = c.id',
  ]

  it('is more than one phrase, so this is not checking a single line', () => {
    expect(STILL_ASKING_THE_OLD_TABLE.length).toBeGreaterThan(4)
  })

  /*
   * And each still says which kind of container it means.
   *
   * container_members holds servers as well as conversations, so a question
   * about conversations that does not say so gets servers in the answer. In
   * one of these four that changes what is returned, and a test caught it; in
   * the other three a channel id can never be a server id, so nothing would
   * go wrong today and nothing would fail if the guard went. They are checked
   * here because the reason they are safe is a fact about ids, not about the
   * query - and Jack's whole point was that ids of different kinds should not
   * be assumed apart.
   */
  it('and each says which kind of container it means', () => {
    /* Spaces squeezed out first: this is about the query saying which kinds
       it means, not about how it is laid out, and a test that fails when
       somebody adds a space after a comma gets edited until it says nothing. */
    const squeezed = (src: string) => src.split(' ').join('')
    for (const file of ['src/gateway.ts', 'src/db.ts', 'src/index.ts', 'src/routes/admin.ts']) {
      expect(squeezed(read(file)), file + ' asks container_members without saying which kind')
        .toContain(squeezed("kind IN ('dm', 'group')"))
    }
  })

  it('ask container_members, not dm_members or space_members', () => {
    for (const file of ['src/gateway.ts', 'src/db.ts', 'src/index.ts', 'src/routes/admin.ts']) {
      const src = outsideTheBackfill(read(file))
      const guilty = STILL_ASKING_THE_OLD_TABLE.filter((phrase) => src.includes(phrase))
      expect(guilty, file + ' still asks the old tables: ' + guilty.join(', ')).toEqual([])
    }
  })
})
