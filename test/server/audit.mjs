/**
 * The findings of a full read of the server, each made to prove itself.
 *
 * Everything here started as "that looks wrong" while reading, and is written
 * as the smallest request that shows whether it is. A suspicion that turns
 * out to be unfounded stays as a passing check rather than being deleted -
 * the next edit can make it true, and a check that has never failed is still
 * the cheapest way to find that out.
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
const reg = async (username, invite, displayName) => {
  const b = (await call('/api/register', {
    method: 'POST',
    body: JSON.stringify({
      username, password: 'password123', displayName: displayName ?? username, invite,
    }),
  })).body
  return { token: b?.token, id: b?.user?.id, user: b?.user }
}

const socket = (token, work) => new Promise((done) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const seen = []
  let ready = 0
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    seen.push(m)
    if (m.t === 'ready') {
      ready += 1
      if (ready === 1) work(ws)
    }
  }
  setTimeout(() => { try { ws.close() } catch { /* closed */ } ; done({ seen, ready }) }, 3500)
})

const host = await reg('JacksFO')
/*
 * Made here, because signing up does not come with one.
 *
 * This read spaces[0] after registering, back when the first account claimed
 * the install and was put into a server the seed had made. Nobody claims
 * anything now and nobody is given a server - everybody makes their own - so
 * spaces[0] was undefined and every suite died on the line after it, before
 * touching what it meant to test.
 */
const space = (await call('/api/spaces', { method: 'POST', body: JSON.stringify({ name: 'Test Server' }) }, host.token)).body.space
const code = (await call(`/api/spaces/${space.id}/invites`, { method: 'POST', body: '{}' }, host.token)).body.code
const mate = await reg('baileyyy', code)

const channels = await new Promise((done) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: host.token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') { ws.close(); done(m.channels) }
  }
})
const general = channels.find((c) => c.kind === 'text')

/*
 * More than the ceiling, so the ceiling can be seen to hold.
 *
 * The first version of this wrote twelve and then checked that an unbounded
 * request did not return "everything" - which it could not tell, because
 * twelve is what both the bug and the fix return. A cap of 200 is only
 * measurable against a channel holding more than 200.
 */
const WROTE = 240
for (const from of [0, 120]) {
  await socket(host.token, (ws) => {
    for (let i = from; i < from + 120; i++) {
      ws.send(JSON.stringify({ t: 'send', channelId: general.id, body: `line ${i}`, nonce: `n${i}` }))
    }
  })
}

console.log('  --- how many messages one request may ask for ---')

const sane = await call(`/api/channels/${general.id}/messages?limit=5`, {}, host.token)
check('a sane limit is honoured', (sane.body?.messages ?? []).length === 5, sane.body?.messages?.length)

/*
 * SQLite reads LIMIT -1 as "no limit", and Number('x') is NaN which binds as
 * null - which it also reads as no limit. So the ceiling of 200 was only ever
 * a ceiling for callers who were already being reasonable.
 */
const stored = await call(`/api/channels/${general.id}/messages?limit=200`, {}, host.token)
check('the channel really does hold more than the ceiling',
  (stored.body?.messages ?? []).length === 200, stored.body?.messages?.length)

const negative = await call(`/api/channels/${general.id}/messages?limit=-1`, {}, host.token)
check('a negative limit does not become "everything"',
  (negative.body?.messages ?? []).length <= 200 && negative.status === 200,
  { count: negative.body?.messages?.length, status: negative.status })

const nonsense = await call(`/api/channels/${general.id}/messages?limit=abc`, {}, host.token)
check('a limit that is not a number falls back to the default',
  nonsense.status === 200
  && (nonsense.body?.messages ?? []).length > 0
  && (nonsense.body?.messages ?? []).length <= 200,
  { count: nonsense.body?.messages?.length, status: nonsense.status, err: nonsense.body?.error })

const huge = await call(`/api/channels/${general.id}/messages?limit=99999`, {}, host.token)
check('and a huge one is still capped',
  (huge.body?.messages ?? []).length <= 200, huge.body?.messages?.length)
void WROTE

console.log('  --- a display name is bounded wherever it is set ---')

/*
 * PATCH /api/me cuts every one of these to 500 characters. Registration went
 * straight to createUser, so the only ceiling was the 1MB body limit - and
 * the member list carries this to everybody on every connection.
 */
const long = 'x'.repeat(4000)
const bigName = await reg('longname', code, long)
check('registering with a 4000-character display name is bounded',
  (bigName.user?.display_name ?? '').length <= 500, (bigName.user?.display_name ?? '').length)

