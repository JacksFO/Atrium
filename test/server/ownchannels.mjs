/**
 * Somebody who made a server can add channels to it.
 *
 * Reported: a friend made a server of their own and found no way to add a
 * channel - not beside Text and Voice in the list, and not in the server's
 * settings. The button exists and is drawn only when the permissions for the
 * server being looked at include manage_channels, so this asks what those
 * permissions actually are, from the same place the app reads them.
 *
 * The ready payload rather than the HTTP routes, because that payload is
 * where the client gets them and a route answering correctly would prove
 * nothing about what the screen was told.
 */

const BASE = process.env.BASE

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

const call = async (path, init = {}, token) => {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  let body = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

const reg = async (username, invite) => {
  const b = (await call('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'password123', displayName: username, invite }),
  })).body
  return { token: b?.token, id: b?.user?.id }
}

/** What the app is told when it connects, which is where the buttons come from. */
const readyFor = (token) => new Promise((resolve) => {
  const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const timer = setTimeout(() => { try { sock.close() } catch {} ; resolve(null) }, 9000)
  sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
  sock.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
    if (m.t !== 'ready') return
    clearTimeout(timer)
    try { sock.close() } catch {}
    resolve(m)
  }
})

console.log('\n  --- a server of your own, and the channels in it ---')

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
const original = (await call('/api/spaces', { method: 'POST', body: JSON.stringify({ name: 'Test Server' }) }, host.token)).body.space
const code = (await call(`/api/spaces/${original.id}/invites`, { method: 'POST', body: '{}' }, host.token)).body.code

/*
 * A friend, who joins the host's server and then makes one of their own -
 * which is the shape the report came from. Somebody whose only server is
 * their own would be a different case, and is checked below.
 */
const mate = await reg('baileyyy', code)
const made = await call('/api/spaces', {
  method: 'POST', body: JSON.stringify({ name: 'Their Server' }),
}, mate.token)
check('they can make a server', made.status === 200, { status: made.status, error: made.body?.error })
const theirs = made.body?.space
check('and it comes back with an id', !!theirs?.id, theirs?.id)

/*
 * The way it actually happened: already connected, and the server made after
 * that. The permissions for every server arrive once, when a client connects,
 * so one made afterwards had no entry - and the screen fell back to a
 * different server's, where the person who had just made this one was nobody.
 *
 * A reload would have hidden it, which is why this listens on a socket opened
 * BEFORE the server is made rather than asking for a fresh ready payload.
 */
const live = await new Promise((resolve) => {
  /*
   * Everything heard, sorted out afterwards.
   *
   * The push arrives before the HTTP response does, so a version of this that
   * waited to learn the new id and only then started listening threw away the
   * very message it was waiting for, and reported the fix missing twice.
   */
  const heard = []
  let madeId = null
  const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const done = () => {
    try { sock.close() } catch {}
    resolve({ madeId, permissions: heard.find((m) => m.spaceId === madeId)?.permissions ?? null })
  }
  const timer = setTimeout(done, 12000)
  sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token: mate.token }))
  sock.onmessage = async (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'permissions') return void heard.push(m)
    if (m.t !== 'ready') return
    const fresh = await call('/api/spaces', {
      method: 'POST', body: JSON.stringify({ name: 'Made While Watching' }),
    }, mate.token)
    madeId = fresh.body?.space?.id ?? null
    // A moment for anything still in flight to land.
    setTimeout(() => { clearTimeout(timer); done() }, 1200)
  }
})
check('a server made while already connected says what may be done in it',
  Array.isArray(live.permissions) && live.permissions.includes('manage_channels'),
  live.permissions ? live.permissions.length + ' permissions' : 'nothing was sent')

const ready = await readyFor(mate.token)
check('their app is told what it may do', !!ready, ready ? 'ready' : 'no ready payload')

const perms = ready?.permissionsBySpace ?? {}
console.log('  spaces they have permissions for:', Object.keys(perms).length)
for (const [space, list] of Object.entries(perms)) {
  const which = space === theirs?.id ? 'their own' : space === original.id ? "the host's" : space
  console.log(`    ${which}: ${list.length} permissions${list.includes('manage_channels') ? ' (can manage channels)' : ''}`)
}

/*
 * The whole of the report. The add button beside Text and Voice is drawn
 * only when the permissions for the server on screen include this one.
 */
const mine = perms[theirs?.id] ?? null
check('their own server is among them', mine !== null, Object.keys(perms))
check('and it lets them manage channels there',
  !!mine && mine.includes('manage_channels'), mine)

/* And that the server agrees, so a button that appears also works. */
const added = await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name: 'second-room', kind: 'text', spaceId: theirs?.id }),
}, mate.token)
check('and the server really does let them add one',
  added.status === 200, { status: added.status, error: added.body?.error })

console.log('\n  ' + (bad === 0 ? 'their own server is theirs to run' : bad + ' wrong'))
process.exit(bad === 0 ? 0 : 1)
