import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { db, blockUser } from './db.js'
import { unreadMentionChannels, recordMentions } from './mentions.js'

/**
 * How far a block reaches into what the app tells you.
 *
 * The first pass stopped a blocked person messaging, ringing and befriending
 * you, and hid what they said. It left the counting alone - so the badge on a
 * channel still counted messages the app then refused to show, and a mention
 * from them still put a dot on it. Opening the channel to find nothing but
 * collapsed stubs is the same annoyance as the notification that used to fire
 * for them, one size smaller.
 *
 * The mention one was worse than that: the live path already refused it, so
 * the dot was right until a reload and wrong afterwards. A rule that lapses
 * when you reconnect looks like the block itself lapsing.
 */

function user(): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
  return id
}

function channel(): string {
  const id = randomUUID()
  db.prepare("INSERT INTO channels (id, name, topic, kind, position, created_at) VALUES (?, 'c', '', 'text', 0, ?)")
    .run(id, Date.now())
  return id
}

function said(channelId: string, author: string): string {
  const id = randomUUID()
  db.prepare('INSERT INTO messages (id, channel_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, channelId, author, 'hello', Date.now())
  return id
}

describe('a mention from somebody blocked', () => {
  it('does not put a dot on the channel', () => {
    const me = user(), them = user()
    const where = channel()
    recordMentions(said(where, them), where, { named: [me], wideOnly: [] })

    /* The precondition, asserted rather than assumed: without the block it
       is there, so the test cannot pass because nothing was recorded. */
    expect(unreadMentionChannels(me)).toContain(where)

    blockUser(me, them)
    expect(unreadMentionChannels(me)).not.toContain(where)
  })

  /* And blocking one person does not lose somebody else's mention in the
     same channel - the clause is about the author, not the room. */
  it('while somebody else naming you in the same channel still does', () => {
    const me = user(), them = user(), sam = user()
    const where = channel()
    recordMentions(said(where, them), where, { named: [me], wideOnly: [] })
    recordMentions(said(where, sam), where, { named: [me], wideOnly: [] })

    blockUser(me, them)
    expect(unreadMentionChannels(me)).toContain(where)
  })
})

/**
 * And the counting, which is read from the gateway rather than exported.
 *
 * The query is a prepared statement inside the module, so this reads it out
 * of the source: what has to hold is that it asks about the author against
 * the blocks table, and that the viewer is the blocker rather than whoever
 * happens to be handy.
 */
const gateway = readFileSync(join(__dirname, 'gateway.ts'), 'utf8')
  .split('\r\n').join('\n')

/**
 * Source with the prose taken out.
 *
 * Every one of these checks is about what the code does, and the comments
 * next to it name the thing they are warning against - on purpose, so the
 * next person does not put it back. Reading a file as one string cannot tell
 * a warning from the thing it warns about, and four tests in this codebase
 * have now tripped over exactly that.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
}

describe('the unread count', () => {
  const query = (() => {
    const from = gateway.indexOf('const unreadCountMinusBlocked = db.prepare')
    expect(from).toBeGreaterThan(-1)
    return gateway.slice(from, gateway.indexOf('\n)', from))
  })()

  it('leaves out messages from somebody blocked', () => {
    expect(query).toContain('NOT EXISTS')
    expect(query).toContain('b.blocked_id = m.author_id')
  })

  /* The blocker is the person being counted for. Passing the author here
     would count nothing for anybody, and passing the wrong id would count
     somebody else's blocks - both of which look like a working feature. */
  it('and asks it as the person the count is for', () => {
    expect(query).toContain('b.blocker_id = ?')
    expect(gateway).toContain('unreadCountMinusBlocked.get(c.channelId, userId, since, userId)')
  })

  /*
   * And the plain count is still there, for everybody else.
   *
   * The clause costs 71% more on a channel of fifty thousand messages with
   * an empty blocks table - measured - on a query that runs once per channel
   * per connection. Folding it into one statement would charge every account
   * in the app for a question almost none of them are asking: 144ms of
   * blocked event loop at fifty channels and a hundred people reconnecting
   * together, bought for nothing.
   */
  it('and everybody else runs the count without it', () => {
    const bare = codeOnly(gateway)
    const plain = bare.slice(
      bare.indexOf('const unreadCount = db.prepare'),
      bare.indexOf('const unreadCountMinusBlocked'),
    )
    expect(plain).toContain('SELECT COUNT(*)')
    expect(plain).not.toContain('NOT EXISTS')
    expect(gateway).toContain('unreadCount.get(c.channelId, userId, since)')
  })

  /* Decided once for the whole sweep, not per channel: the probe is cheap
     and asking it fifty times would put back what this is avoiding. */
  it('and which to run is decided once per connection', () => {
    const fn = gateway.slice(gateway.indexOf('function unreadFor('))
    expect(fn.slice(0, 900)).toContain('const any = Boolean(hasBlockedAnybody.get(userId))')
    expect(fn.split('hasBlockedAnybody.get').length - 1).toBe(1)
  })
})

