import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, channelsForClient, joinSpace, seedRolesFor, grantOwnerRole, joinContainer } from './db.js'

/**
 * What one person's client is handed at sign-in.
 *
 * This used to be "every text and voice channel in the app", filtered
 * down afterwards in JavaScript. The answer was right - membership is checked
 * again before any of it is used - but the work was priced by the size of the
 * machine rather than by the size of the answer, on the path every connection
 * takes. At 2,000 servers it built 40,002 rows to hand somebody 202.
 *
 * So the guarantee worth pinning is not the speed, which will drift, but the
 * shape: a server somebody is not in contributes nothing, and a conversation
 * somebody is not in contributes nothing. If either ever came back, the old
 * behaviour would be back with it and nothing else here would notice.
 */
const mine = randomUUID()
const theirs = randomUUID()
const me = randomUUID()
const them = randomUUID()
const myChannel = randomUUID()
const theirChannel = randomUUID()
const ourDm = randomUUID()
const theirDm = randomUUID()
const stranger = randomUUID()

function user(id: string, name: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, name, name, Date.now())
}

function space(id: string, owner: string, channel: string) {
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(id, 'space' + id.slice(0, 4), owner, Date.now())
  seedRolesFor(id)
  grantOwnerRole(id)
  joinSpace(owner, id)
  db.prepare(
    `INSERT INTO channels (id, space_id, name, kind, position, created_at)
     VALUES (?, ?, 'general', 'text', 0, ?)`
  ).run(channel, id, Date.now())
}

function dm(id: string, a: string, b: string) {
  db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', 'dm', 0, ?)")
    .run(id, Date.now())
  joinContainer(a, id)
  joinContainer(b, id)
}

beforeAll(() => {
  user(me, 'me' + me.slice(0, 4))
  user(them, 'them' + them.slice(0, 4))
  user(stranger, 'third' + stranger.slice(0, 4))
  space(mine, me, myChannel)
  space(theirs, them, theirChannel)
  dm(ourDm, me, them)
  dm(theirDm, them, stranger)
})

const idsFor = (who: string) =>
  channelsForClient(who).map((c) => String((c as { id: unknown }).id))

describe('the channels handed to a client at sign-in', () => {
  it('include the ones in a server they are in', () => {
    expect(idsFor(me)).toContain(myChannel)
  })

  it('and their own conversations', () => {
    expect(idsFor(me)).toContain(ourDm)
  })

  it('but not a channel in a server they are not in', () => {
    /* The whole point. This used to be handed over and filtered out later. */
    expect(idsFor(me)).not.toContain(theirChannel)
  })

  it('and not a conversation between other people', () => {
    expect(idsFor(me)).not.toContain(theirDm)
  })

  it('and the other person sees the mirror of that', () => {
    /* So this cannot be passing by returning nothing at all. */
    const theirs2 = idsFor(them)
    expect(theirs2).toContain(theirChannel)
    expect(theirs2).toContain(ourDm)
    expect(theirs2).not.toContain(myChannel)
  })

  it('and a group conversation, not only a pair', () => {
    /*
     * The query this replaced asked for anything somebody was a dm_member of,
     * whatever kind it was. Narrowing it to 'dm' dropped groups from the
     * frame - nobody had one, so nothing broke, and nothing would have said
     * so until somebody made one and it was simply absent.
     */
    const group = randomUUID()
    db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', 'group', 0, ?)")
      .run(group, Date.now())
    for (const who of [me, them]) {
      joinContainer(who, group)
    }
    expect(idsFor(me)).toContain(group)
  })

  it('and somebody in nothing is handed nothing', () => {
    const nobody = randomUUID()
    user(nobody, 'nobody' + nobody.slice(0, 4))
    expect(idsFor(nobody)).toEqual([])
  })
})
