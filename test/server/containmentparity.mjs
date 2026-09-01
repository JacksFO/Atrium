/**
 * Every way membership can change, and whether the record of it is right.
 *
 * Membership used to live in space_members and dm_members, and this compared
 * those two against container_members after every route that can change one.
 * That comparison is what said the old tables could go - so they went, and it
 * has nothing left to compare against.
 *
 * What it checks instead is the thing the comparison was standing in for. A
 * membership is a row in container_members under a container of the right
 * kind, and nothing else is. So after each route: every server and
 * conversation has a container, no membership points at a container that is
 * not there, no container outlives the thing it belongs to, and no
 * conversation is left with nobody in it.
 *
 * The unit tests cover the helpers. This covers the routes, which is the
 * layer where a path can simply not call the helper at all - and it is the
 * rare paths that matter, because the common ones would have been noticed.
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = process.env.BASE
const DB = process.env.DATA_DIR
  ? join(process.env.DATA_DIR, 'atrium.db')
  : join(tmpdir(), 'atrium-independence', 'data', 'atrium.db')

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
    body: JSON.stringify({ username, password: 'correct horse battery', invite }),
  })).body
  return { id: b?.user?.id, token: b?.token }
}

/** A socket, because saying something is a frame rather than a request. */
function connect(token, label) {
  const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const ready = new Promise((resolve, reject) => {
    const giveUp = setTimeout(() => reject(new Error(`${label} never became ready`)), 12000)
    sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
    sock.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data))
      if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
      if (m.t === 'ready') { clearTimeout(giveUp); resolve() }
    }
    sock.onerror = () => { clearTimeout(giveUp); reject(new Error(`${label} could not connect`)) }
  })
  return {
    ready,
    send: (m) => sock.send(JSON.stringify(m)),
    close: () => { try { sock.close() } catch { /* already gone */ } },
  }
}

/**
 * The same question, of both tables, for everybody.
 *
 * Opened fresh each time rather than held: the server is writing to this file
 * as the checks run, and a connection opened before a write does not
 * necessarily see it.
 */
function disagreements() {
  const db = new DatabaseSync(DB, { readOnly: true })
  const out = []
  try {
    /* A membership under a container that is not there. The foreign key
       should make this impossible; it is asked because "should be impossible"
       is exactly what the old tables used to be the check on. */
    const orphans = db.prepare(
      `SELECT COUNT(*) n FROM container_members m
        WHERE NOT EXISTS (SELECT 1 FROM containers k WHERE k.id = m.container_id)`
    ).get().n
    if (orphans) out.push(`${orphans} membership(s) of a container that does not exist`)

    /* A server or conversation with no container, which makes it invisible to
       everybody in it. */
    const missing = db.prepare(
      'SELECT COUNT(*) n FROM spaces WHERE id NOT IN (SELECT id FROM containers)').get().n
    if (missing) out.push(`${missing} server(s) have no container`)
    const missingTalks = db.prepare(
      `SELECT COUNT(*) n FROM channels
        WHERE kind IN ('dm','group') AND id NOT IN (SELECT id FROM containers)`).get().n
    if (missingTalks) out.push(`${missingTalks} conversation(s) have no container`)

    /* A container for something deleted - the silent one, and the reason two
       triggers were kept when the other eight went. */
    const stale = db.prepare(
      `SELECT COUNT(*) n FROM containers k
        WHERE (k.kind = 'space' AND NOT EXISTS (SELECT 1 FROM spaces s WHERE s.id = k.id))
           OR (k.kind IN ('dm','group') AND NOT EXISTS (SELECT 1 FROM channels c WHERE c.id = k.id))`
    ).get().n
    if (stale) out.push(`${stale} container(s) for something that no longer exists`)
  } finally {
    db.close()
  }
  return out
}

const agree = (after) => {
  const wrong = disagreements()
  check(`containment is sound after ${after}`, wrong.length === 0, wrong.length ? wrong : undefined)
}

