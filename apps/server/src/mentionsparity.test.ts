import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, joinSpace, seedRolesFor, grantOwnerRole, joinContainer } from './db.js'
import {
  mentionedBy, recordMentions, unreadBroadcastChannels, unreadMentionChannels,
} from './mentions.js'

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
    expect(hit.named).toContain(bob)
  })

  it('and not somebody who is not in it', () => {
    /* Carol shares a conversation with anna, not this server. */
    const hit = mentionedBy(`hello @${nameOf(carol)}`, {
      channelId: room, spaceId: space, authorId: anna, broadcastAllowed: false, audience: [anna, bob],
    })
    expect(hit.named).not.toContain(carol)
  })
})

describe('naming somebody in a conversation', () => {
  it('reaches the person you are talking to', () => {
    const hit = mentionedBy(`hello @${nameOf(carol)}`, {
      channelId: talk, spaceId: null, authorId: anna, broadcastAllowed: false, audience: [anna, carol],
    })
    expect(hit.named).toContain(carol)
  })

  it('and not somebody who is merely in a server with you', () => {
    /* Bob is in anna's server and not in this conversation. */
    const hit = mentionedBy(`hello @${nameOf(bob)}`, {
      channelId: talk, spaceId: null, authorId: anna, broadcastAllowed: false, audience: [anna, carol],
    })
    expect(hit.named).not.toContain(bob)
  })
})

/**
 * And how somebody was reached, not merely that they were.
 *
 * @everyone and a message about you are different things, and a server can
 * have broadcasts turned off - so folded together, suppressing them silenced
 * the sound and left the badge exactly where it was. The two halves of one
 * setting disagreeing, which is the fault this whole area keeps producing.
 */
describe('how somebody was reached', () => {
  it('says nothing wide about a message that names one person', () => {
    const hit = mentionedBy(`hello @${nameOf(bob)}`, {
      channelId: room, spaceId: space, authorId: anna, broadcastAllowed: false, audience: [anna, bob],
    })
    expect(hit.named).toContain(bob)
    expect(hit.wideOnly).toEqual([])
  })

  it('and marks everybody an @everyone reached', () => {
    const hit = mentionedBy('hello @everyone', {
      channelId: room, spaceId: space, authorId: anna, broadcastAllowed: true, audience: [anna, bob],
    })
    expect(hit.named).toContain(bob)
    expect(hit.wideOnly, 'the badge cannot tell them apart').toContain(bob)
  })

  /*
   * And somebody named in the same breath as everybody is named, not merely
   * caught. Otherwise a message saying "@everyone, and @bob especially"
   * would be hidden from bob by a setting about broadcasts.
   */
  it('but not somebody the same message also names', () => {
    const hit = mentionedBy(`@everyone and @${nameOf(bob)} especially`, {
      channelId: room, spaceId: space, authorId: anna, broadcastAllowed: true, audience: [anna, bob],
    })
    expect(hit.named).toContain(bob)
    expect(hit.wideOnly, 'a personal mention was filed as a broadcast')
      .not.toContain(bob)
  })

  /* And the author is in neither list, however they were reached. */
  it('and never the person who said it', () => {
    const hit = mentionedBy('hello @everyone', {
      channelId: room, spaceId: space, authorId: anna, broadcastAllowed: true, audience: [anna, bob],
    })
    expect(hit.named).not.toContain(anna)
    expect(hit.wideOnly).not.toContain(anna)
  })
})

/**
 * And the two lists a connection is handed.
 *
 * Split, because whether a broadcast counts is a setting - and until this
 * column existed the list could not tell "@bob" from "@everyone", so
 * suppressing broadcasts turned the sound off and left every red number
 * exactly where it was.
 *
 * Kept apart on the way out rather than filtered here on purpose: filtering
 * would answer with the setting as it stood at connect, and turning it back
 * on would leave the badges missing until a reload.
 */
describe('where an unread mention is waiting', () => {
  const said = (body: string, broadcastAllowed: boolean) => {
    const id = randomUUID()
    db.prepare(
      `INSERT INTO messages (id, channel_id, author_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, room, anna, body, Date.now())
    recordMentions(id, room, mentionedBy(body, {
      channelId: room, spaceId: space, authorId: anna, broadcastAllowed, audience: [anna, bob],
    }))
    return id
  }

  it('puts a message naming you in the personal list and not the wide one', () => {
    said(`hello @${nameOf(bob)}`, false)
    expect(unreadMentionChannels(bob)).toContain(room)
    expect(unreadBroadcastChannels(bob), 'a personal mention counted as a broadcast')
      .not.toContain(room)
  })

  /* The half that had nowhere to go before. */
  it('and an @everyone in the wide list and not the personal one', () => {
    const other = randomUUID()
    user(other, 'dave' + other.slice(0, 4))
    joinSpace(other, space)
    const id = randomUUID()
    db.prepare(
      `INSERT INTO messages (id, channel_id, author_id, body, created_at)
       VALUES (?, ?, ?, '@everyone', ?)`
    ).run(id, room, anna, Date.now())
    recordMentions(id, room, mentionedBy('@everyone', {
      channelId: room, spaceId: space, authorId: anna, broadcastAllowed: true,
      audience: [anna, other],
    }))
    expect(unreadBroadcastChannels(other)).toContain(room)
    expect(unreadMentionChannels(other), 'a broadcast counted as being named personally')
      .not.toContain(room)
  })

  /* And reading the channel empties both, or the badge outlives the message
     that put it there. */
  it('and neither once the channel has been read', () => {
    const who = randomUUID()
    user(who, 'erin' + who.slice(0, 4))
    joinSpace(who, space)
    const id = randomUUID()
    db.prepare(
      `INSERT INTO messages (id, channel_id, author_id, body, created_at)
       VALUES (?, ?, ?, '@everyone', ?)`
    ).run(id, room, anna, Date.now() - 1000)
    recordMentions(id, room, mentionedBy('@everyone', {
      channelId: room, spaceId: space, authorId: anna, broadcastAllowed: true,
      audience: [anna, who],
    }))
    expect(unreadBroadcastChannels(who), 'nothing was waiting to begin with').toContain(room)
    db.prepare(
      'INSERT OR REPLACE INTO read_state (user_id, channel_id, last_read_at) VALUES (?, ?, ?)'
    ).run(who, room, Date.now())
    expect(unreadBroadcastChannels(who)).not.toContain(room)
    expect(unreadMentionChannels(who)).not.toContain(room)
  })
})
