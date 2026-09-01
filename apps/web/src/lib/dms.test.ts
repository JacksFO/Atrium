import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { conversation, conversations, conversationWith } from './dms'
import { apply, emptyWorld, remember, type World } from './world'
import type { User } from './wire'

const user = (id: string, over: Partial<User> = {}): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})

function world(): World {
  const w = emptyWorld(user('me', { display_name: 'Me' }))
  remember(w, user('pat', { display_name: 'Pat' }))
  remember(w, user('sam', { display_name: 'Sam' }))
  return w
}

describe('a conversation with one person', () => {
  it('is named after them, not after itself', () => {
    const w = world()
    const c = conversation(w, {
      id: 'd1', name: 'stored name from ages ago',
      members: [{ user_id: 'me' }, { user_id: 'pat' }],
    })
    expect(c.name).toBe('Pat')
    expect(c.group).toBe(false)
    expect(c.peer?.id).toBe('pat')
  })

  it('never counts you among the people in it', () => {
    const w = world()
    const c = conversation(w, { id: 'd1', name: '', members: [{ user_id: 'me' }, { user_id: 'pat' }] })
    expect(c.others.map((u) => u.id)).toEqual(['pat'])
  })

  /*
   * And their own name, not a name some server gave them.
   *
   * This used to assert the opposite, because a nickname was one column on
   * the account and so was simply "what they are called" everywhere. Now it
   * is what one server calls them - and a conversation is nobody's server.
   * Being renamed in a place the other person has never heard of must not
   * change who they are talking to.
   */
  it('shows their own name, whatever a server they share calls them', () => {
    const w = world()
    remember(w, user('pat', { display_name: 'Pat' }))
    w.nicknames.set('sp', new Map([['pat', 'Patricia']]))
    const c = conversation(w, { id: 'd1', name: '', members: [{ user_id: 'me' }, { user_id: 'pat' }] })
    expect(c.name).toBe('Pat')
  })
})

describe('a group', () => {
  /* A group's stored name was fixed when it was made, and somebody leaving
     does not rename a row in a table. */
  it('is named after whoever is in it now', () => {
    const w = world()
    const c = conversation(w, {
      id: 'd2', name: 'old name',
      members: [{ user_id: 'me' }, { user_id: 'pat' }, { user_id: 'sam' }],
    })
    expect(c.group).toBe(true)
    expect(c.name).toBe('Pat, Sam')
    expect(c.peer).toBeNull()
  })
})

describe('somebody the app has never heard of', () => {
  /* You can talk to somebody you share no server with, and they are in no
     roster. They still have a name and there is somewhere to show it. */
  it('is Someone rather than nothing', () => {
    const w = world()
    const c = conversation(w, {
      id: 'd3', name: '', members: [{ user_id: 'me' }, { user_id: 'ghost' }],
    })
    expect(c.name).toBe('Someone')
    expect(c.peer?.id).toBe('ghost')
  })
})

describe('finding the one with a particular person', () => {
  it('finds it by who is in it, not by what it is called', () => {
    const w = world()
    w.dms = [
      { id: 'd1', name: '', members: [{ user_id: 'me' }, { user_id: 'pat' }] },
      { id: 'd2', name: '', members: [{ user_id: 'me' }, { user_id: 'pat' }, { user_id: 'sam' }] },
    ]
    expect(conversationWith(w, 'pat')?.id).toBe('d1')
    expect(conversationWith(w, 'nobody')).toBeNull()
  })

  it('and lists them all', () => {
    const w = world()
    w.dms = [{ id: 'd1', name: '', members: [{ user_id: 'me' }, { user_id: 'pat' }] }]
    expect(conversations(w).map((c) => c.name)).toEqual(['Pat'])
  })
})

/**
 * Newest first.
 *
 * The conversations came back in whatever order the server happened to store
 * them, so the one somebody had been talking in a minute ago could be
 * anywhere in the list — and the one at the top was usually the oldest.
 */
describe('the order conversations come in', () => {
  const w = () => {
    const x = emptyWorld(user('me'))
    x.dms = [
      { id: 'old', name: '', members: [{ user_id: 'me' }, { user_id: 'a' }] },
      { id: 'new', name: '', members: [{ user_id: 'me' }, { user_id: 'b' }] },
      { id: 'never', name: '', members: [{ user_id: 'me' }, { user_id: 'c' }] },
    ]
    return x
  }

  const said = (x: World, id: string, at: number) => {
    x.messages.set(id, [{
      id: `m-${id}`, channel_id: id, author_id: 'a', body: 'hi', created_at: at,
      edited_at: null, deleted_at: null, kind: 'text', reply_to: null,
      pinned_at: null, reactions: [], attachments: [],
    }])
  }

  it('puts the one last spoken in at the top', () => {
    const x = w()
    said(x, 'old', 1000)
    said(x, 'new', 9000)
    expect(conversations(x).map((c) => c.id)).toEqual(['new', 'old', 'never'])
  })

  /* One nothing is known about still ranks above the silent ones when
     something is waiting in it — that is a conversation with news. */
  it('and one with something waiting above the quiet ones', () => {
    const x = w()
    said(x, 'old', 1000)
    x.unread.set('never', 3)
    expect(conversations(x).map((c) => c.id)).toEqual(['old', 'never', 'new'])
  })

  /* Stable, so conversations nothing is known about keep the server's order
     rather than shuffling about on every render. */
  it('and leaves the rest in the order they arrived', () => {
    const x = w()
    expect(conversations(x).map((c) => c.id)).toEqual(['old', 'new', 'never'])
  })
})