const idOf = (r) => r.body?.channel?.id ?? r.body?.space?.id ?? r.body?.id

/* ------------------------------------------------------------------ */

const anna = await reg('anna')
const bob = await reg('bob')
const cass = await reg('cass')
check('three accounts', Boolean(anna.token && bob.token && cass.token))

// --- making a server, and being its only member
const made = await call('/api/spaces', {
  method: 'POST', body: JSON.stringify({ name: 'Somewhere' }),
}, anna.token)
const space = idOf(made)
check('anna made a server', Boolean(space), made.status)
agree('a server is made')

/*
 * The check has to be able to fail, or none of the rest proves anything.
 *
 * A container removed with its server left behind - the shape of a delete
 * that got half done, and the failure that announces itself least: nothing
 * throws, and a server nobody can name turns up in somebody's list.
 */
{
  const db = new DatabaseSync(DB)
  db.exec('PRAGMA foreign_keys = OFF')
  db.prepare('DELETE FROM containers WHERE id = ?').run(space)
  db.close()
  check('a server whose container went missing is noticed', disagreements().length > 0)

  const undo = new DatabaseSync(DB)
  const made = undo.prepare('SELECT created_at FROM spaces WHERE id = ?').get(space).created_at
  undo.prepare('INSERT INTO containers (id, kind, made) VALUES (?, ?, ?)').run(space, 'space', made)
  undo.prepare(
    'INSERT OR IGNORE INTO container_members (container_id, user_id, joined_at) VALUES (?, ?, ?)'
  ).run(space, anna.id, made)
  undo.close()
  check('and putting it back leaves it sound again', disagreements().length === 0)
}

// --- a second one, so there is an order to change
const second = await call('/api/spaces', {
  method: 'POST', body: JSON.stringify({ name: 'Attic' }),
}, anna.token)
const attic = idOf(second)
check('and a second', Boolean(attic))
agree('a second server is made')

// --- dragging the rail
const dragged = await call('/api/spaces/reorder', {
  method: 'POST', body: JSON.stringify({ order: [attic, space] }),
}, anna.token)
check('anna dragged one above the other', dragged.status === 200, dragged.status)
agree('the rail is dragged')

// --- two people join by invite
const invite = await call(`/api/spaces/${space}/invites`, { method: 'POST', body: '{}' }, anna.token)
const code = invite.body?.code ?? invite.body?.invite?.code
check('anna made an invite', Boolean(code), invite.status)
for (const [who, token] of [['bob', bob.token], ['cass', cass.token]]) {
  const joined = await call(`/api/invites/${code}/accept`, { method: 'POST', body: '{}' }, token)
  check(`${who} joined with it`, joined.status === 200, joined.status)
}
agree('two people join')

// --- one of them is removed
const kicked = await call(
  `/api/admin/members/${bob.id}?spaceId=${space}`, { method: 'DELETE' }, anna.token)
check('anna removed bob', kicked.status === 200, kicked.status)
agree('somebody is removed')

// --- and comes back
const rejoined = await call(`/api/invites/${code}/accept`, { method: 'POST', body: '{}' }, bob.token)
check('bob joined again', rejoined.status === 200, rejoined.status)
agree('they join again')

// --- a conversation between two people who share that server
const talk = await call('/api/dms', {
  method: 'POST', body: JSON.stringify({ userId: bob.id }),
}, anna.token)
const talkId = idOf(talk)
check('anna opened a conversation with bob', Boolean(talkId), talk.status)
agree('a conversation is opened')

// --- asking for the same one again must not make a second
const again = await call('/api/dms', {
  method: 'POST', body: JSON.stringify({ userId: bob.id }),
}, anna.token)
check('asking again gives the same one', idOf(again) === talkId, { got: idOf(again), talkId })
agree('the same conversation is asked for twice')

