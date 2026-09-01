/**
 * "That reaction is mine" is answered per person, from one hydration.
 *
 * A message is now built once and sent to everybody, because almost nothing
 * about it differs by who is reading it - the row is the row, and the signed
 * attachment links are the same for everyone. The single exception is whether
 * each reaction is one of yours, which forViewer answers from a set.
 *
 * That is exactly the thing the optimisation could get wrong, and it would be
 * quiet: everybody would see a reaction highlighted as theirs, or nobody
 * would, and the count would be right either way. So this checks the flags
 * from both sides of the same message at the same time.
 *
 * The reaction pushed to two people used to be two hydrations - two queries
 * each - and the whole point is that it is now one. Getting the same answer
 * from fewer queries is the claim; this is the part that says "the same".
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

/** A socket that keeps the last version of each message it was sent. */
const socket = (token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const latest = new Map()
  let ready = null
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }))
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready' && !ready) { ready = m; return resolve(api) }
    /*
     * ack as well as message: whoever sent it is answered rather than
     * pushed to, so the sender never receives a 'message' frame for their
     * own. The ack carries the same hydrated row.
     */
    if ((m.t === 'message' || m.t === 'message-update' || m.t === 'ack') && m.message) {
      latest.set(m.message.id, m.message)
    }
  }
  const api = {
    channels: () => ready?.channels ?? [],
    /** The reactions on a message, as this person was told them. */
    reactions: (id) => (latest.get(id)?.reactions ?? [])
      .map((r) => ({ emoji: r.emoji, count: r.count, me: r.me }))
      .sort((a, b) => a.emoji.localeCompare(b.emoji)),
    saw: (id) => latest.has(id),
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
const space = (await call('/api/spaces', { method: 'POST', body: JSON.stringify({ name: 'Test Server' }) }, host.token)).body.space
const code = (await call(`/api/spaces/${space.id}/invites`, { method: 'POST', body: '{}' }, host.token)).body.code
const mate = await reg('baileyyy', code)

const asHost = await socket(host.token)
const asMate = await socket(mate.token)
const general = asHost.channels().find((c) => c.kind === 'text')

const nonce = 'n' + Math.random().toString(36).slice(2)
asHost.send({ t: 'send', channelId: general.id, body: 'react to me', nonce })
await wait(700)

/* Find the id the honest way: ask the channel. */
const listed = await call(`/api/channels/${general.id}/messages`, {}, host.token)
const target = (listed.body?.messages ?? []).find((m) => m.body === 'react to me')
check('the message was sent', !!target?.id, listed.status)

check('both of them were told about it', asHost.saw(target.id) && asMate.saw(target.id),
  { host: asHost.saw(target.id), mate: asMate.saw(target.id) })

console.log('  --- one of them reacts ---')

asMate.send({ t: 'react', messageId: target.id, emoji: '🔥' })
await wait(700)

check('the person who reacted is told it is theirs',
  asMate.reactions(target.id).some((r) => r.emoji === '🔥' && r.me === true),
  asMate.reactions(target.id))
check('and the other person is told it is not',
  asHost.reactions(target.id).some((r) => r.emoji === '🔥' && r.me === false),
  asHost.reactions(target.id))
check('and both were told the same count',
  asMate.reactions(target.id).find((r) => r.emoji === '🔥')?.count === 1
  && asHost.reactions(target.id).find((r) => r.emoji === '🔥')?.count === 1,
  { mate: asMate.reactions(target.id), host: asHost.reactions(target.id) })

console.log('  --- and then the other one adds the same emoji ---')

asHost.send({ t: 'react', messageId: target.id, emoji: '🔥' })
await wait(700)

/*
 * The case that a single shared object gets wrong. One emoji, two people,
 * and it has to read as "mine" to both of them at once.
 */
const bothMate = asMate.reactions(target.id).find((r) => r.emoji === '🔥')
const bothHost = asHost.reactions(target.id).find((r) => r.emoji === '🔥')
check('it is theirs to the first person', bothMate?.me === true, bothMate)
check('and theirs to the second', bothHost?.me === true, bothHost)
check('and counted twice for both', bothMate?.count === 2 && bothHost?.count === 2,
  { mate: bothMate, host: bothHost })

console.log('  --- and a different emoji belongs to only one of them ---')

asHost.send({ t: 'react', messageId: target.id, emoji: '👍' })
await wait(700)

const thumbHost = asHost.reactions(target.id).find((r) => r.emoji === '👍')
const thumbMate = asMate.reactions(target.id).find((r) => r.emoji === '👍')
check('the one who added it sees it as theirs', thumbHost?.me === true, thumbHost)
check('and the one who did not, does not', thumbMate?.me === false, thumbMate)

/* The fire is still both, which a rebuilt-per-viewer list could lose. */
check('and the first emoji is still theirs to both',
  asMate.reactions(target.id).find((r) => r.emoji === '🔥')?.me === true
  && asHost.reactions(target.id).find((r) => r.emoji === '🔥')?.me === true,
  { mate: asMate.reactions(target.id), host: asHost.reactions(target.id) })

console.log('  --- and taking one back only takes back your own ---')

asMate.send({ t: 'react', messageId: target.id, emoji: '🔥' })
await wait(700)

const afterMate = asMate.reactions(target.id).find((r) => r.emoji === '🔥')
const afterHost = asHost.reactions(target.id).find((r) => r.emoji === '🔥')
check('it is no longer theirs to the one who removed it', afterMate?.me === false, afterMate)
check('but is still theirs to the one who did not', afterHost?.me === true, afterHost)
check('and the count came down by one', afterMate?.count === 1 && afterHost?.count === 1,
  { mate: afterMate, host: afterHost })

asHost.close()
asMate.close()

console.log(bad === 0 ? '\n  one hydration, and everybody is told the truth about themselves' : `\n  ${bad} FAILED`)
process.exitCode = bad === 0 ? 0 : 1