/**
 * A message arriving lifts its conversation, opened or not.
 *
 * Messages are only kept for channels somebody has read — holding every
 * message of every conversation is how a client grows without bound — so a
 * conversation nobody has opened had nothing to be sorted by, and a message
 * arriving in one could not bring it to the top. That is most of them: the
 * list is longest for the people you talk to least.
 */
describe('a message arriving', () => {
  const w = () => {
    const x = emptyWorld(user('me'))
    x.dms = [
      { id: 'read', name: '', members: [{ user_id: 'me' }, { user_id: 'a' }] },
      { id: 'unopened', name: '', members: [{ user_id: 'me' }, { user_id: 'b' }] },
    ]
    x.messages.set('read', [{
      id: 'm0', channel_id: 'read', author_id: 'a', body: 'old', created_at: 1000,
      edited_at: null, deleted_at: null, kind: 'text', reply_to: null,
      pinned_at: null, reactions: [], attachments: [],
    }])
    x.lastAt.set('read', 1000)
    return x
  }

  const arrives = (x: World, channel: string, at: number) => apply(x, {
    t: 'message',
    message: {
      id: `m-${at}`, channel_id: channel, author_id: 'b', body: 'hi',
      created_at: at, edited_at: null, deleted_at: null, kind: 'text',
      reply_to: null, pinned_at: null, reactions: [], attachments: [],
    },
  } as never)

  it('lifts a conversation nothing has ever been read from', () => {
    const x = w()
    /* Below the read one to begin with. */
    expect(conversations(x).map((c) => c.id)).toEqual(['read', 'unopened'])
    arrives(x, 'unopened', 9000)
    expect(conversations(x).map((c) => c.id)).toEqual(['unopened', 'read'])
  })

  it('and lifts one that is open, too', () => {
    const x = w()
    arrives(x, 'unopened', 9000)
    arrives(x, 'read', 9500)
    expect(conversations(x).map((c) => c.id)).toEqual(['read', 'unopened'])
  })

  /* An older message arriving late does not pretend to be the newest. */
  it('but an older one does not move it', () => {
    const x = w()
    arrives(x, 'unopened', 9000)
    arrives(x, 'read', 5)
    expect(conversations(x).map((c) => c.id)).toEqual(['unopened', 'read'])
  })
})

/**
 * What sign-in fetches, and what it leaves until asked.
 *
 * Every member and every role assignment of every server used to be fetched
 * before the app would draw. One member is about 470 bytes of JSON, so a
 * server of ten thousand is four and a half megabytes, plus another two of
 * assignments — downloaded, parsed and held for a list nobody had opened, on
 * every sign-in. You only ever look at one server at a time.
 */
describe('what is loaded when', () => {
  const load = readFileSync(resolve(process.cwd(), 'src/lib/load.ts'), 'utf8')

  it('is your friends and your conversations, and nothing else', () => {
    const at = load.indexOf('export async function loadWorld')
    const body = load.slice(at, load.indexOf('\n}', at))
    expect(body).toContain('loadFriends')
    expect(body).toContain('loadDms')
    /* The two that grow with somebody else's server. */
    expect(body).not.toContain('loadMembers')
    expect(body).not.toContain('loadRoles')
  })

  it('and a server’s people come when that server is opened', () => {
    const at = load.indexOf('export async function loadSpace(')
    expect(at).toBeGreaterThan(0)
    const body = load.slice(at, load.indexOf('\n}', at))
    expect(body).toContain('loadMembers')
    expect(body).toContain('loadRoles')
  })

  /* Marked before the request, not after: opening the same server twice in
     quick succession is what changing channel inside it looks like. */
  it('and asks once however many times it is opened', () => {
    const at = load.indexOf('export async function loadSpace(')
    const body = load.slice(at, at + 500)
    const guard = body.indexOf('if (w.loaded.has(spaceId)) return')
    const mark = body.indexOf('w.loaded.add(spaceId)')
    const fetch = body.indexOf('loadMembers')
    expect(guard).toBeGreaterThan(-1)
    expect(mark).toBeGreaterThan(guard)
    expect(fetch).toBeGreaterThan(mark)
  })
})
