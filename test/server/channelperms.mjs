/**
 * Per-channel permission overrides, and the order they resolve in.
 *
 * Asked for as: give a role access to a channel, but in another channel let
 * them read and not send; and be able to say it about one person as well as
 * about a role. That is three separate claims - that a channel can take
 * something away, that it can give it back, and that naming somebody by hand
 * beats every role they hold - and each of them fails open if it is wrong.
 *
 * So nothing here is asserted by reading back the panel. Every check makes
 * the server say yes or no to a real request: post a message, read the
 * history, search for a word that exists. A grid of switches that shows the
 * right thing and enforces nothing is exactly the failure being looked for.
 *
 * Preconditions are asserted, not assumed. Half of these refusals could
 * happen for a reason that has nothing to do with the rule under test - not
 * being in the server, not holding the permission in the first place - and a
 * test that counts 403s cannot tell those apart from the thing it is for.
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
  return { token: b?.token, id: b?.user?.id }
}

/**
 * A live connection, because posting a message is not an HTTP route.
 *
 * There is no /api/messages: sending goes over the gateway, and so does the
 * refusal - as an `ack` or a `send-refused` carrying the nonce the client
 * made up. Which is the whole reason this suite talks to the socket rather
 * than testing the permission functions directly: the check being tested
 * lives on that path, and a unit test of the resolver would pass just as
 * happily if nothing ever called it.
 *
 * Kept open across the whole run. Every send is judged when it arrives, so
 * one connection sees every rule change made while it is held - and holding
 * it proves that, which a fresh socket per message would not.
 *
 * Node has its own WebSocket, so this needs nothing installed.
 */
const gateway = (token) => new Promise((resolve, reject) => {
  const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const waiting = []
  let ready = null

  sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
  sock.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready' && !ready) { ready = m; return resolve(api) }
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (waiting[i].match(m)) waiting.splice(i, 1)[0].done(m)
    }
  }

  const expect = (match) => new Promise((done) => {
    const w = { match, done }
    waiting.push(w)
    // Resolving with nothing rather than hanging: a check that reads
    // "nothing came back" is a readable failure, and a hung suite is not.
    setTimeout(() => {
      const i = waiting.indexOf(w)
      if (i >= 0) { waiting.splice(i, 1); done(null) }
    }, 8000)
  })

  const api = {
    ready: () => ready,
    close: () => { try { sock.close() } catch { /* already closed */ } },
    channels: () => (ready?.channels ?? []),
    say: async (channelId, body = 'hello') => {
      const nonce = 'n' + Math.random().toString(36).slice(2)
      const answer = expect((m) => (m.t === 'ack' || m.t === 'send-refused') && m.nonce === nonce)
      sock.send(JSON.stringify({ t: 'send', channelId, body, nonce }))
      const m = await answer
      return m?.t === 'ack' ? 'sent' : m?.t === 'send-refused' ? 'refused' : 'no answer'
    },
  }
  setTimeout(() => reject(new Error('the gateway never said ready')), 15000)
})

/** The channel list as this person is given it, right now. */
const channelsFor = async (token) => {
  const sock = await gateway(token)
  const list = sock.channels()
  sock.close()
  return list
}

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
const mate = await reg('Nipeno', code)
const other = await reg('Cami', code)

const roles = (await call(`/api/roles?spaceId=${space.id}`, {}, host.token)).body.roles
const everyone = roles.find((r) => r.kind === 'everyone')

