/**
 * `ready` carries who you talk to, not everybody you could ever see.
 *
 * The directory used to be visibleMembers - every account this person can see
 * anywhere - sent on every connect. That is the term that multiplies: fifty
 * servers of ten thousand people is half a million rows computed per
 * connection, before the app has drawn anything. Reconnects are constant, so
 * it is paid constantly.
 *
 * It is now yourself, your friends and everybody in your conversations, and a
 * server's people arrive when that server is opened - from a route the client
 * was already calling and already throwing the records away.
 *
 * The risk is not that somebody is missing. It is that somebody is missing
 * *and there is no way to get them*, which would be a name that never
 * resolves. So this checks both halves: they are not in `ready`, and the
 * request that fills them in works and is refused to anybody who should not
 * have it.
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
const ready = (token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') { ws.close(); resolve(m) }
  }
  setTimeout(() => reject(new Error('the gateway never said ready')), 15000)
})

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
const space = (await call('/api/spaces', { method: 'POST', body: JSON.stringify({ name: 'Test Server' }) }, host.token)).body.space
const code = (await call(`/api/spaces/${space.id}/invites`, { method: 'POST', body: '{}' }, host.token)).body.code

/* Several people in the server, none of them friends with the newcomer. */
const crowd = []
for (const name of ['baileyyy', 'keeko', 'cami', 'nipeno']) crowd.push(await reg(name, code))

/* Somebody who joins the server and knows nobody in it. */
const newcomer = await reg('newcomer', code)

console.log('  --- what the newcomer is handed on connect ---')

const first = await ready(newcomer.token)
const handed = (first.members ?? []).map((m) => m.id)
console.log(`      ready carried ${handed.length} member(s)`)

check('they are given themselves', handed.includes(newcomer.id), handed.length)
check('and not the four people in the server they have never spoken to',
  crowd.every((c) => !handed.includes(c.id)), handed.length)
check('so the directory is the people they talk to, not the server',
  handed.length === 1, handed.length)

console.log('  --- and the server they are in still answers for its people ---')

const asked = await call(`/api/spaces/${space.id}/members`, {}, newcomer.token)
const got = (asked.body?.members ?? [])
check('opening the server fills them in', asked.status === 200, asked.status)
check('and it is everybody, not just ids',
  got.length >= crowd.length + 2, got.length)
/*
 * Whole records. The client used to type this as `{ id }` and throw the rest
 * away, which is why the directory had to arrive complete - if this comes
 * back without names, nothing on screen can be labelled.
 */
const sample = got.find((m) => m.id === crowd[0].id)
check('with a name on each of them', typeof sample?.display_name === 'string', sample)
check('and a username', typeof sample?.username === 'string', sample)

console.log('  --- friends and conversations are handed over up front ---')

/* A friendship, which is one of the three ways to be visible. */
await call('/api/friends/request', { method: 'POST', body: JSON.stringify({ name: 'keeko' }) }, newcomer.token)
await call('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: newcomer.id }) }, crowd[1].token)

/* And a conversation, which is another. */
await call('/api/dms', { method: 'POST', body: JSON.stringify({ userId: crowd[2].id }) }, newcomer.token)

const second = await ready(newcomer.token)
const now = (second.members ?? []).map((m) => m.id)
console.log(`      ready now carries ${now.length} member(s)`)
check('a friend is there without opening anything', now.includes(crowd[1].id), now.length)
check('and somebody they have a conversation with', now.includes(crowd[2].id), now.length)
check('but still not the two they have never spoken to',
  !now.includes(crowd[0].id) && !now.includes(crowd[3].id), now.length)

console.log('  --- and the membership map is not pre-filled either ---')

/*
 * The one that nearly shipped.
 *
 * `ready` also carried a map of every server to the ids of everybody in it,
 * so the member column could be drawn without asking. It is the same
 * multiplication - every person in every server, on every connect, to draw
 * one column - and worse, the client gates its fetch on that map: with the
 * map pre-filled the request never fires, so the directory never gets filled
 * and every name stays unknown. Trimming `ready.members` alone would have
 * looked correct on the server and broken every name on screen.
 */
check('ready does not carry a map of who is in every server',
  second.spaceMembers === undefined, Object.keys(second).filter((k) => /member/i.test(k)))

console.log('  --- joining a server hands over its people, and only its people ---')

/*
 * The same eager list by another door. Somebody who joins is sent the people
 * they can now see, because their client connected before they joined and
 * `ready` only happens once. That used to be the whole directory, so joining
 * one server re-sent every person in every other one.
 */
const joiner = await reg('joiner', undefined)
const heard = await new Promise((resolve) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const heardSync = []
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: joiner.token }))
  ws.onmessage = async (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') {
      await call('/api/invites/' + code + '/accept', { method: 'POST' }, joiner.token)
      setTimeout(() => { ws.close(); resolve(heardSync) }, 1200)
      return
    }
    if (m.t === 'members-sync') heardSync.push(m)
  }
})
const sync = heard[0]
check('they are sent the people of the server they joined', !!sync, heard.length)
check('with names, so nobody renders as unknown',
  (sync?.members ?? []).every((m) => typeof m.display_name === 'string'), (sync?.members ?? []).length)
check('and it is that server, not every server they can see',
  (sync?.members ?? []).length <= crowd.length + 3, (sync?.members ?? []).length)

console.log('  --- and the fill-in is not a way around anything ---')

/* A server the newcomer is not in. */
const outsider = await reg('outsider', undefined)
const theirs = (await call('/api/spaces', {
  method: 'POST', body: JSON.stringify({ name: 'Private Place' }),
}, outsider.token)).body
const theirSpace = theirs?.space ?? theirs

const refused = await call(`/api/spaces/${theirSpace.id}/members`, {}, newcomer.token)
check('a server you are not in will not list its people', refused.status === 403, refused.status)

const anonymous = await call(`/api/spaces/${space.id}/members`, {})
check('and neither will one you are, without signing in', anonymous.status === 401, anonymous.status)

console.log(bad === 0 ? '\n  the directory arrives a server at a time' : `\n  ${bad} FAILED`)
process.exitCode = bad === 0 ? 0 : 1
