/**
 * A conversation answers for itself, and nobody moderates anybody in one.
 *
 * A DM has no server, and until now that meant it had no answer either: the
 * permission lookup fell through to the oldest server, so what two people could
 * do inside their own private conversation was decided by the @everyone role
 * of the machine's original server - one neither of them need ever have
 * joined. Editing a role there silently changed what was possible inside
 * strangers' private messages.
 *
 * The sharp end was the owner. ownsSpace(user, null) also falls back to the
 * first server, so whoever owns it held every permission in every DM they
 * were in - including deleting the other person's messages - by inheritance
 * rather than by anybody's decision. Their moderators held it too, in their
 * own DMs with anyone.
 *
 * So the owner is the one this spec is really about. A check that only proves
 * an ordinary account cannot delete somebody else's message passes just as
 * well on the old code, because manage_messages was never in the defaults.
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

/** A socket that can send, delete and react, and hear the answer. */
const socket = (token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const waiting = []
  let ready = null
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready' && !ready) { ready = m; return resolve(api) }
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (waiting[i].match(m)) waiting.splice(i, 1)[0].done(m)
    }
  }
  const expect = (match, ms = 4000) => new Promise((done) => {
    const w = { match, done }
    waiting.push(w)
    setTimeout(() => {
      const i = waiting.indexOf(w)
      if (i >= 0) { waiting.splice(i, 1); done(null) }
    }, ms)
  })
  const api = {
    close: () => { try { ws.close() } catch { /* closed */ } },
    send: async (channelId, body) => {
      const nonce = 'n' + Math.random().toString(36).slice(2)
      const answer = expect((m) => (m.t === 'ack' || m.t === 'send-refused') && m.nonce === nonce)
      ws.send(JSON.stringify({ t: 'send', channelId, body, nonce }))
      const m = await answer
      return m?.t === 'ack' ? { sent: true, message: m.message } : { sent: false, why: m?.detail }
    },
    /* Deletion is refused in silence, so this waits briefly for the event
       that only arrives when it worked. */
    remove: async (messageId) => {
      const gone = expect((m) => m.t === 'message-delete' && m.id === messageId, 1500)
      ws.send(JSON.stringify({ t: 'delete', messageId }))
      return Boolean(await gone)
    },
    react: async (messageId, emoji) => {
      // The reaction arrives as the whole message again, not as an event of
      // its own - so this waits for that message to come back carrying it.
      const seen = expect((m) => m.t === 'message-update'
        && m.message?.id === messageId
        && (m.message.reactions ?? []).some((r) => r.emoji === emoji), 2500)
      ws.send(JSON.stringify({ t: 'react', messageId, emoji }))
      return Boolean(await seen)
    },
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
const mate = await reg('baileyyy', code)

// The precondition that makes the whole spec mean something: the host really
// does own the first server, so on the old code they had every permission
// everywhere by falling through to it.
const owns = (await call('/api/spaces', {}, host.token)).body.spaces
  .some((s) => s.id === space.id && s.owner_id === host.id)
check('the host owns the original server', owns !== false, { spaceId: space.id })

const dm = (await call('/api/dms', {
  method: 'POST', body: JSON.stringify({ userId: mate.id }),
}, host.token)).body
const channelId = dm?.channel?.id ?? dm?.id
check('a conversation can be opened', !!channelId, dm)

const asHost = await socket(host.token)
const asMate = await socket(mate.token)

console.log('  --- both people can take part ---')

const theirs = await asMate.send(channelId, 'evening')
check('the other person can talk in it', theirs.sent === true, theirs)
const mine = await asHost.send(channelId, 'evening yourself')
check('and so can the host', mine.sent === true, mine)

check('either of them can react', await asHost.react(theirs.message.id, '👍') === true)

const pinned = await call(`/api/messages/${theirs.message.id}/pin`, {
  method: 'POST', body: JSON.stringify({ pinned: true }),
}, host.token)
check('and pin what the other one said', pinned.status === 200, pinned.status)

console.log('  --- but nobody deletes what somebody else wrote ---')

const hostTried = await asHost.remove(theirs.message.id)
check('the host cannot delete the other person\'s message', hostTried === false)

const still = await call(`/api/channels/${channelId}/messages`, {}, mate.token)
const bodies = (still.body?.messages ?? []).map((m) => m.body)
check('and it is still there afterwards', bodies.includes('evening'), bodies)

const mateTried = await asMate.remove(mine.message.id)
check('and the other person cannot delete the host\'s', mateTried === false)

console.log('  --- and everybody can still delete their own ---')

const ownMessage = await asMate.send(channelId, 'said by mistake')
check('a message can be sent to take back', ownMessage.sent === true, ownMessage)
check('its author can delete it', await asMate.remove(ownMessage.message.id) === true)

const after = await call(`/api/channels/${channelId}/messages`, {}, mate.token)
const left = (after.body?.messages ?? []).map((m) => m.body)
check('and it really is gone', !left.includes('said by mistake'), left)
check('while everything else is untouched', left.includes('evening'), left)

console.log('  --- and a role in the first server changes none of it ---')

/*
 * The old coupling, exercised directly. Granting manage_messages to the
 * original server's @everyone used to reach inside every conversation on the
 * machine, including between people who are not in that server at all.
 */
const roles = (await call('/api/roles', {}, host.token)).body
const everyone = (roles.roles || roles).find((r) => r.kind === 'everyone')
const perms = typeof everyone.permissions === 'string'
  ? JSON.parse(everyone.permissions) : everyone.permissions
await call(`/api/roles/${everyone.id}`, {
  method: 'PATCH', body: JSON.stringify({ permissions: [...perms, 'manage_messages'] }),
}, host.token)
check('the first server now hands everyone manage_messages',
  !perms.includes('manage_messages'), perms)

const afterGrant = await asMate.send(channelId, 'still mine')
const reachedIn = await asHost.remove(afterGrant.message.id)
check('and it still does not reach into a conversation', reachedIn === false)

asHost.close()
asMate.close()

console.log(bad === 0 ? '\n  a conversation is between the two people in it' : `\n  ${bad} FAILED`)
process.exitCode = bad === 0 ? 0 : 1