const squad = ((await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'squad', spaceId: space.id }),
}, host.token)).body.roles ?? []).find((r) => r.name === 'squad')
await call(`/api/admin/members/${mate.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: squad.id, grant: true, spaceId: space.id }),
}, host.token)

const makeChannel = async (name, categoryId) => (await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name, kind: 'text', spaceId: space.id, categoryId }),
}, host.token)).body.channel

const asHost = await gateway(host.token)
const asMateSock = await gateway(mate.token)
const asOther = await gateway(other.token)

const say = (channelId, who, body) => who.say(channelId, body)
const history = (channelId, token) => call(`/api/channels/${channelId}/messages`, {}, token)

/** Set everything one subject is given in one channel, in a single request. */
const setChannel = (channelId, kind, subjectId, rules, token = host.token) =>
  call(`/api/channels/${channelId}/permissions`, {
    method: 'PUT', body: JSON.stringify({ kind, subjectId, rules }),
  }, token)

const setCategory = (categoryId, kind, subjectId, rules, token = host.token) =>
  call(`/api/categories/${categoryId}/permissions`, {
    method: 'PUT', body: JSON.stringify({ kind, subjectId, rules }),
  }, token)

console.log('  --- a channel can take away what the server allows ---')

const quiet = await makeChannel('quiet')

// The precondition. Without it, the refusal below could be somebody who was
// never able to post here in the first place.
const beforeQuiet = await say(quiet.id, asMateSock)
check('to begin with anybody in the server can post here', beforeQuiet === 'sent', beforeQuiet)

const denied = await setChannel(quiet.id, 'role', everyone.id, { send_messages: false })
check('denying send to @everyone here is accepted', denied.status === 200, denied.body)

const afterQuiet = await say(quiet.id, asMateSock)
check('and now the server refuses their message', afterQuiet === 'refused', afterQuiet)

// The other half of "in this channel": the same person, elsewhere, unchanged.
const general = (await channelsFor(host.token))
  .find((c) => c.kind === 'text' && c.id !== quiet.id && c.space_id === space.id)
const elsewhere = await say(general.id, asMateSock)
check('while the same person still posts in every other channel', elsewhere === 'sent', elsewhere)

const stillReads = await history(quiet.id, mate.token)
check('and they can still READ the channel they cannot write in', stillReads.status === 200, stillReads.status)

console.log('  --- a role gets it back, and allow beats deny at the same level ---')

const givenBack = await setChannel(quiet.id, 'role', squad.id, { send_messages: true })
check('allowing send to one role here is accepted', givenBack.status === 200, givenBack.body)

const squadPosts = await say(quiet.id, asMateSock)
check('the role that was allowed can post again', squadPosts === 'sent', squadPosts)

const otherStillOut = await say(quiet.id, asOther)
check('and somebody without that role still cannot', otherStillOut === 'refused', otherStillOut)

console.log('  --- naming one person beats every role they hold ---')

const shushed = await setChannel(quiet.id, 'member', mate.id, { send_messages: false })
check('denying send to one person here is accepted', shushed.status === 200, shushed.body)

const mateSilenced = await say(quiet.id, asMateSock)
check('they are refused despite holding the role that was allowed', mateSilenced === 'refused', mateSilenced)

// And the reverse direction, which is the more common request: everybody is
// shut out and one person is let in by name.
const letIn = await setChannel(quiet.id, 'member', other.id, { send_messages: true })
check('allowing send to one person here is accepted', letIn.status === 200, letIn.body)
const otherPosts = await say(quiet.id, asOther)
check('and they post although @everyone here is denied', otherPosts === 'sent', otherPosts)

console.log('  --- clearing a subject puts them back to inheriting ---')

const cleared = await setChannel(quiet.id, 'member', mate.id, { send_messages: null })
check('sending no decision at all is accepted', cleared.status === 200, cleared.body)
const mateBack = await say(quiet.id, asMateSock)
check('and they are governed by their role again', mateBack === 'sent', mateBack)

console.log('  --- taking away view hides the channel, and everything through it ---')

const secret = await makeChannel('secret')
await say(secret.id, asHost, 'pineapple-on-the-roof')

const beforeSecret = await history(secret.id, mate.token)
check('to begin with they can read it', beforeSecret.status === 200, beforeSecret.status)
const foundBefore = await call('/api/search?q=pineapple-on-the-roof', {}, mate.token)
check('and search finds what was said in it',
  (foundBefore.body?.results ?? []).length === 1, foundBefore.body?.results?.length)

await setChannel(secret.id, 'role', everyone.id, { view_channels: false })

const afterSecret = await history(secret.id, mate.token)
check('with view denied the history is refused', afterSecret.status === 403, afterSecret.status)
const foundAfter = await call('/api/search?q=pineapple-on-the-roof', {}, mate.token)
check('and search no longer returns it',
  (foundAfter.body?.results ?? []).length === 0, foundAfter.body?.results?.length)
const stillListed = await channelsFor(mate.token)
check('and the channel is not in their list at all',
  !stillListed.some((c) => c.id === secret.id), stillListed.map((c) => c.name))

// The old dialog and the new grid are the same store now, so one has to be
// able to read what the other wrote.
const asAccess = await call(`/api/channels/${secret.id}/access`, {}, host.token)
check('the who-can-see dialog agrees it is private', asAccess.body?.access?.private === true, asAccess.body)

console.log('  --- read the history but not what is said while you are away ---')

const announce = await makeChannel('announcements')
await say(announce.id, asHost, 'the-thing-is-on-friday')
await setChannel(announce.id, 'role', everyone.id, { send_messages: false, read_history: false })

const noHistory = await history(announce.id, mate.token)
check('read_history denied here refuses the history', noHistory.status === 403, noHistory.status)
const listedAnyway = await channelsFor(mate.token)
check('but the channel is still in their list - view was not touched',
  listedAnyway.some((c) => c.id === announce.id), listedAnyway.map((c) => c.name))

console.log('  --- a category says it once for everything under it ---')

const cat = (await call('/api/categories', {
  method: 'POST', body: JSON.stringify({ name: 'Staff', spaceId: space.id }),
}, host.token)).body.category
check('a category can be made', Boolean(cat?.id), cat)

const staffA = await makeChannel('staff-a', cat.id)
const staffB = await makeChannel('staff-b', cat.id)

const beforeCat = await say(staffA.id, asMateSock)
check('to begin with they can post in a channel under it', beforeCat === 'sent', beforeCat)

const catDenied = await setCategory(cat.id, 'role', everyone.id, { send_messages: false })
check('denying send on the category is accepted', catDenied.status === 200, catDenied.body)

const aRefused = await say(staffA.id, asMateSock)
const bRefused = await say(staffB.id, asMateSock)
check('every synced channel under it refuses', aRefused === 'refused' && bRefused === 'refused',
  [aRefused, bRefused])
const looseStillFine = await say(general.id, asMateSock)
check('and a channel outside the category is untouched', looseStillFine === 'sent', looseStillFine)

console.log('  --- one channel can step out of line without leaving the category ---')

const unsynced = await setChannel(staffB.id, 'role', squad.id, { send_messages: true })
check('editing one channel under a category is accepted', unsynced.status === 200, unsynced.body)
check('and it stops being synced', unsynced.body?.synced === false, unsynced.body?.synced)

const bNowPosts = await say(staffB.id, asMateSock)
check('the edited channel lets the allowed role post', bNowPosts === 'sent', bNowPosts)
const aStillRefuses = await say(staffA.id, asMateSock)
check('while its sibling still refuses', aStillRefuses === 'refused', aStillRefuses)

/*
 * The reason unsyncing copies rather than clearing. If it started from
 * nothing, this channel would have lost the category's denial the instant it
 * was edited - so @everyone would be able to post in it, which is the
 * opposite of what the edit asked for.
 */
const otherStillRefusedInB = await say(staffB.id, asOther)
check('and the category rule it inherited came with it',
  otherStillRefusedInB === 'refused', otherStillRefusedInB)

const resynced = await call(`/api/channels/${staffB.id}/permissions/sync`, {
  method: 'POST', body: JSON.stringify({ synced: true }),
}, host.token)
check('syncing it back is accepted', resynced.status === 200, resynced.body)
const bRefusesAgain = await say(staffB.id, asMateSock)
check('and it follows the category again', bRefusesAgain === 'refused', bRefusesAgain)

console.log('  --- a new channel under a locked category is locked from birth ---')

await setCategory(cat.id, 'role', everyone.id, { view_channels: false })
const born = await makeChannel('staff-c', cat.id)
const bornHidden = await history(born.id, mate.token)
check('a channel made under it is closed without anybody locking it',
  bornHidden.status === 403, bornHidden.status)

console.log('  --- deleting the heading does not take the rooms with it ---')

const gone = await call(`/api/categories/${cat.id}`, { method: 'DELETE' }, host.token)
check('the category is deleted', gone.status === 200, gone.body)
const survivors = await channelsFor(host.token)
check('the channels that were under it are still there',
  survivors.some((c) => c.id === staffA.id) && survivors.some((c) => c.id === born.id),
  survivors.map((c) => c.name))
const stillHidden = await history(born.id, mate.token)
check('and a channel that was closed by the heading is still closed',
  stillHidden.status === 403, stillHidden.status)

console.log('  --- who may write these rules ---')

// The precondition: Nipeno holds nothing that lets them near this.
const asMate = await setChannel(general.id, 'role', everyone.id, { send_messages: false }, mate.token)
check('somebody without manage roles cannot write an override', asMate.status === 403, asMate.status)

await call(`/api/roles/${squad.id}`, {
  method: 'PATCH', body: JSON.stringify({ permissions: ['manage_roles', 'view_channels', 'send_messages'] }),
}, host.token)

const mayNow = await setChannel(general.id, 'member', other.id, { send_messages: false }, mate.token)
check('with manage roles they can', mayNow.status === 200, mayNow.body)

/*
 * The rule that closes the escalation. manage_roles is a permission people
 * hand out; without this it is a way to mint every other permission one
 * channel at a time.
 */
const tooFar = await setChannel(general.id, 'member', other.id, { manage_messages: true }, mate.token)
check('but they cannot hand out a permission they do not hold themselves',
  tooFar.status === 403, tooFar.body?.error)

const aboveThem = await setChannel(general.id, 'member', host.id, { send_messages: false }, mate.token)
check('and they cannot write a rule about somebody above them',
  aboveThem.status === 403, aboveThem.body?.error)

asHost.close()
asMateSock.close()
asOther.close()

console.log(bad === 0 ? '\n  all good' : `\n  ${bad} FAILED`)
process.exitCode = bad === 0 ? 0 : 1