const viaPatch = await call('/api/me', {
  method: 'PATCH', body: JSON.stringify({ display_name: long }),
}, mate.token)
check('and so is setting one afterwards',
  (viaPatch.body?.user?.display_name ?? '').length <= 500,
  (viaPatch.body?.user?.display_name ?? '').length)

console.log('  --- presence is one of the words the app knows ---')

const madeUp = await call('/api/me', {
  method: 'PATCH', body: JSON.stringify({ presence: 'definitely-not-a-presence' }),
}, mate.token)
check('an invented presence is refused rather than stored',
  madeUp.status === 400 || madeUp.body?.user?.presence !== 'definitely-not-a-presence',
  madeUp.body?.user?.presence ?? madeUp.status)

console.log('  --- one socket is one client ---')

/*
 * The hello handler assigned a fresh Client and added it to the set without
 * checking whether this socket already had one. A second hello therefore left
 * the first entry in the set for ever, pointing at the same socket - so every
 * broadcast went to that socket twice, and the heartbeat, which only ever
 * marks the newest entry alive, terminated the live connection about a minute
 * later.
 */
const twice = await socket(host.token, (ws) => {
  ws.send(JSON.stringify({ t: 'hello', token: host.token }))
  setTimeout(() => ws.send(JSON.stringify({
    t: 'send', channelId: general.id, body: 'once please', nonce: 'dup-check',
  })), 400)
})
const acks = twice.seen.filter((m) => m.t === 'ack' && m.nonce === 'dup-check')
const readies = twice.seen.filter((m) => m.t === 'ready')
check('a second hello does not open a second client on one socket',
  readies.length === 1, { readies: readies.length })
check('and a message sent afterwards is acknowledged once',
  acks.length === 1, { acks: acks.length })

console.log('  --- a stranger is not told who else is here ---')

/*
 * /api/members is careful: it answers with visibleMembers, so somebody who
 * shares no server, no friendship and no conversation with you is not told
 * you exist. Four gateway pushes were not careful, and they carry the same
 * object the route withholds - a nickname change, an avatar upload, an avatar
 * chosen from a GIF, and clearing one - all went through pushToAll.
 */
const stranger = await reg('driveby')
check('a stranger can make an account here', Boolean(stranger.token), stranger.token ? 'yes' : 'no')

const listed = await call('/api/members', {}, stranger.token)
const names = (listed.body?.members ?? []).map((m) => m.username)
check('and the member list does not name the host to them',
  !names.includes('JacksFO'), names)

const watching = await new Promise((done) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const seen = []
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: stranger.token }))
  ws.onmessage = async (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') {
      // Four things the host can do to their own profile, and one done to
      // somebody else's - none of which is this stranger's business.
      await call('/api/me/avatar', { method: 'DELETE' }, host.token)
      await call('/api/me/banner', { method: 'DELETE' }, host.token)
      await call(`/api/admin/members/${mate.id}/nickname?spaceId=${space.id}`, {
        method: 'POST', body: JSON.stringify({ nickname: 'Bee' }),
      }, host.token)
      setTimeout(() => { try { ws.close() } catch { /* closed */ } ; done(seen) }, 900)
      return
    }
    seen.push(m)
  }
  setTimeout(() => { try { ws.close() } catch { /* closed */ } ; done(seen) }, 9000)
})

const about = watching.filter((m) => m.t === 'member-update')
check('nor does the gateway push them anybody profile',
  about.length === 0, about.map((m) => m.user?.username))

console.log('  --- a colour is a colour wherever it is set ---')

/*
 * PATCH /api/roles/:id refuses anything but a six-digit hex and says so:
 * "only a hex literal ever reaches the stylesheet". POST /api/roles took
 * whatever it was handed - so the invariant held everywhere except the one
 * moment a colour is actually chosen.
 */
const badNew = await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'painted', colour: 'red; content: x', spaceId: space.id }),
}, host.token)
check('a role cannot be created with a colour that is not one',
  badNew.status === 400, badNew.status)

const goodNew = await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'proper', colour: '#4C8DFF', spaceId: space.id }),
}, host.token)
check('and a real one still works', goodNew.status === 200, goodNew.status)

console.log('  --- an invite code is worth guessing at ---')

/*
 * Four bytes is 32 bits. Nothing here is brute-forceable over HTTP at any
 * plausible rate, but the lookup has no budget of its own, and the code is
 * the whole credential for joining a server.
 */
const madeCode = (await call(`/api/spaces/${space.id}/invites`, {
  method: 'POST', body: '{}',
}, host.token)).body.code
check('an invite code carries at least 8 bytes of randomness',
  (madeCode ?? '').replace(/^jc-/, '').length >= 16, madeCode)

console.log(bad === 0 ? '\n  all good' : `\n  ${bad} FAILED`)
process.exitCode = bad === 0 ? 0 : 1
