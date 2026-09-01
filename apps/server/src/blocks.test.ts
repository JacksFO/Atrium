import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  db, addFriend, areFriends, blockUser, blockedBetween, blockedBy, hasBlocked,
  unblockUser,
} from './db.js'

/**
 * Not wanting to hear from somebody you have met.
 *
 * The app was careful about strangers and had nothing at all for this. A
 * conversation can only be opened with a friend, somebody you share a server
 * with, or somebody already talking to you - which is the right rule, and it
 * means the one person you might badly want to stop hearing from has already
 * passed it. Until this, the only remedy was to leave the server.
 *
 * The tests that matter are about direction. A block is one person's
 * decision, stored one way round - and every check made of it has to ask
 * about both ways round, because the thing being stopped is a channel
 * between two people and a channel is not one-way. Getting that wrong is
 * silent: blocking somebody would stop you writing to them and leave them
 * writing to you, which is the opposite of what the button says.
 */

function user(): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
  return id
}

describe('a block runs both ways', () => {
  it('stops the blocker reaching them', () => {
    const me = user(), them = user()
    blockUser(me, them)
    expect(blockedBetween(me, them)).toBe(true)
  })

  /*
   * The one that fails if the check is written the obvious way.
   *
   * `blocker_id = ? AND blocked_id = ?` reads correctly, passes the test
   * above, and leaves the blocked person able to message, ring and befriend
   * somebody who has just decided otherwise.
   */
  it('and stops them reaching the blocker', () => {
    const me = user(), them = user()
    blockUser(me, them)
    expect(blockedBetween(them, me)).toBe(true)
  })

  it('and reaches nobody else', () => {
    const me = user(), them = user(), other = user()
    blockUser(me, them)
    expect(blockedBetween(me, other)).toBe(false)
    expect(blockedBetween(them, other)).toBe(false)
  })
})

describe('whose decision it was', () => {
  /*
   * Directional in the row even though it is symmetric in effect, because
   * lifting it is the blocker's alone. Stored as an unordered pair - the way
   * friendships are - it would lose the only thing about a block that
   * matters, and either of them could undo it.
   */
  it('is kept, so only the blocker can lift it', () => {
    const me = user(), them = user()
    blockUser(me, them)
    expect(hasBlocked(me, them)).toBe(true)
    expect(hasBlocked(them, me)).toBe(false)

    /* Them trying to lift it changes nothing. */
    expect(unblockUser(them, me)).toBe(false)
    expect(blockedBetween(me, them)).toBe(true)

    expect(unblockUser(me, them)).toBe(true)
    expect(blockedBetween(me, them)).toBe(false)
  })

  /*
   * Nothing anywhere answers "who has blocked me".
   *
   * It is somebody else's private decision about their own attention, and it
   * is the one fact about a block worth arguing over. So the only list is
   * the blocker's own.
   */
  it('and the list is only ever your own direction', () => {
    const me = user(), them = user()
    blockUser(me, them)
    expect(blockedBy(me)).toContain(them)
    expect(blockedBy(them)).not.toContain(me)
  })

  it('and you cannot block yourself', () => {
    const me = user()
    blockUser(me, me)
    expect(blockedBy(me)).toHaveLength(0)
  })
})

describe('what blocking undoes', () => {
  /*
   * A friendship is a mutual agreement to be reachable, and blocking is
   * withdrawing it. Left in place it would put somebody on the friends list,
   * un-writeable-to, which reads as a bug rather than as a decision.
   */
  it('ends the friendship', () => {
    const me = user(), them = user()
    addFriend(me, them)
    expect(areFriends(me, them)).toBe(true)

    blockUser(me, them)
    expect(areFriends(me, them)).toBe(false)
  })

  it('and any request either way round', () => {
    const me = user(), them = user()
    db.prepare('INSERT INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)')
      .run(them, me, Date.now())

    blockUser(me, them)
    const left = db.prepare(
      'SELECT COUNT(*) c FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)'
    ).get(me, them, them, me) as { c: number }
    expect(left.c).toBe(0)
  })

  /*
   * And lifting it does not put the friendship back. Being willing to hear
   * from somebody again is not being friends with them, and restoring it
   * would be a decision neither of them made.
   */
  it('and lifting it does not restore what it ended', () => {
    const me = user(), them = user()
    addFriend(me, them)
    blockUser(me, them)
    unblockUser(me, them)
    expect(areFriends(me, them)).toBe(false)
  })

  /*
   * What was said stays said. Deleting somebody's history because two people
   * fell out is not this button's business - hiding it is the reader's
   * client's job, and only while the block stands.
   */
  it('and nothing that was already said', () => {
    const me = user(), them = user()
    const channel = randomUUID()
    db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', 'dm', 0, ?)")
      .run(channel, Date.now())
    db.prepare(
      'INSERT INTO messages (id, channel_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(randomUUID(), channel, them, 'hello', Date.now())

    blockUser(me, them)
    const left = db.prepare('SELECT COUNT(*) c FROM messages WHERE channel_id = ?')
      .get(channel) as { c: number }
    expect(left.c).toBe(1)
  })

  /* And it goes with the account, like every other row about a person. */
  it('and goes when either account does', () => {
    const me = user(), them = user()
    blockUser(me, them)
    db.prepare('DELETE FROM users WHERE id = ?').run(them)
    expect(blockedBy(me)).toHaveLength(0)
  })
})

/**
 * And the four places it has to bite.
 *
 * A blocks table that nothing consults is the same feature that was missing,
 * so what is worth checking is that each path where one person reaches
 * another asks - and asks about both directions. These are read from the
 * source: every one of them is inside a route or a frame handler that cannot
 * be reached without standing a server up.
 */
const read = (...p: string[]) =>
  readFileSync(join(__dirname, ...p), 'utf8').split('\r\n').join('\n')

const gateway = read('gateway.ts')
const index = read('index.ts')
const admin = read('routes', 'admin.ts')

function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from)
  expect(a, `${from} exists`).toBeGreaterThan(-1)
  const b = src.indexOf(to, a + from.length)
  expect(b, `${from} is bounded`).toBeGreaterThan(a)
  return src.slice(a, b)
}

