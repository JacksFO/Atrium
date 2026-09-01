import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, seedRolesFor, grantOwnerRole, joinSpace } from './db.js'
import { setAccess } from './access.js'
import { registerSpaceRoutes } from './routes/spaces.js'
import type { User } from './db.js'

/**
 * Asking what is in a server.
 *
 * There was no way to ask. A channel list reached a client once, in the frame
 * the socket opens with, and a server made or joined after that came up with
 * its headings and nothing under them until something dropped the socket.
 *
 * This is the route that fixes it, and it is a route that decides what
 * somebody may see - so the two gates the opening frame applies are the two
 * things worth proving here, against a real database rather than against a
 * reading of the source.
 */

/** Whoever the next request is from. */
let who: User | null = null
const app = Fastify()

const space = randomUUID()
const owner = randomUUID()
/* A plain member, because the owner can see everything and so proves nothing. */
const member = randomUUID()
const outsider = randomUUID()
const openChannel = randomUUID()
const privateChannel = randomUUID()

function makeUser(id: string, name: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, name, name, Date.now())
}

beforeAll(async () => {
  registerSpaceRoutes(app, (async () => who) as never)
  await app.ready()

  makeUser(owner, 'owner' + owner.slice(0, 4))
  makeUser(member, 'member' + member.slice(0, 4))
  makeUser(outsider, 'outsider' + outsider.slice(0, 4))

  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(space, 'Somewhere', owner, Date.now())
  /* Through the same calls making a server uses, so the roles this route
     reads through are the roles a real server has. */
  seedRolesFor(space)
  grantOwnerRole(space)
  joinSpace(owner, space)
  joinSpace(member, space)

  for (const [id, name, pos] of [[openChannel, 'general', 0], [privateChannel, 'staff', 1]] as const) {
    db.prepare(
      `INSERT INTO channels (id, space_id, name, kind, position, created_at)
       VALUES (?, ?, ?, 'text', ?, ?)`
    ).run(id, space, name, pos, Date.now())
  }
  /* Shut to everybody and opened to nobody, which is what making a channel
     private does - not a column this test invented. */
  setAccess(privateChannel, true, [], [])
})

async function ask(as: string) {
  who = { id: as } as unknown as User
  const res = await app.inject({ method: 'GET', url: `/api/channels?spaceId=${space}` })
  return JSON.parse(res.body) as { channels?: Array<{ id: string; name: string }> }
}

describe('the channels of one server', () => {
  it('gives a member the channels they can reach', async () => {
    const got = await ask(member)
    const names = (got.channels ?? []).map((c) => c.name)
    expect(names).toContain('general')
  })

  it('leaves out one they cannot enter', async () => {
    /* Not disabled and not named - somebody who cannot open a channel has no
       reason to learn that it exists. */
    const got = await ask(member)
    expect((got.channels ?? []).map((c) => c.id)).not.toContain(privateChannel)
  })

  it('while the owner, who can enter it, is told about it', async () => {
    /* The other half of the same rule. Without this the test above passes
       just as well on a route that returns nothing at all. */
    const got = await ask(owner)
    expect((got.channels ?? []).map((c) => c.id)).toContain(privateChannel)
  })

  it('and nothing to a member whose role cannot view channels', async () => {
    /*
     * The gate above the per-channel one, and the reason it is worth having
     * separately: view_channels is a server-wide permission, so losing it
     * should take the whole list rather than being decided a channel at a
     * time. Deleting the route's own view_channels line does not change
     * this answer: measured, and it still comes back empty, because the
     * per-channel check refuses every channel for the same reason. So that
     * line is defence in depth and cannot be proven on its own - what this
     * pins is the behaviour, which is what somebody would notice, and it
     * holds whichever of the two is doing the work.
     */
    const everyone = db.prepare(
      "SELECT id, permissions FROM roles WHERE space_id = ? AND kind = 'everyone'"
    ).get(space) as { id: string; permissions: string } | undefined
    expect(everyone, 'the space has no @everyone role to take it from').toBeTruthy()

    const had = everyone!.permissions
    const without = (JSON.parse(had) as string[]).filter((p) => p !== 'view_channels')
    db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
      .run(JSON.stringify(without), everyone!.id)
    try {
      const got = await ask(member)
      expect(got.channels).toEqual([])
    } finally {
      db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(had, everyone!.id)
    }

    /* And it comes back when the permission does, so this is not passing
       because something else broke along the way. */
    expect((await ask(member)).channels?.length).toBeGreaterThan(0)
  })

  it('tells somebody who is not in it nothing at all', async () => {
    const got = await ask(outsider)
    expect(got.channels).toEqual([])
  })
})
