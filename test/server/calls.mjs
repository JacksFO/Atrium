/**
 * Calling, and what a call can see.
 *
 * Two halves, and they are the same question asked twice.
 *
 * The first: does calling work at all - does ringing reach every window
 * somebody has open, does answering in one stop the others, does a call that
 * is never answered leave a missed call behind, does hanging up end it.
 *
 * The second: does a call stay inside the walls everything else does. Who you
 * may ring is not "anybody whose id you have learned" - it is somebody you
 * share a server with, are friends with, or are already talking to. Who you
 * may join is not "any voice channel" - it is one in a server you are in. And
 * who you can SEE in voice is narrower still: sitting in a voice channel in
 * one server must be invisible from another.
 *
 * Node has its own WebSocket, so this needs nothing installed.
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
 * A connected client, holding on to everything the server tells it.
 *
 * Kept open rather than opened per question, because most of what is being
 * checked here is about delivery: which sockets a thing reaches, and which it
 * does not.
 */
function connect(token, label) {
  const seen = []
  let readyPayload = null
  const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const ready = new Promise((resolve, reject) => {
    const giveUp = setTimeout(() => reject(new Error(`${label} never became ready`)), 12000)
    sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
    sock.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data))
      if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
      if (m.t === 'ready') { readyPayload = m; clearTimeout(giveUp); return resolve() }
      seen.push(m)
    }
    sock.onerror = () => { clearTimeout(giveUp); reject(new Error(`${label} could not connect`)) }
  })
  const waitFor = async (kind, ms = 2500) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      const hit = seen.find((m) => m.t === kind)
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 50))
    }
    return null
  }
  return {
    ready,
    waitFor,
    send: (m) => sock.send(JSON.stringify(m)),
    seenOf: (kind) => seen.filter((m) => m.t === kind),
    forget: () => { seen.length = 0 },
    get readyPayload() { return readyPayload },
    close: () => { try { sock.close() } catch { /* already gone */ } },
  }
}

// ---------------------------------------------------------------------------
// Two servers with no overlap, and people who share nothing.
// ---------------------------------------------------------------------------
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
const hostCode = (await call(`/api/spaces/${original.id}/invites`, { method: 'POST', body: '{}' }, host.token)).body.code

const mate = await reg('baileyyy', hostCode)
const theirs = (await call('/api/spaces', {
  method: 'POST', body: JSON.stringify({ name: 'Baileys Dictatorship' }),
}, mate.token)).body.space
const theirCode = (await call(`/api/spaces/${theirs.id}/invites`, { method: 'POST', body: '{}' }, mate.token)).body.code

// In the host's server only.
const insider = await reg('Cami', hostCode)
// In the other server only. Shares nothing with Cami, and never has.
const outsider = await reg('Keeko', theirCode)

console.log('  --- ringing somebody you can see ---')
const hostPhone = connect(host.token, 'JacksFO')
const hostLaptop = connect(host.token, 'JacksFO second window')
const matePhone = connect(mate.token, 'baileyyy')
await Promise.all([hostPhone.ready, hostLaptop.ready, matePhone.ready])

// They share the host's server, so this is allowed.
matePhone.send({ t: 'call-ring', to: host.id })

const rangHere = await hostPhone.waitFor('call-incoming')
const rangThere = await hostLaptop.waitFor('call-incoming')
check('a ring reaches one of their windows', !!rangHere, rangHere && rangHere.from)
check('and every other window they have open', !!rangThere, rangThere && rangThere.from)
check('and it says who is calling',
  rangHere && rangHere.from === mate.id, rangHere && rangHere.from)

console.log('\n  --- and a missed call is left behind ---')
/*
 * The reason call rows exist: somebody who was away had no way of knowing
 * anybody had rung. So the conversation has to carry the attempt even when
 * nobody picks up.
 */
matePhone.send({ t: 'call-cancel', to: host.id })
await new Promise((r) => setTimeout(r, 600))

const dms = (await call('/api/dms', {}, host.token)).body
const withMate = (dms?.dms ?? []).find(
  (c) => (c.members ?? []).some((m) => m.user_id === mate.id))
check('the conversation exists now', !!withMate, withMate ? withMate.id : dms)

if (withMate) {
  const history = (await call(`/api/channels/${withMate.id}/messages`, {}, host.token)).body
  const rows = (history?.messages ?? []).filter((m) => m.kind === 'call')
  check('a call row was written into it', rows.length >= 1, rows.length)
  check('and it is closed, because nobody answered',
    rows.length >= 1 && rows[rows.length - 1].call_ended_at, rows[rows.length - 1])
}

console.log('\n  --- answering in one window stops the others ---')
hostPhone.forget()
hostLaptop.forget()
matePhone.forget()
matePhone.send({ t: 'call-ring', to: host.id })
await hostPhone.waitFor('call-incoming')

