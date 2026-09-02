/**
 * Stopping somebody talking for a while.
 *
 * The middle option between a kick and a ban, and the one moderators actually
 * reach for: a kick ends the moment they click the invite again and a ban
 * does not end at all, so having only those two means every small argument is
 * answered with the largest tool there is.
 *
 * What this pins is that it is the *middle* one. They stay in the server,
 * keep their roles and can still read - the only thing they cannot do is
 * talk. A timeout that quietly removed somebody would be a kick with a
 * friendlier name, and nobody would notice until it mattered.
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

const gateway = (token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const errors = []
  const sent = []
  let ready = null
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') { ready = m; return resolve(api) }
    if (m.t === 'error' || m.t === 'send-refused') errors.push(m)
    if (m.t === 'ack') sent.push(m.message)
  }
  const api = {
    say: (channelId, body) => ws.send(JSON.stringify({
      t: 'send', channelId, body, nonce: 'to-' + Math.random().toString(36).slice(2),
    })),
    react: (messageId, emoji) => ws.send(JSON.stringify({ t: 'react', messageId, emoji })),
    errors: () => errors,
    landed: () => sent,
    channels: () => ready?.channels ?? [],
    forget: () => { errors.length = 0; sent.length = 0 },
    quit: () => ws.close(),
  }
  setTimeout(() => reject(new Error('the gateway never said ready')), 12000)
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const run = async () => {
  const owner = await reg('toowner')
  const space = (await call('/api/spaces', {
    method: 'POST', body: JSON.stringify({ name: 'Quiet' }),
  }, owner.token)).body?.space
  check('a server can be made', !!space?.id, space)

  const invite = (await call(`/api/spaces/${space.id}/invites`, {
    method: 'POST', body: '{}',
  }, owner.token)).body
  const loud = await reg('toloud', invite?.code)
  const bystander = await reg('tobystander', invite?.code)
  check('two others can join', !!loud.token && !!bystander.token)

  const asOwner = await gateway(owner.token)
  const channel = asOwner.channels().find((c) => c.kind === 'text')
  check('there is a channel', !!channel?.id, channel?.name)

  const asLoud = await gateway(loud.token)
  const asBystander = await gateway(bystander.token)

  /* They can talk before anything happens, or every check below passes for
     having done nothing. */
  asLoud.say(channel.id, 'before anything happened')
  await wait(1200)
  check('they can talk to begin with',
    asLoud.landed().length === 1 && asLoud.errors().length === 0,
    { landed: asLoud.landed().length, errors: asLoud.errors() })

  // --- timed out -----------------------------------------------------------
  const set = await call(`/api/admin/members/${loud.id}/timeout?spaceId=${space.id}`, {
    method: 'POST', body: JSON.stringify({ minutes: 10, reason: 'a rest' }),
  }, owner.token)
  check('a moderator can time somebody out', set.status === 200, set.body)

  /* Kept before the record is cleared: it is the only message that exists
     at this point, and it is what the reaction below is aimed at. */
  const alreadySaid = asLoud.landed()[0]
  asLoud.forget()
  asLoud.say(channel.id, 'during the timeout')
  await wait(1200)
  check('and they cannot talk', asLoud.landed().length === 0, asLoud.landed())
  const told = asLoud.errors()[0]
  console.log('      told:    ' + JSON.stringify(told?.detail))
  check('and are told why', /minute/.test(String(told?.detail ?? '')), told?.detail)

  /*
   * And not by reacting either.
   *
   * A reaction is a way of talking, and during the argument a timeout is for,
   * a row of clown faces is exactly what it was meant to stop. Silent rather
   * than refused, because a reaction has no acknowledgement: the client draws
   * nothing until the server says it happened.
   */
  const target = alreadySaid
  if (target && target.id) {
    asLoud.react(target.id, String.fromCodePoint(0x1F921))
    await wait(1300)
    const after = (await call('/api/channels/' + channel.id + '/messages', {}, owner.token)).body
    const one = (after && after.messages ? after.messages : []).find((m) => m.id === target.id)
    const reactions = (one && one.reactions) || []
    check('and they cannot react either', reactions.length === 0, reactions)
  } else {
    check('there was a message to try reacting to', false, target)
  }

  /* The whole point of it being the middle option. */
  const members = (await call(`/api/spaces/${space.id}/members`, {}, owner.token)).body
  const stillIn = (members?.members ?? []).some((m) => m.id === loud.id)
  check('but they are still in the server', stillIn === true, members?.members?.length)

  /* And everybody else carries on. A timeout is about one person. */
  asBystander.say(channel.id, 'somebody else, meanwhile')
  await wait(1200)
  check('and everybody else can still talk',
    asBystander.landed().length === 1 && asBystander.errors().length === 0,
    { landed: asBystander.landed().length, errors: asBystander.errors() })

  // --- and it can be lifted ------------------------------------------------
  const listed = await call(`/api/admin/timeouts?spaceId=${space.id}`, {}, owner.token)
  check('and it is on the list', (listed.body?.timeouts ?? []).length === 1, listed.body)

  const lifted = await call(`/api/admin/members/${loud.id}/timeout?spaceId=${space.id}`, {
    method: 'DELETE',
  }, owner.token)
  check('it can be lifted', lifted.status === 200, lifted.body)

  asLoud.forget()
  asLoud.say(channel.id, 'after it was lifted')
  await wait(1300)
  check('and then they can talk again',
    asLoud.landed().length === 1 && asLoud.errors().length === 0,
    { landed: asLoud.landed().length, errors: asLoud.errors() })

  // --- and it is not something anybody can do ------------------------------
  /*
   * The checks that keep it a moderator's tool. Somebody with no permission
   * cannot use it at all, and nobody can use it on the person who owns the
   * server - which is the shape every escalation takes.
   */
  const byNobody = await call(`/api/admin/members/${bystander.id}/timeout?spaceId=${space.id}`, {
    method: 'POST', body: JSON.stringify({ minutes: 5 }),
  }, loud.token)
  check('somebody without the permission cannot time anybody out',
    byNobody.status === 403 || byNobody.status === 404, byNobody.status)

  const onOwner = await call(`/api/admin/members/${owner.id}/timeout?spaceId=${space.id}`, {
    method: 'POST', body: JSON.stringify({ minutes: 5 }),
  }, owner.token)
  check('and nobody can time out the owner', onOwner.status >= 400, onOwner.status)

  const onSelf = await call(`/api/admin/members/${owner.id}/timeout?spaceId=${space.id}`, {
    method: 'POST', body: JSON.stringify({ minutes: 5 }),
  }, owner.token)
  check('nor themselves', onSelf.status >= 400, onSelf.status)

  const noMinutes = await call(`/api/admin/members/${loud.id}/timeout?spaceId=${space.id}`, {
    method: 'POST', body: JSON.stringify({ minutes: 'ages' }),
  }, owner.token)
  check('and a length that is not a number is refused', noMinutes.status === 400, noMinutes.status)

  asOwner.quit(); asLoud.quit(); asBystander.quit()
  console.log(bad === 0 ? '\n  all timeout checks passed' : `\n  ${bad} failed`)
  process.exit(bad === 0 ? 0 : 1)
}

run().catch((err) => { console.error(err); process.exit(1) })
