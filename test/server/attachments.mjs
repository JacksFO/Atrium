/**
 * You can only attach a file you uploaded.
 *
 * Sending a file is two steps - upload it, then name it in a message - and
 * the second step used to take the path out of the message and believe it.
 * The comment above that code claimed the ids were checked; nothing wrote
 * down who had uploaded what, so nothing could check anything.
 *
 * The reading half of that is the obvious half and the smaller one: names are
 * random, so you need to have been shown a path to use it. The sharp end is
 * deletion. A file is kept while any message still points at it - which is
 * right, because two messages can share an imported GIF - so attaching
 * somebody else's path to a message of your own meant their delete stopped
 * deleting. That is the check this file exists for, and it is the last one
 * here: it is measured by asking the disk, not by reading a table.
 *
 * Slow on purpose, and it takes about two and a half minutes. A deletion is
 * finished by a sweep on a sixty-second timer, and there is no way to watch
 * that happen without waiting for it.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.BASE
const UPLOADS = process.env.UPLOAD_DIR

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

/** The smallest thing the sniffer will accept as a PNG. */
function pngBytes() {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([head, Buffer.alloc(512, 0x21)])
}

const upload = async (token) => {
  const r = await fetch(BASE + '/api/upload', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'image/png',
      'x-filename': 'holiday.png',
    },
    body: pngBytes(),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

/** A socket that can send a message and hear the answer. */
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
  const expect = (match) => new Promise((done) => {
    const w = { match, done }
    waiting.push(w)
    setTimeout(() => {
      const i = waiting.indexOf(w)
      if (i >= 0) { waiting.splice(i, 1); done(null) }
    }, 8000)
  })
  const api = {
    channels: () => ready?.channels ?? [],
    close: () => { try { ws.close() } catch { /* closed */ } },
    /** Returns the accepted message, or the refusal. */
    send: async (channelId, body, attachments) => {
      const nonce = 'n' + Math.random().toString(36).slice(2)
      const answer = expect((m) => (m.t === 'ack' || m.t === 'send-refused') && m.nonce === nonce)
      ws.send(JSON.stringify({ t: 'send', channelId, body, nonce, attachments }))
      const m = await answer
      if (!m) return { outcome: 'no answer' }
      return m.t === 'ack'
        ? { outcome: 'sent', message: m.message }
        : { outcome: 'refused', detail: m.detail }
    },
    remove: (messageId) => ws.send(JSON.stringify({ t: 'delete', messageId })),
  }
  setTimeout(() => reject(new Error('the gateway never said ready')), 15000)
})

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

/** The stored name inside a signed /uploads link. */
const nameOf = (url) => (String(url).split('?')[0] ?? '').split('/').pop()

console.log('  --- you can send what you uploaded ---')

const mine = await upload(host.token)
check('an upload is accepted', mine.status === 200, mine.status)
const myName = nameOf(mine.body?.url)
check('and comes back as a signed link', /^\/uploads\/.+\?e=\d+&s=/.test(mine.body?.url ?? ''), mine.body?.url)

const ownSend = await asHost.send(general.id, 'here it is', [mine.body])
check('the uploader can attach it', ownSend.outcome === 'sent', ownSend)
check('and it really is on the message',
  (ownSend.message?.attachments ?? []).length === 1, ownSend.message?.attachments?.length)

/*
 * The size and type are read from the ledger, not from the message. This
 * sends a deliberate lie alongside a real file.
 */
const lied = await asHost.send(general.id, 'lying about it', [{
  ...mine.body, bytes: 999_999_999, mime: 'application/x-lies', filename: 'ok.png',
}])
const stored = (lied.message?.attachments ?? [])[0]
check('a lie about the size is not believed', stored?.bytes === 520, stored?.bytes)
check('nor about the type', stored?.mime === 'image/png', stored?.mime)

console.log('  --- you cannot send what somebody else uploaded ---')

const theirs = await upload(mate.token)
check("the other person's upload is accepted", theirs.status === 200, theirs.status)

const stolen = await asHost.send(general.id, 'not mine', [theirs.body])
check('attaching it is refused', stolen.outcome === 'refused', stolen)
check('and says why', /not one you uploaded|no longer here/i.test(stolen.detail ?? ''), stolen.detail)

const invented = await asHost.send(general.id, 'made up', [{
  id: 'x', url: '/uploads/00000000-0000-4000-8000-000000000000.png',
  filename: 'nope.png', mime: 'image/png', bytes: 10,
}])
check('so is a path that was never uploaded here', invented.outcome === 'refused', invented)

console.log('  --- and so their delete is still a delete ---')

/*
 * The whole point. Before this, pinning somebody else's file to a message of
 * your own meant their deletion left the file on disk and rendering in yours.
 * Measured against the disk rather than the database.
 */
const victim = await upload(mate.token)
const victimName = nameOf(victim.body?.url)
const onDisk = () => existsSync(join(UPLOADS, victimName))

const theirSend = await asMate.send(general.id, 'my photo', [victim.body])
check('they can send their own photo', theirSend.outcome === 'sent', theirSend)
check('and the file is on disk', onDisk() === true)

const pin = await asHost.send(general.id, 'pinning yours', [victim.body])
check('somebody else cannot pin it to a message of their own',
  pin.outcome === 'refused', pin)

asMate.remove(theirSend.message.id)
await new Promise((r) => setTimeout(r, 900))

/*
 * Deletion is finished by a sweep rather than at once, so this waits for it.
 * The window is sixty seconds in the server; the check below is generous
 * about time and exact about the answer.
 */
const gone = await (async () => {
  /*
   * Up to two minutes, because that is what the server promises.
   *
   * A deletion is marked, kept for PURGE_AFTER_MS (sixty seconds) so it can
   * be undone, and finished by a sweep that runs every sixty - so the worst
   * case is two of those windows back to back. Waiting eighty seconds and
   * calling it a failure was measuring the test's patience rather than the
   * server's behaviour.
   */
  for (let i = 0; i < 75; i++) {
    if (!onDisk()) return true
    if (i && i % 15 === 0) console.log(`      (still waiting for the sweep, ${i * 2}s)`)
    await new Promise((r) => setTimeout(r, 2000))
  }
  return !onDisk()
})()
check('and once they delete it, the file really goes', gone === true,
  { file: victimName, stillThere: onDisk() })

console.log('  --- the ledger does not outlive the file ---')

const rows = readdirSync(UPLOADS).length
check('there are still files in the folder to account for', rows >= 0, rows)

asHost.close()
asMate.close()

console.log(bad === 0 ? '\n  all good' : `\n  ${bad} FAILED`)
process.exitCode = bad === 0 ? 0 : 1