// Picked up on the phone. The laptop has to stop ringing.
hostPhone.send({ t: 'call-accept', to: mate.id })
const laptopTold = await hostLaptop.waitFor('call-cancel')
check('the window that did not answer is told to stop', !!laptopTold, laptopTold)
check('and the window that answered is not told to cancel itself',
  hostPhone.seenOf('call-cancel').length === 0, hostPhone.seenOf('call-cancel'))
const callerTold = await matePhone.waitFor('call-accept')
check('the caller hears that it was answered', !!callerTold, callerTold && callerTold.from)

matePhone.send({ t: 'call-cancel', to: host.id })
await new Promise((r) => setTimeout(r, 400))

console.log('\n  --- but not somebody you share nothing with ---')
/*
 * Cami is in the host's server. Keeko is in the other one. They have never
 * shared a server, are not friends, and have never spoken - so neither may
 * make the other's app ring, in either direction.
 */
const camiPhone = connect(insider.token, 'Cami')
const keekoPhone = connect(outsider.token, 'Keeko')
await Promise.all([camiPhone.ready, keekoPhone.ready])

keekoPhone.send({ t: 'call-ring', to: insider.id })
const unwanted = await camiPhone.waitFor('call-incoming', 1500)
check('a stranger cannot make somebody\'s app ring', !unwanted, unwanted)

camiPhone.send({ t: 'call-ring', to: outsider.id })
const unwantedBack = await keekoPhone.waitFor('call-incoming', 1500)
check('and it does not work the other way either', !unwantedBack, unwantedBack)

console.log('\n  --- voice channels stay in their own server ---')
const channelsOf = (client, spaceId) =>
  (client.readyPayload?.channels ?? []).filter((c) => c.space_id === spaceId)

const hostVoice = channelsOf(hostPhone, original.id).find((c) => c.kind === 'voice')
check('the host has a voice channel in their server', !!hostVoice,
  channelsOf(hostPhone, original.id).map((c) => `${c.kind}:${c.name}`))

check('somebody who is not in that server is not even told it exists',
  !(keekoPhone.readyPayload?.channels ?? []).some((c) => c.id === hostVoice?.id),
  (keekoPhone.readyPayload?.channels ?? []).map((c) => c.name))

// Cami sits in the host's voice channel.
camiPhone.forget()
camiPhone.send({ t: 'voice-join', channelId: hostVoice.id, muted: false, deafened: false })
const camiIn = await camiPhone.waitFor('voice-state')
check('somebody in the server can join it',
  !!camiIn && (camiIn.occupants ?? []).some((o) => o.userId === insider.id),
  camiIn && (camiIn.occupants ?? []).map((o) => o.userId))

// Keeko tries to walk into the same channel from outside the server.
keekoPhone.forget()
keekoPhone.send({ t: 'voice-join', channelId: hostVoice.id, muted: false, deafened: false })
await new Promise((r) => setTimeout(r, 800))

const keekoStates = keekoPhone.seenOf('voice-state')
const keekoGotIn = keekoStates.some((s) => (s.occupants ?? []).some((o) => o.userId === outsider.id))
check('somebody outside it cannot', !keekoGotIn, keekoStates.map((s) => (s.occupants ?? []).map((o) => o.userId)))

check('and cannot see who is sitting in it either',
  !keekoStates.some((s) => (s.occupants ?? []).some((o) => o.userId === insider.id)),
  keekoStates.length)

// The same question asked of a fresh connection, because ready carries voice
// too - a leak there would not show up in the events above.
const keekoAgain = connect(outsider.token, 'Keeko reconnecting')
await keekoAgain.ready
check('nor when they connect fresh',
  !(keekoAgain.readyPayload?.voice ?? []).some((o) => o.userId === insider.id),
  (keekoAgain.readyPayload?.voice ?? []).map((o) => o.userId))

// And the person who IS in that server still sees them, or this proves
// nothing at all.
const hostAgain = connect(host.token, 'JacksFO reconnecting')
await hostAgain.ready
check('while somebody in that server does see them',
  (hostAgain.readyPayload?.voice ?? []).some((o) => o.userId === insider.id),
  (hostAgain.readyPayload?.voice ?? []).map((o) => o.userId))

console.log('\n  --- what quality somebody is sharing at reaches the people watching ---')
/*
 * The badge saying "1080p 30FPS" read a setting held on the sharer's own
 * machine, so only the sharer ever saw it. Everybody watching had no way to
 * tell the quality on offer from their own connection struggling.
 *
 * Asked for as "show the quality and fps they have selected the same as I can
 * see my own", so what travels is the choice, not a measurement.
 */
