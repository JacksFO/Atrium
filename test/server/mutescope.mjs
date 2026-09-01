/**
 * A server mute belongs to the server it was applied in.
 *
 * It was keyed on the person alone - an in-memory Set of user ids, and a
 * table with user_id as its primary key - and it goes into the LiveKit token
 * as canPublish: false. So a moderator in one server silenced somebody in
 * every voice channel on the machine: in other people's servers, in servers
 * that moderator has nothing to do with, and in a server the muted person
 * owns. Reported as not making sense, which it does not.
 *
 * The token is the thing that matters. The UI is not the enforcement point,
 * so this asks for a real token in each server and reads the grant out of it
 * rather than believing a flag on a socket.
 *
 * Two servers, and the second one is not the first: the whole bug was
 * everything falling back to the original server, so a spec run entirely
 * inside it would prove nothing.
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

/** What a LiveKit token actually grants, read out of the token itself. */
const grantsOf = (jwt) => {
  const [, payload] = String(jwt).split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  return claims.video ?? {}
}

const socket = (token, onReady) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const errors = []
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'error') errors.push(m)
    if (m.t === 'ready') { if (onReady) onReady(ws, m); resolve(api) }
  }
  const api = {
    raw: () => ws,
    errors: () => errors.slice(),
    send: (frame) => ws.send(JSON.stringify(frame)),
    close: () => { try { ws.close() } catch { /* closed */ } },
  }
  setTimeout(() => reject(new Error('the gateway never said ready')), 15000)
})
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------------------------------------------------------- cast -- */

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
const first = (await call('/api/spaces', { method: 'POST', body: JSON.stringify({ name: 'Test Server' }) }, host.token)).body.space
const code = (await call(`/api/spaces/${first.id}/invites`, { method: 'POST', body: '{}' }, host.token)).body.code
const mate = await reg('baileyyy', code)

/* A second server, made by the other person, who owns it. */
const theirs = (await call('/api/spaces', {
  method: 'POST', body: JSON.stringify({ name: 'Their Place' }),
}, mate.token)).body
const theirSpace = theirs?.space ?? theirs
check('the other person can make a server of their own', !!theirSpace?.id, theirs)

const theirCode = (await call(`/api/spaces/${theirSpace.id}/invites`, { method: 'POST', body: '{}' }, mate.token)).body.code
await call('/api/invites/' + theirCode + '/accept', { method: 'POST' }, host.token).catch(() => {})

/* Made rather than found: channels arrive over the gateway, not from a route. */
const voiceIn = async (spaceId, token, name) => (await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name, kind: 'voice', spaceId }),
}, token)).body?.channel
const hostVoice = await voiceIn(first.id, host.token, 'the-booth')
const theirVoice = await voiceIn(theirSpace.id, mate.token, 'their-booth')
check('each server has a voice channel', !!hostVoice?.id && !!theirVoice?.id,
  { first: hostVoice?.id, second: theirVoice?.id })

/* --------------------------------------------------------------- before -- */

console.log('  --- before anybody is muted ---')

const firstBefore = await call('/api/voice/token', {
  method: 'POST', body: JSON.stringify({ channelId: hostVoice.id }),
}, mate.token)
check('they can speak in the first server', grantsOf(firstBefore.body?.token).canPublish === true,
  grantsOf(firstBefore.body?.token))

const theirsBefore = await call('/api/voice/token', {
  method: 'POST', body: JSON.stringify({ channelId: theirVoice.id }),
}, mate.token)
check('and in their own', grantsOf(theirsBefore.body?.token).canPublish === true,
  grantsOf(theirsBefore.body?.token))

/* ---------------------------------------------------------------- mute -- */

console.log('  --- muted in the first server ---')

/* They have to be sitting in the room for a mute to be applied at all. */
const asMate = await socket(mate.token, (ws) =>
  ws.send(JSON.stringify({ t: 'voice-join', channelId: hostVoice.id })))
await wait(600)

const asHost = await socket(host.token)
asHost.send({ t: 'voice-moderate', userId: mate.id, spaceId: first.id, serverMuted: true })
await wait(700)
check('the moderator was not refused', asHost.errors().length === 0, asHost.errors())

const firstAfter = await call('/api/voice/token', {
  method: 'POST', body: JSON.stringify({ channelId: hostVoice.id }),
}, mate.token)
check('the mute bites where it was applied',
  grantsOf(firstAfter.body?.token).canPublish === false, grantsOf(firstAfter.body?.token))

/*
 * The whole point. Their own server, which the moderator has no standing in
 * whatsoever, and where this person is the owner.
 */
const theirsAfter = await call('/api/voice/token', {
  method: 'POST', body: JSON.stringify({ channelId: theirVoice.id }),
}, mate.token)
check('and does not follow them into their own server',
  grantsOf(theirsAfter.body?.token).canPublish === true, grantsOf(theirsAfter.body?.token))

/* --------------------------------------------------------------- unmute -- */

console.log('  --- and lifting it ---')

asHost.send({ t: 'voice-moderate', userId: mate.id, spaceId: first.id, serverMuted: false })
await wait(700)
const lifted = await call('/api/voice/token', {
  method: 'POST', body: JSON.stringify({ channelId: hostVoice.id }),
}, mate.token)
check('they can speak again', grantsOf(lifted.body?.token).canPublish === true,
  grantsOf(lifted.body?.token))

console.log('  --- and nobody moderates a server they have no standing in ---')

/*
 * The other direction, which is what "belongs to a server" has to mean: the
 * owner of the first server holds every permission there and none at all in
 * somebody else's, so naming it should change nothing.
 */
asHost.send({ t: 'voice-moderate', userId: mate.id, spaceId: theirSpace.id, serverMuted: true })
await wait(700)
const stillFree = await call('/api/voice/token', {
  method: 'POST', body: JSON.stringify({ channelId: theirVoice.id }),
}, mate.token)
check('a mute claimed in somebody else\'s server does not take',
  grantsOf(stillFree.body?.token).canPublish === true, grantsOf(stillFree.body?.token))

asMate.close()
asHost.close()

console.log(bad === 0 ? '\n  a mute belongs to the server it was applied in' : `\n  ${bad} FAILED`)
process.exitCode = bad === 0 ? 0 : 1
