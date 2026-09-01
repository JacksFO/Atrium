/**
 * You are online while the app is open, and offline when it is closed.
 *
 * Not "while the window has focus", and not "while the network is perfect".
 * Minimised, in the tray, on a second monitor, behind a game - all of that is
 * the app being open, and the dot should say so. Only actually closing it, or
 * a machine that has genuinely stopped answering, is offline.
 *
 * The case this was written for: a three second wifi hiccup announced the
 * person offline and then online again, so a room of people watched a dot
 * blink at them for something none of them did. The gateway now waits before
 * saying anybody has gone, and cancels the announcement if they come back.
 *
 * Three branches, and the third is the one that keeps this honest - a grace
 * that never expires would pass the first two while leaving everybody online
 * forever.
 */
import { createRequire } from 'node:module'

/*
 * The node built-in WebSocket cannot abandon a connection - close() always
 * completes the handshake, and the closest it offers is a custom code, which
 * is a close frame like any other and takes the wrong branch. Only a socket
 * that vanishes without one arrives as 1006, and that needs ws.terminate().
 * Reached through the server's own copy: nothing at the root depends on ws.
 */
const { WebSocket: Raw } = createRequire(import.meta.url)('../../apps/server/node_modules/ws')

const BASE = process.env.BASE

/**
 * Must match OFFLINE_GRACE_MS in the gateway. Shortening it there without
 * touching this only makes the wait generous; lengthening it there fails the
 * last check here, which is the direction that matters.
 */
const GRACE_MS = 15_000

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

/** A socket that keeps the presence it was told, so it can be asked after. */
const socket = (token) => new Promise((resolve, reject) => {
  const ws = new Raw(BASE.replace('http', 'ws') + '/gateway')
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
    heard: (who) => presence.filter((p) => p.userId === who),
    /** Who this connection was told is online, at the moment it connected. */
    online: () => ready?.online ?? [],
    /** 3 is CLOSED, and the only honest way to say the socket has gone. */
    shut: () => ws.readyState === 3,
    forget: () => { presence.length = 0 },
    /*
     * Quitting. Deliberately argument-less, because that is what a tab
     * closing sends and it arrives as 1005 rather than 1000 - the exact case
     * an earlier version of the gateway mistook for a blip and sat on for
     * fifteen seconds.
     */
    quit: () => ws.close(),
    /** Gone without a word, which is the only thing 1006 means. */
    vanish: () => ws.terminate(),
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
const mate = await reg('Nipeno')
await call(`/api/invites/${code}/accept`, { method: 'POST', body: '{}' }, mate.token)

// The host watches. Everything below is about what he is told about Nipeno.
const watcher = await socket(host.token)

console.log('\na blip does not announce anybody offline')
{
  let them = await socket(mate.token)
  await wait(500)
  watcher.forget()

  them.vanish()
  await wait(3_000)

  /*
   * The precondition, and it has to be about the socket. The first version of
   * this asked the HTTP API for a 200 and called that "the socket really
   * went", which proves the token works and nothing whatsoever about the
   * connection - silence below would have passed on a gateway where the
   * socket never closed at all.
   */
  check('the socket really went', them.shut())
  check('nothing said in the first three seconds', watcher.heard(mate.id).length === 0,
    watcher.heard(mate.id))

  /*
   * And the two answers agree while the grace runs. Presence is announced
   * from one place and listed from another, so somebody arriving mid-grace
   * used to be handed a list built straight from the live sockets - showing
   * offline for somebody nobody had been told about.
   */
  const arriving = await socket(host.token)
  check('somebody connecting mid-grace is told they are online',
    arriving.online().includes(mate.id), arriving.online())
  arriving.quit()

  // Back inside the grace, which is the whole point of having one.
  them = await socket(mate.token)
  await wait(1_000)
  const said = watcher.heard(mate.id)
  check('still nothing once they are back', said.every((p) => p.online === true), said)
  check('never announced offline at all', !said.some((p) => p.online === false), said)

  them.quit()
  await wait(1_000)
}

console.log('\nclosing the app is offline at once, not after the grace')
{
  const them = await socket(mate.token)
  await wait(500)
  watcher.forget()

  them.quit()
  await wait(2_000)

  const said = watcher.heard(mate.id)
  check('offline announced well inside the grace', said.some((p) => p.online === false), said)
}

console.log('\na blip nobody comes back from is offline when the grace runs out')
{
  const them = await socket(mate.token)
  await wait(500)
  watcher.forget()

  them.vanish()
  await wait(3_000)
  check('quiet at three seconds', watcher.heard(mate.id).length === 0, watcher.heard(mate.id))

  // Past the grace, with room for the timer to fire and the push to arrive.
  await wait(GRACE_MS - 3_000 + 3_000)
  const said = watcher.heard(mate.id)
  check('offline once the grace has run out', said.some((p) => p.online === false), said)
}

console.log(bad === 0 ? '\nall good' : `\n${bad} failed`)
process.exit(bad === 0 ? 0 : 1)