hostPhone.forget()
hostPhone.send({ t: 'voice-join', channelId: hostVoice.id, muted: false, deafened: false })
await hostPhone.waitFor('voice-state')

camiPhone.forget()
hostPhone.send({ t: 'voice-update', sharing: true, shareQuality: 'high' })
const sawShare = await camiPhone.waitFor('voice-state')
const hostSeenBy = (state) => (state?.occupants ?? []).find((o) => o.userId === host.id)

check('somebody watching is told the sharer is sharing',
  hostSeenBy(sawShare)?.sharing === true, hostSeenBy(sawShare))
check('and at which quality', hostSeenBy(sawShare)?.shareQuality === 'high',
  hostSeenBy(sawShare))

// Changing it mid-share reaches them too - the whole point of a badge that
// says what is being sent is that it keeps saying it.
camiPhone.forget()
hostPhone.send({ t: 'voice-update', sharing: true, shareQuality: 'sharp' })
const changed = await camiPhone.waitFor('voice-state')
check('changing quality mid-share reaches them', hostSeenBy(changed)?.shareQuality === 'sharp',
  hostSeenBy(changed))

/*
 * This string is sent from one person and rendered on everybody else's
 * screen, so it is checked rather than passed through.
 */
camiPhone.forget()
hostPhone.send({ t: 'voice-update', sharing: true, shareQuality: 'ultra-mega-4k' })
await new Promise((r) => setTimeout(r, 500))
const afterJunk = camiPhone.seenOf('voice-state').at(-1) ?? changed
check('a quality nobody has heard of is refused, not passed on',
  hostSeenBy(afterJunk)?.shareQuality === 'sharp', hostSeenBy(afterJunk))

camiPhone.forget()
hostPhone.send({ t: 'voice-update', sharing: true, shareQuality: { evil: true } })
await new Promise((r) => setTimeout(r, 500))
const afterObject = camiPhone.seenOf('voice-state').at(-1) ?? afterJunk
check('and so is something that is not even a name',
  hostSeenBy(afterObject)?.shareQuality === 'sharp', hostSeenBy(afterObject))

// And it goes when the share does, or a tile would carry a badge describing
// a share that had ended.
camiPhone.forget()
hostPhone.send({ t: 'voice-update', sharing: false })
const stopped = await camiPhone.waitFor('voice-state')
check('stopping the share clears the quality with it',
  hostSeenBy(stopped)?.sharing === false && hostSeenBy(stopped)?.shareQuality === null,
  hostSeenBy(stopped))

// A quality arriving with no share running cannot put the badge back.
camiPhone.forget()
hostPhone.send({ t: 'voice-update', sharing: false, shareQuality: 'high' })
await new Promise((r) => setTimeout(r, 500))
const afterStale = camiPhone.seenOf('voice-state').at(-1) ?? stopped
check('and one arriving after it stopped does not bring it back',
  (hostSeenBy(afterStale)?.shareQuality ?? null) === null, hostSeenBy(afterStale))

// Nobody outside the server learns any of it, which is the rule the section
// above established and this new field has to keep.
check('and none of it leaked outside the server',
  !keekoPhone.seenOf('voice-state').some((s) =>
    (s.occupants ?? []).some((o) => o.userId === host.id && o.shareQuality)),
  keekoPhone.seenOf('voice-state').length)

console.log('\n  --- reading on one device clears it on the others ---')
/*
 * Reported: "I read a message from someone and it cleared my notification on
 * my desktop app but I still had that same notification on my web browser."
 *
 * The server wrote the read row and told nobody, so the only client it never
 * mentioned it to was the one still showing the badge. Two windows for one
 * person is exactly the shape of that, and this suite already has a pair.
 */
const readable = (hostPhone.readyPayload?.channels ?? []).find((c) => c.kind === 'text')
check('there is a channel to read', !!readable, readable && readable.name)

hostLaptop.forget()
hostPhone.send({ t: 'read', channelId: readable.id })
const laptopHeard = await hostLaptop.waitFor('read')
check('the other window is told', !!laptopHeard, laptopHeard)
check('and told which channel', laptopHeard && laptopHeard.channelId === readable.id, laptopHeard)
check('with when, so a later message is still unread',
  !!laptopHeard && typeof laptopHeard.at === 'number', laptopHeard)

// Somebody else's windows must hear nothing: what I have read is mine.
camiPhone.forget()
hostPhone.send({ t: 'read', channelId: readable.id })
await new Promise((r) => setTimeout(r, 500))
check('and nobody else is told what I have read',
  camiPhone.seenOf('read').length === 0, camiPhone.seenOf('read'))

/*
 * A channel the sender cannot even see is not a channel they can mark read.
 * The write was already guarded; this is the announcement following it, which
 * would otherwise be a way to learn that a private channel exists.
 */