/**
 * What a conversation costs to send into.
 *
 * The block check needs to know who is in the conversation, and so does the
 * check above it - and they asked separately, which is a second query per
 * message on the hot path for an answer that cannot have changed in between.
 * Measured on this machine: 44.5us a message, against 68us for the block
 * check itself. Two thirds of what the block cost was asking twice.
 */
describe('the message-send path', () => {
  const send = (() => {
    const from = gateway.indexOf("case 'send': {")
    const to = gateway.indexOf("\n        case '", from + 10)
    return gateway.slice(from, to)
  })()

  it('asks who is in the conversation exactly once', () => {
    expect(send.split('dmMembers(').length - 1).toBe(1)
  })

  it('and both checks read that one answer', () => {
    expect(send).toContain('const talking = isDirect(channelId) ? dmMembers(channelId) : null')
    expect(send).toContain('talking && !talking.includes(client.user.id)')
    expect(send).toContain('talking.filter((id) => id !== me)')
  })
})

/**
 * And what the block list hands back.
 *
 * It answered with the whole public record - presence, status, bio, banner -
 * on a route that skips the visibility rule on purpose. Which makes it a
 * standing feed on somebody you have cut off: block them, leave the server
 * you shared, and it still says whether they are online right now, for ever.
 *
 * The reason for skipping the rule is only "know which row to lift", and a
 * name and a face are the whole of that.
 */
const index = readFileSync(join(__dirname, 'index.ts'), 'utf8').split('\r\n').join('\n')

describe('the list of people you have blocked', () => {
  const route = (() => {
    const from = index.indexOf("app.get('/api/blocks'")
    expect(from).toBeGreaterThan(-1)
    return index.slice(from, index.indexOf('\napp.', from + 10))
  })()

  it('names them without saying what they are doing', () => {
    expect(route).toContain('SELECT id, username, discriminator, display_name, avatar_path')
    expect(route).not.toContain('PUBLIC_USER_COLUMNS')
  })

  /*
   * Named, because those are the fields that made it a feed rather than a
   * list - and the ones somebody would reach for again by habit.
   *
   * Comments stripped first. The paragraph above the query lists exactly
   * those fields, to say why they went; reading the route as one string
   * cannot tell that warning apart from the thing it warns about, and this
   * is the third test in this codebase to trip over its own explanation.
   */
  const code = route
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

  it('and carries nothing live', () => {
    for (const field of ['presence', 'status_text', 'status_until', 'bio', 'banner_path']) {
      expect(code, `still sends ${field}`).not.toContain(field)
    }
    /* And the reason it does not is still written down beside it. */
    expect(route).toMatch(/presence/)
  })
})

/**
 * And the routes that turn one request into a message for everybody.
 *
 * Banning somebody writes a row, drops a socket and sends a frame to every
 * member of the server; renaming somebody sends one to every member too. At
 * a hundred members that is a hundred frames a request, and nothing stopped
 * a moderator - or a stolen moderator's session - looping either.
 */
const admin = readFileSync(join(__dirname, 'routes', 'admin.ts'), 'utf8')
  .split('\r\n').join('\n')

describe('the routes that reach everybody at once', () => {
  const route = (opener: string) => {
    const from = admin.indexOf(opener)
    expect(from, `${opener} exists`).toBeGreaterThan(-1)
    return admin.slice(from, admin.indexOf('\n  app.', from + 10))
  }

  it('are all budgeted', () => {
    expect(route("app.post('/api/admin/members/:id/ban'")).toContain('allow(`ban:${user.id}`')
    expect(route("app.delete('/api/admin/bans/:id'")).toContain('allow(`ban:${user.id}`')
    expect(route("app.post('/api/admin/members/:id/nickname'")).toContain('allow(`nickname:${user.id}`')
  })

  /*
   * And a nickname is for somebody who is here.
   *
   * It checked that the account existed and that you outrank them, and not
   * that they are in the server - so a name could be written for a
   * non-member and sit in the table until the day they joined, arriving
   * under a name a stranger picked.
   */
  it('and a nickname is only set for a member', () => {
    expect(route("app.post('/api/admin/members/:id/nickname'"))
      .toContain('isSpaceMember(id, forSpace)')
  })
})