describe('the paths a block has to stop', () => {
  it('opening a conversation', () => {
    const route = slice(admin, "app.post('/api/dms'", '\n  app.')
    expect(route).toContain('blockedBetween(user.id, id)')
  })

  /*
   * Sending into one that already exists.
   *
   * Not delivered-and-hidden. Hiding it would leave the message written
   * down, counted in an unread badge, and waiting for the day the block is
   * lifted - which is not what blocking means, and is worse than useless if
   * what they were saying was the reason for it.
   */
  it('sending into one that already exists', () => {
    const send = slice(gateway, "case 'send': {", "\n        case '")
    expect(send).toContain('blockedBetween(me, others[0]!)')
    /* Only a conversation between two people. A group is other people's as
       well, and one member's block is not a veto on what they can read. */
    expect(send).toContain('others.length === 1')
    /* Said out loud, or the client retries it on every reconnect for ever. */
    expect(send).toMatch(/refuse\('You cannot send messages to them\.'\)/)
  })

  it('ringing', () => {
    /* The four call cases share one body, so the slice starts at the last of
       the labels. Bounding from 'call-ring' stops at 'call-cancel', which is
       the next line - before the body this is about even begins. */
    const call = slice(gateway, "case 'call-decline': {", "\n        case '")
    expect(call).toContain('blockedBetween(client.user.id, target)')
    /* The same answer as being offline, which is the honest one: this call
       is not going to connect, and which of the two blocked the other is
       nobody's business but theirs. */
    expect(call).toContain("send(socket, { t: 'call-unavailable', to: target })")
  })

  it('and asking to be friends', () => {
    const route = slice(index, "app.post('/api/friends/request'", '\napp.')
    expect(route).toContain('blockedBetween(user.id, target.id)')
    /*
     * Answering with the generic "sent", not with a refusal.
     *
     * Everything on that route which is not about the asker's own screen is
     * deliberately indistinguishable, so typing guesses cannot be used to
     * find out who has an account here. A distinct answer would break that,
     * and would tell the blocked person - the one fact about a block that
     * is worth arguing over.
     */
    expect(route).toMatch(/if \(blockedBetween\(user\.id, target\.id\)\) return sent/)
  })

  /* And accepting a request that was sent before the block. */
  it('and accepting one that survived the block', () => {
    const route = slice(index, "app.post('/api/friends/accept'", '\napp.')
    expect(route).toContain('blockedBetween(user.id, userId)')
  })
})

describe('what the block does not do', () => {
  /*
   * It is not invisibility, and folding it into canSeeMember would make it
   * so. Being blocked does not take somebody out of a member list, off
   * their own messages, or out of a server you share - it stops one person
   * reaching another, which is a different question.
   */
  it('does not change who can see whom', () => {
    const db_ = read('db.ts')
    const visible = slice(db_, 'const VISIBLE_TO', '\n\n')
    expect(visible).not.toContain('blocks')
  })

  /*
   * And it is never announced. The usual pattern tells both sides that
   * something changed; doing that here would tell the blocked person, at
   * the moment it happened, by making their own friends list move.
   */
  it('and is never told to the person blocked', () => {
    const route = slice(index, "app.post('/api/blocks'", '\napp.')
    for (const push of route.matchAll(/pushToUsers\(\[([^\]]*)\]/g)) {
      expect(push[1], `told somebody else: ${push[0]}`).toBe('user.id')
    }
  })
})
