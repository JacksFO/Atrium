/**
 * Slow mode, over the wire.
 *
 * The rule itself is a pure function with its own tests. What this is for is
 * everything around it: that the channel keeps the setting, that a second
 * message is actually refused rather than merely discouraged, that the person
 * is told how long, that somebody who moderates the channel is not caught by
 * it, and that one person waiting does not hold up anybody else.
 *
 * The last of those is the one worth having. A gap between everybody's
 * messages is not slow mode - it is one queue for the room, and it is the
 * shape this would take if the query asked for the channel's last message
 * instead of the sender's.
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

/**
 * A socket that stays open, so several messages can be sent down one and the
 * refusals can be heard. A refusal arrives as an error frame rather than as
 * anything on the message that was refused.
 */
const gateway = (token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const errors = []
  const sent = []
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') return resolve(api)
    /* A refusal arrives as send-refused when the message carried a nonce,
       which every message from this client does - and as a plain error
       otherwise. Both are this connection being told no. */
    if (m.t === 'error' || m.t === 'send-refused') errors.push(m)
    /* Only this connection's own messages. A `message` frame arrives for
       everybody's, so counting those counts the room rather than the
       sender - and every check below is about one person's messages. */
    if (m.t === 'ack') sent.push(m.message)
  }
  const api = {
    say: (channelId, body) => ws.send(JSON.stringify({
      t: 'send', channelId, body, nonce: 'sm-' + Math.random().toString(36).slice(2),
    })),
    errors: () => errors,
    landed: () => sent,
    forget: () => { errors.length = 0; sent.length = 0 },
    quit: () => ws.close(),
  }
  setTimeout(() => reject(new Error('the gateway never said ready')), 12000)
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const run = async () => {
  const owner = await reg('smowner')
  const space = (await call('/api/spaces', {
    method: 'POST', body: JSON.stringify({ name: 'Slow' }),
  }, owner.token)).body?.space
  check('a server can be made', !!space?.id, space)

  const invite = (await call(`/api/spaces/${space.id}/invites`, {
    method: 'POST', body: '{}',
  }, owner.token)).body
  const talker = await reg('smtalker', invite?.code)
  const other = await reg('smother', invite?.code)
  check('two other people can join', !!talker.token && !!other.token)

  const channel = (await call('/api/channels', {
    method: 'POST', body: JSON.stringify({ name: 'slowly', kind: 'text', spaceId: space.id }),
  }, owner.token)).body?.channel
  check('a channel can be made', !!channel?.id, channel)

  // --- setting it ---------------------------------------------------------
  const set = await call(`/api/channels/${channel.id}`, {
    method: 'PATCH', body: JSON.stringify({ slowmodeSeconds: 5 }),
  }, owner.token)
  check('slow mode can be set', set.status === 200, set.status)

  /* And it stays set when something else about the channel is changed - every
     other field here leaves the rest alone, and this must too. */
  await call(`/api/channels/${channel.id}`, {
    method: 'PATCH', body: JSON.stringify({ topic: 'a quiet room' }),
  }, owner.token)

  const talking = await gateway(talker.token)
  const others = await gateway(other.token)
  const asOwner = await gateway(owner.token)

  // --- the first goes, the second does not --------------------------------
  talking.say(channel.id, 'the first one')
  await wait(1200)
  check('the first message goes', talking.landed().length === 1, talking.landed().length)
  check('and nothing was refused', talking.errors().length === 0, talking.errors())

  talking.say(channel.id, 'the second one, too soon')
  await wait(1200)
  check('the second is refused', talking.landed().length === 1, talking.landed().length)
  const why = talking.errors()[0]
  console.log('      told:    ' + JSON.stringify(why?.detail))
  check('and says so', !!why, why)
  /* With the number in it. "Wait" on its own is a broken app. */
  check('and says how long', /\d+\s*second/.test(String(why?.detail ?? '')), why?.detail)

  // --- and one person waiting does not hold up anybody else ---------------
  /*
   * The one that matters. A gap between everybody's messages is not slow
   * mode; it is one queue for the room, and it is the shape this takes if the
   * query asks for the channel's last message rather than the sender's.
   */
  others.say(channel.id, 'somebody else entirely')
  await wait(1200)
  check('somebody else is not held up by their wait',
    others.landed().length === 1 && others.errors().length === 0,
    { landed: others.landed().length, errors: others.errors() })

  // --- and the people who moderate it are not caught by it ----------------
  /*
   * Being told to slow down while trying to calm a channel is the opposite of
   * what this is for, and every app with this exempts them - so somebody who
   * has used one of those will expect it and will not think to check.
   */
  asOwner.say(channel.id, 'owner, once')
  await wait(900)
  asOwner.say(channel.id, 'owner, again straight after')
  await wait(1200)
  check('somebody who manages the channel is exempt',
    asOwner.landed().length === 2 && asOwner.errors().length === 0,
    { landed: asOwner.landed().length, errors: asOwner.errors() })

  // --- and it lets go once the wait is up ---------------------------------
  talking.forget()
  await wait(4500)
  talking.say(channel.id, 'and now the wait is over')
  await wait(1400)
  check('and the wait ends',
    talking.landed().length === 1 && talking.errors().length === 0,
    { landed: talking.landed().length, errors: talking.errors() })

  // --- and turning it off turns it off -------------------------------------
  await call(`/api/channels/${channel.id}`, {
    method: 'PATCH', body: JSON.stringify({ slowmodeSeconds: 0 }),
  }, owner.token)
  talking.forget()
  talking.say(channel.id, 'one')
  await wait(700)
  talking.say(channel.id, 'two straight after')
  await wait(1400)
  check('and it can be turned off again',
    talking.landed().length === 2 && talking.errors().length === 0,
    { landed: talking.landed().length, errors: talking.errors() })

  talking.quit(); others.quit(); asOwner.quit()
  console.log(bad === 0 ? '\n  all slow mode checks passed' : `\n  ${bad} failed`)
  process.exit(bad === 0 ? 0 : 1)
}

run().catch((err) => { console.error(err); process.exit(1) })