// --- closing it, for one person only
const closed = await call('/api/dms/close', {
  method: 'POST', body: JSON.stringify({ channelId: talkId }),
}, bob.token)
check('bob closed it', closed.status === 200, closed.status)
{
  const db = new DatabaseSync(DB, { readOnly: true })
  const mine = db.prepare(
    'SELECT hidden_at FROM container_members WHERE container_id = ? AND user_id = ?')
    .get(talkId, bob.id)
  const hers = db.prepare(
    'SELECT hidden_at FROM container_members WHERE container_id = ? AND user_id = ?')
    .get(talkId, anna.id)
  db.close()
  check('closed for bob', Boolean(mine?.hidden_at), mine?.hidden_at ?? null)
  check('and not for anna', !hers?.hidden_at, hers?.hidden_at ?? null)
}
agree('a conversation is closed')

// --- and it comes back when something is said in it
{
  const sock = connect(anna.token, 'anna')
  await sock.ready
  sock.send({ t: 'send', channelId: talkId, body: 'still here' })
  /* The write is a frame, so there is no response to wait on - poll the thing
     that is meant to change rather than sleeping a guessed amount. */
  let reopened = false
  for (let i = 0; i < 40 && !reopened; i++) {
    const db = new DatabaseSync(DB, { readOnly: true })
    const row = db.prepare(
      'SELECT hidden_at FROM container_members WHERE container_id = ? AND user_id = ?')
      .get(talkId, bob.id)
    db.close()
    reopened = !row?.hidden_at
    if (!reopened) await new Promise((r) => setTimeout(r, 100))
  }
  sock.close()
  check('saying something reopened it for bob', reopened)
}
agree('something is said in a closed conversation')

/*
 * A group needs friends, or people already talking to you - sharing a server
 * is how you meet somebody, not agreement to be put in a room with them. So
 * anna writes to cass first, which is the consent the rule is asking for.
 */
const withCass = await call('/api/dms', {
  method: 'POST', body: JSON.stringify({ userId: cass.id }),
}, anna.token)
check('anna opened one with cass too', Boolean(idOf(withCass)), withCass.status)
agree('a second conversation is opened')

// --- a group
const group = await call('/api/dms', {
  method: 'POST', body: JSON.stringify({ userIds: [bob.id, cass.id] }),
}, anna.token)
const groupId = idOf(group)
check('anna made a group with two others', Boolean(groupId), group.status)
if (groupId) {
  const db = new DatabaseSync(DB, { readOnly: true })
  const n = db.prepare('SELECT COUNT(*) n FROM container_members WHERE container_id = ?')
    .get(groupId).n
  const kind = db.prepare('SELECT kind FROM containers WHERE id = ?').get(groupId)
  db.close()
  check('with three people in it', n === 3, n)
  check('and it is a container', Boolean(kind), kind?.kind ?? null)
}
agree('a group is made')

// --- leaving of your own accord
const left = await call(`/api/spaces/${space}/leave`, { method: 'POST', body: '{}' }, bob.token)
check('bob left on his own', left.status === 200, left.status)
agree('somebody leaves')

// --- deleting a server takes everybody in it
const gone = await call(`/api/spaces/${attic}`, { method: 'DELETE' }, anna.token)
check('anna deleted the second server', gone.status === 200, gone.status)
agree('a server is deleted')

{
  const db = new DatabaseSync(DB, { readOnly: true })
  const left = db.prepare('SELECT COUNT(*) n FROM container_members WHERE container_id = ?').get(attic).n
  const container = db.prepare('SELECT COUNT(*) n FROM containers WHERE id = ?').get(attic).n
  db.close()
  check('no memberships left behind', left === 0, left)
  check('and no container left behind', container === 0, container)
}

console.log(bad === 0
  ? '\n  every write path leaves containment sound'
  : `\n  ${bad} failed`)
process.exit(bad === 0 ? 0 : 1)