keekoPhone.forget()
keekoPhone.send({ t: 'read', channelId: hostVoice.id })
await new Promise((r) => setTimeout(r, 500))
check('reading a channel you cannot see is refused, silently',
  keekoPhone.seenOf('read').length === 0, keekoPhone.seenOf('read'))

for (const c of [hostPhone, hostLaptop, matePhone, camiPhone, keekoPhone, keekoAgain, hostAgain]) {
  c.close()
}
console.log('\n  --- a permission is claimed where it is used ---')
/*
 * Found by audit. The gateway asked whether somebody may mention everyone
 * without saying where, so it was answered by the FIRST server on the
 * machine - whichever server the message was actually going to.
 *
 * Which means an owner could not ping their own server unless they also held
 * the permission somewhere else entirely, and somebody who held it in the
 * first server could ping a server they had merely joined.
 */
const theirInvite = (await call(`/api/spaces/${theirs.id}/invites`, { method: 'POST', body: '{}' }, mate.token)).body.code
await call(`/api/invites/${theirInvite}/accept`, { method: 'POST', body: '{}' }, host.token)

const mateSocket = connect(mate.token, 'baileyyy posting')
const hostSocket = connect(host.token, 'JacksFO posting')
await Promise.all([mateSocket.ready, hostSocket.ready])

const textIn = (client, spaceId) =>
  (client.readyPayload?.channels ?? []).find((c) => c.space_id === spaceId && c.kind === 'text')

const theirText = textIn(mateSocket, theirs.id)
check('their server has a channel to post in', !!theirText, theirText && theirText.name)

// The owner of that server, pinging their own server.
mateSocket.forget()
mateSocket.send({ t: 'send', channelId: theirText.id, body: '@everyone dinner', nonce: 'a1' })
const ownerRefused = await mateSocket.waitFor('send-refused', 1500)
const ownerSent = await mateSocket.waitFor('ack', 1500)
check('the owner can mention everyone in their own server',
  !ownerRefused && !!ownerSent, ownerRefused ? ownerRefused.detail : 'sent')

/*
 * And somebody who holds it only in the OTHER server cannot use it here.
 * The host owns the first server, so they hold every permission there and
 * nothing but @everyone in this one.
 */
hostSocket.forget()
hostSocket.send({ t: 'send', channelId: theirText.id, body: '@everyone hello', nonce: 'b1' })
const guestRefused = await hostSocket.waitFor('send-refused', 2000)
check('but holding it in another server does not carry it in',
  !!guestRefused && /mention everyone/i.test(guestRefused.detail || ''),
  guestRefused ? guestRefused.detail : 'it was allowed')

// And an ordinary message from them still goes, so this is about the
// mention and not about posting at all.
hostSocket.forget()
hostSocket.send({ t: 'send', channelId: theirText.id, body: 'evening', nonce: 'b2' })
const plainOk = await hostSocket.waitFor('ack', 2000)
check('while an ordinary message from them is fine', !!plainOk, plainOk ? 'sent' : 'refused')

mateSocket.close()
hostSocket.close()

/*
 * Joining the call, rather than being rung about it.
 *
 * Ringing is a frame between sockets; joining is a request that mints a token
 * for the room. That request is the enforcement point - the client asking
 * nicely is not - and it was not being asked anything here at all, because a
 * server with no voice keys answers 503 before it looks at who you are. The
 * runner now gives it keys that go nowhere, so the checks behind that answer
 * are reachable.
 */
const joinCall = (channelId, token) =>
  call('/api/voice/token', { method: 'POST', body: JSON.stringify({ channelId }) }, token)

{
  const mine = await joinCall(withMate.id, host.token)
  check('somebody in a conversation can join its call',
    mine.status === 200 && !!mine.body?.token, mine.status)
  check('and the room is the conversation itself',
    mine.body?.room === withMate.id, mine.body?.room)

  const theirs = await joinCall(withMate.id, mate.token)
  check('and so can the other person in it', theirs.status === 200, theirs.status)

  /* The one that matters: a private call is private. */
  const stranger = await joinCall(withMate.id, outsider.token)
  check("but a stranger cannot join somebody's private call",
    stranger.status === 403, stranger.status)

  /* And the same question about a room in a server, which is the other half
     of that route - being in the server is what decides. */
  const notInIt = await joinCall(hostVoice.id, outsider.token)
  check('nor a voice room in a server they are not in',
    notInIt.status === 403 || notInIt.status === 404, notInIt.status)

  const insiderJoin = await joinCall(hostVoice.id, insider.token)
  check('while somebody in that server can', insiderJoin.status === 200, insiderJoin.status)
}


console.log('\n  ' + (bad === 0 ? 'calling behaves' : bad + ' wrong'))
process.exit(bad === 0 ? 0 : 1)
