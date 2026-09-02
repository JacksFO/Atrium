/**
 * Searching by who said it, where, when, and what it carried.
 *
 * The search box took a bare string, so the only question it could answer was
 * "which messages contain this word". The question people actually have is
 * "that thing Bailey posted in general last week", which is three constraints
 * and often no words at all.
 *
 * Against a real database rather than the parser, because everything that can
 * go wrong here is in the SQL: a filter that widens the search instead of
 * narrowing it, a filter-only search that matches everything, or - the one
 * that would matter - a filter that reaches into a channel the searcher
 * cannot see. The parser has its own tests and knows nothing about people.
 */
const BASE = process.env.BASE

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}
const call = async (path, opts = {}, token) => {
  const headers = { ...(token ? { authorization: 'Bearer ' + token } : {}) }
  if (opts.body) headers['content-type'] = 'application/json'
  const r = await fetch(BASE + path, { ...opts, headers })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const reg = async (username, invite) => {
  const b = (await call('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'password123', displayName: username, invite }),
  })).body
  return { token: b?.token, id: b?.user?.id, username }
}

/** What the gateway says on connecting - channels live here, not on a route. */
const ready = (token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') { ws.close(); resolve(m) }
  }
  setTimeout(() => { ws.close(); reject(new Error('the gateway never said ready')) }, 10000)
})

/** Say something, over the socket, and wait for it to land. */
const say = (token, channelId, body) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') {
      ws.send(JSON.stringify({
        t: 'send', channelId, body, nonce: 'sf-' + Math.random().toString(36).slice(2),
      }))
    }
    /* The sender's own copy comes back as an ack rather than a message -
       both carry the row, and waiting only for 'message' waits forever. */
    if ((m.t === 'message' || m.t === 'ack') && m.message?.body === body) {
      ws.close(); resolve(m.message)
    }
  }
  setTimeout(() => { ws.close(); reject(new Error('the message never came back')) }, 10000)
})

const search = async (q, token) =>
  (await call('/api/search?q=' + encodeURIComponent(q), {}, token)).body?.results ?? []
const bodies = (rows) => rows.map((r) => r.body).sort()

const run = async () => {
  const owner = await reg('sfowner')
  check('an account can be made', !!owner.token)

  /* A server of our own. Registering does not make one - the first account
     used to claim a server that already existed, and nothing has since. */
  const space = (await call('/api/spaces', {
    method: 'POST', body: JSON.stringify({ name: 'Marmalade' }),
  }, owner.token)).body?.space
  check('a server can be made', !!space?.id, space)

  const invite = (await call(`/api/spaces/${space.id}/invites`, {
    method: 'POST', body: '{}',
  }, owner.token)).body
  const friend = await reg('sfbailey', invite?.code)
  check('and somebody else can join', !!friend.token, invite?.code)

  /* A second one, so `in:` has something to exclude - a new server comes with
     one text channel and a filter that cannot leave anything out proves
     nothing. */
  await call('/api/channels', {
    method: 'POST',
    body: JSON.stringify({ name: 'elsewhere', kind: 'text', spaceId: space.id }),
  }, owner.token)

  const channels = (await ready(owner.token)).channels ?? []
  const text = channels.filter((c) => c.kind === 'text')
  check('there are two text channels to tell apart', text.length >= 2, text.map((c) => c.name))
  const [first, second] = text

  /* One phrase in both channels and from both people, so every filter below
     has something it must exclude as well as something it must find. */
  await say(owner.token, first.id, 'the marmalade recipe')
  await say(friend.token, first.id, 'the marmalade cupboard')
  await say(owner.token, second.id, 'the marmalade elsewhere')

  const all = await search('marmalade', owner.token)
  check('a plain search still finds everything', all.length === 3, bodies(all))

  // --- who said it ------------------------------------------------------
  const fromFriend = await search('from:sfbailey marmalade', owner.token)
  check('from: narrows to one person',
    bodies(fromFriend).join() === 'the marmalade cupboard', bodies(fromFriend))

  /* A name nothing answers to finds nothing, rather than quietly becoming no
     filter at all - a typo must narrow, never widen. */
  const nobody = await search('from:nobodyatall marmalade', owner.token)
  check('and a name nobody has finds nothing', nobody.length === 0, bodies(nobody))

  // --- where it was said ------------------------------------------------
  const inFirst = await search(`in:${first.name} marmalade`, owner.token)
  check('in: narrows to one channel', inFirst.length === 2, bodies(inFirst))

  const hashed = await search(`in:#${first.name} marmalade`, owner.token)
  check('and the hash is optional', hashed.length === 2, bodies(hashed))

  // --- both at once -----------------------------------------------------
  const both = await search(`from:sfbailey in:${first.name} marmalade`, owner.token)
  check('two filters narrow together',
    bodies(both).join() === 'the marmalade cupboard', bodies(both))

  // --- with no words at all ---------------------------------------------
  /*
   * The search that could not be asked before. There is nothing to match on,
   * so this must not go near the full-text index and must not answer with
   * everything ever said.
   */
  const wordless = await search(`in:${second.name}`, owner.token)
  check('a search of nothing but filters works',
    bodies(wordless).join() === 'the marmalade elsewhere', bodies(wordless))

  // --- when ---------------------------------------------------------------
  const today = new Date()
  const asDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

  const since = await search(`after:${asDay(yesterday)} marmalade`, owner.token)
  check('after: keeps what was said since', since.length === 3, since.length)

  const until = await search(`before:${asDay(tomorrow)} marmalade`, owner.token)
  check('before: keeps what was said up to then', until.length === 3, until.length)

  const none = await search(`before:${asDay(yesterday)} marmalade`, owner.token)
  check('and excludes what came after it', none.length === 0, none.length)

  // --- what it carried ----------------------------------------------------
  await say(owner.token, first.id, 'look at https://example.com/thing')
  const links = await search('has:link', owner.token)
  check('has:link finds a message with an address in it',
    links.some((r) => r.body.includes('example.com')), links.length)
  check('and not one without', !links.some((r) => r.body === 'the marmalade recipe'), links.length)

  const pictures = await search('has:image', owner.token)
  check('has:image finds nothing when nobody sent one', pictures.length === 0, pictures.length)

  // --- and it cannot reach past what you can see --------------------------
  /*
   * The one that would matter. A filter is a way of asking for rows, and a
   * search box is the easiest place in an app to hand back something that was
   * deliberately withheld - so the person who is not in the conversation must
   * not find it however precisely they ask.
   */
  const stranger = await reg('sfstranger', invite?.code)
  const dm = (await call('/api/dms', {
    method: 'POST', body: JSON.stringify({ userId: friend.id }),
  }, owner.token)).body
  if (dm?.channel?.id) {
    await say(owner.token, dm.channel.id, 'the marmalade secret')
    const mine = await search('marmalade secret', owner.token)
    check('a conversation is searchable by the people in it',
      mine.some((r) => r.body === 'the marmalade secret'), bodies(mine))

    const theirs = await search('from:sfowner marmalade secret', stranger.token)
    check('and not by somebody outside it, however they ask',
      !theirs.some((r) => r.body === 'the marmalade secret'), bodies(theirs))
  } else {
    check('a conversation could be made to test reach', false, dm)
  }

  console.log(bad === 0 ? '\n  all search filter checks passed' : `\n  ${bad} failed`)
  process.exit(bad === 0 ? 0 : 1)
}

run().catch((err) => { console.error(err); process.exit(1) })
