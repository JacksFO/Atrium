import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, joinSpace, seedRolesFor, grantOwnerRole } from './db.js'
import { permissionsFor } from './permissions.js'

/**
 * What a server grants somebody who is not in it.
 *
 * Nothing. That is the whole of it, and it was not what happened: this read
 * the server's @everyone role and handed those permissions to whoever asked,
 * member or not. Nothing leaked, because the channel list is filtered again
 * by canAccessChannel and that does check membership - but it meant the
 * security of the list rested entirely on the second check while the first
 * one returned a confidently wrong answer.
 *
 * Two checks where one is wrong and one is load-bearing is how a leak arrives
 * later: the next person to reach for permissionsFor with a server in their
 * hand gets told yes.
 */
const space = randomUUID()
const owner = randomUUID()
const member = randomUUID()
const outsider = randomUUID()

function user(id: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
}

beforeAll(() => {
  user(owner); user(member); user(outsider)
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(space, 'Somewhere', owner, Date.now())
  seedRolesFor(space)
  grantOwnerRole(space)
  joinSpace(owner, space)
  joinSpace(member, space)
})

describe('what a server grants', () => {
  it('gives a member what @everyone has', () => {
    expect([...permissionsFor(member, space)]).toContain('view_channels')
  })

  it('gives whoever made it everything', () => {
    expect([...permissionsFor(owner, space)]).toContain('manage_channels')
  })

  it('and gives somebody who is not in it nothing at all', () => {
    /* The point. Not "less" - nothing. */
    expect([...permissionsFor(outsider, space)]).toEqual([])
  })

  it('so a stranger cannot read view_channels off a server they never joined', () => {
    expect(permissionsFor(outsider, space).has('view_channels')).toBe(false)
  })

  it('and joining is what changes that', () => {
    /* So the test above cannot be passing because the space is broken. */
    const late = randomUUID()
    user(late)
    expect(permissionsFor(late, space).has('view_channels')).toBe(false)
    joinSpace(late, space)
    expect(permissionsFor(late, space).has('view_channels')).toBe(true)
  })
})
