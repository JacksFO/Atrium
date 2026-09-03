/**
 * What somebody wants to be told about a whole server.
 *
 * The thing a channel set to "use my default" was always meant to defer to.
 * That phrase has been in the channel menu from the beginning with nothing
 * behind it, so every channel anybody left alone behaved as "all messages"
 * whether they wanted that or not.
 *
 * Over the wire because the parts that can go wrong are all here: that it is
 * kept, that it comes back on the next connection, that it reaches your other
 * windows, and that it cannot be set about a server somebody is not in.
 *
 * What it does with a message is decided in the client - notifyLevel.ts, which
 * is pure and tested on its own - so this is about the setting travelling, not
 * about which noise gets made.
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

/** A connection that keeps what it was told, so both halves can be asked. */
const gateway = (token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const heard = []
  let ready = null
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') { ready = m; return resolve(api) }
    heard.push(m)
  }
  const api = {
    /** What the opening frame carried. */
    opening: () => ready,
    heard: (t) => heard.filter((m) => m.t === t),
    quit: () => ws.close(),
  }
  setTimeout(() => reject(new Error('the gateway never said ready')), 12000)
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const run = async () => {
  const me = await reg('spowner')
  const space = (await call('/api/spaces', {
    method: 'POST', body: JSON.stringify({ name: 'Loud' }),
  }, me.token)).body?.space
  check('a server can be made', !!space?.id, space?.name)

  /* Two windows of the same account, which is the case the push is for. */
  const windowOne = await gateway(me.token)
  const windowTwo = await gateway(me.token)

  /* Nothing said yet, so nothing is carried - the absence of a row is the
     default, which is what keeps this empty for almost everybody. */
  check('a fresh account carries no server preferences',
    (windowOne.opening()?.spacePrefs ?? []).length === 0,
    windowOne.opening()?.spacePrefs)

  // --- setting a level ------------------------------------------------------
  const set = await call(`/api/spaces/${space.id}/prefs`, {
    method: 'PUT', body: JSON.stringify({ level: 'mentions' }),
  }, me.token)
  check('a level can be set', set.status === 200, set.body)
  check('and comes back as it was set', set.body?.pref?.level === 'mentions', set.body?.pref)

  /* Your other window, which is the whole reason this is pushed rather than
     merely stored: setting it on one machine must not leave the other one
     ringing. */
  await wait(900)
  const told = windowTwo.heard('space-prefs-changed')
  check('and your other window is told',
    told.length === 1 && told[0]?.pref?.level === 'mentions', told)

  // --- and it survives coming back ------------------------------------------
  const later = await gateway(me.token)
  const carried = (later.opening()?.spacePrefs ?? [])
  check('and a new connection is told about it',
    carried.length === 1 && carried[0]?.spaceId === space.id && carried[0]?.level === 'mentions',
    carried)

  // --- muting, and the clock it is measured on ------------------------------
  /*
   * A length rather than a moment. A client sending its own "until" is
   * sending its own clock, and a machine an hour out would mute for an hour
   * too long or not at all.
   */
  const muted = await call(`/api/spaces/${space.id}/prefs`, {
    method: 'PUT', body: JSON.stringify({ muteFor: 60_000 }),
  }, me.token)
  const until = muted.body?.pref?.mutedUntil
  check('a server can be muted for a while', muted.status === 200, muted.body)
  check('and the end is worked out here, not sent',
    typeof until === 'number' && until > Date.now() && until < Date.now() + 120_000, until)

  /* And muting did not quietly reset the level, the way the channel version
     is careful not to. */
  check('and muting left the level alone', muted.body?.pref?.level === 'mentions', muted.body?.pref)

  const unmuted = await call(`/api/spaces/${space.id}/prefs`, {
    method: 'PUT', body: JSON.stringify({ muteFor: null }),
  }, me.token)
  check('and it can be unmuted', unmuted.body?.pref?.mutedUntil === null, unmuted.body?.pref)

  // --- suppressing @everyone ------------------------------------------------
  const hushed = await call(`/api/spaces/${space.id}/prefs`, {
    method: 'PUT', body: JSON.stringify({ suppressEveryone: true }),
  }, me.token)
  check('@everyone can be suppressed', hushed.body?.pref?.suppressEveryone === true, hushed.body?.pref)

  // --- and what it refuses --------------------------------------------------
  /*
   * No 'default' here, unlike a channel. This *is* the default - a server
   * deferring to itself is a question with no answer, and storing the word
   * would leave a level nothing could resolve.
   */
  const nonsense = await call(`/api/spaces/${space.id}/prefs`, {
    method: 'PUT', body: JSON.stringify({ level: 'default' }),
  }, me.token)
  check('a server cannot defer to itself', nonsense.status === 400, nonsense.status)

  const silly = await call(`/api/spaces/${space.id}/prefs`, {
    method: 'PUT', body: JSON.stringify({ level: 'sometimes' }),
  }, me.token)
  check('and a level it has never heard of is refused', silly.status === 400, silly.status)

  const forever = await call(`/api/spaces/${space.id}/prefs`, {
    method: 'PUT', body: JSON.stringify({ muteFor: 999 * 86400_000 }),
  }, me.token)
  check('and a mute longer than a month is refused', forever.status === 400, forever.status)

  /* And it is about a server you are in. Somebody outside it has no business
     holding a preference about it, and the row would describe nothing. */
  const stranger = await reg('spstranger')
  const theirs = await call(`/api/spaces/${space.id}/prefs`, {
    method: 'PUT', body: JSON.stringify({ level: 'nothing' }),
  }, stranger.token)
  check('and somebody outside the server cannot set one', theirs.status === 403, theirs.status)

  const anonymous = await call(`/api/spaces/${space.id}/prefs`, {
    method: 'PUT', body: JSON.stringify({ level: 'nothing' }),
  })
  check('nor can somebody signed in as nobody', anonymous.status === 401, anonymous.status)

  windowOne.quit(); windowTwo.quit(); later.quit()
  console.log(bad === 0 ? '\n  all server preference checks passed' : `\n  ${bad} failed`)
  process.exit(bad === 0 ? 0 : 1)
}

run().catch((err) => { console.error(err); process.exit(1) })
