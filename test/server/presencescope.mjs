/**
 * Who is online is only ever answered about people you share something with.
 *
 * The gateway used to hand every client the ids of every connected account on
 * the machine, and announce every connect and disconnect to all of them. Names
 * were safe - the member list has been scoped for a while - but the ids were
 * not, so somebody who signed up a second ago got a live roster of everyone
 * using the app, and anything polling it learned when each of those accounts
 * was awake. A behavioural record of strangers, which is the exact thing the
 * member list was scoped to prevent, arriving through a different door.
 *
 * Three ways to be visible, and this checks all three plus the absence:
 * a server in common, a friendship, a conversation, and a stranger who has
 * none of them.
 *
 * The stranger is the point. A spec that only proves friends can see each
 * other passes just as well on a gateway that tells everybody everything.
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

/** A socket that keeps what it was told, so it can be asked afterwards. */
const socket = (token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const presence = []
  let ready = null
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready' && !ready) { ready = m; return resolve(api) }
    if (m.t === 'presence') presence.push(m)
  }
  const api = {
    online: () => ready?.online ?? [],
    /** Presence events heard since connecting. */
    heard: () => presence.slice(),
    forget: () => { presence.length = 0 },
    close: () => { try { ws.close() } catch { /* already closed */ } },
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
const space = (await call('/api/spaces', { method: 'POST', body: JSON.stringify({ name: 'Test Server' }) }, host.token)).body.space
const code = (await call(`/api/spaces/${space.id}/invites`, { method: 'POST', body: '{}' }, host.token)).body.code

// In the server with the host.
const mate = await reg('baileyyy', code)
// Nothing in common with anybody: no invite, no friends, no conversation.
const stranger = await reg('stranger', undefined)
check('a stranger can sign up with no invite at all', !!stranger.token, {
  id: stranger.id ? 'made' : 'refused',
})

console.log('  --- what each of them is told is online ---')

const asHost = await socket(host.token)
const asMate = await socket(mate.token)
const asStranger = await socket(stranger.token)
await wait(400)

/*
 * A fresh socket for the host's snapshot.
 *
 * `ready.online` is what was true at the moment of connecting, and the host
 * connected first - so the original socket's list cannot contain anybody who
 * arrived afterwards, whatever the scoping does. Asking again once everyone is
 * here is the difference between testing the rule and testing the order.
 */
const asHostNow = await socket(host.token)
await wait(300)
const hostSees = asHostNow.online()
const mateSees = asMate.online()
const strangerSees = asStranger.online()
console.log(`      host sees ${hostSees.length}, mate sees ${mateSees.length}, stranger sees ${strangerSees.length}`)

/*
 * The precondition. If the host could not see the person in their own server
 * the checks below would pass on a gateway that reports nothing to anybody.
 */
check('the host is told about the person in their server',
  hostSees.includes(mate.id), hostSees)
check('and about themselves', hostSees.includes(host.id), hostSees)

check('the stranger is not told the host is online',
  !strangerSees.includes(host.id), strangerSees)
check('nor the other member', !strangerSees.includes(mate.id), strangerSees)
check('and is told about nobody but themselves',
  strangerSees.every((id) => id === stranger.id), strangerSees)

check('and the host is not told about the stranger either',
  !hostSees.includes(stranger.id), hostSees)

console.log('  --- and when somebody arrives ---')

asHost.forget()
asStranger.forget()

const late = await reg('latecomer', code)
const asLate = await socket(late.token)
await wait(600)

const hostHeard = asHost.heard().filter((p) => p.userId === late.id)
const strangerHeard = asStranger.heard().filter((p) => p.userId === late.id)
check('the host hears somebody joining their server come online',
  hostHeard.length > 0 && hostHeard[0].online === true, hostHeard)
check('the stranger hears nothing about them', strangerHeard.length === 0, strangerHeard)

console.log('  --- and when they leave ---')

asHost.forget()
asStranger.forget()
asLate.close()
await wait(900)

const goneHost = asHost.heard().filter((p) => p.userId === late.id && p.online === false)
const goneStranger = asStranger.heard().filter((p) => p.userId === late.id)
check('the host is told they went offline', goneHost.length > 0, goneHost)
check('the stranger is told nothing at all', goneStranger.length === 0, goneStranger)

console.log('  --- a friendship is enough on its own ---')

/* No server in common - only a friendship - which is the second of the three. */
await call('/api/friends/request', { method: 'POST', body: JSON.stringify({ name: 'stranger' }) }, host.token)
await call('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: host.id }) }, stranger.token)

const asStrangerAgain = await socket(stranger.token)
await wait(400)
const nowSees = asStrangerAgain.online()
check('once they are friends, the host is on the list', nowSees.includes(host.id), nowSees)
check('but the other member still is not', !nowSees.includes(mate.id), nowSees)

asHost.close(); asHostNow.close(); asMate.close(); asStranger.close(); asStrangerAgain.close()

console.log(bad === 0 ? '\n  presence is only ever about people you share something with' : `\n  ${bad} FAILED`)
process.exitCode = bad === 0 ? 0 : 1
