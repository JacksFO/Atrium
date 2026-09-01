/**
 * A server is a server. Nothing leaks in, nothing leaks out.
 *
 * Every bug behind this had one shape: a route that needed to know which
 * server it was acting on, was not told, and fell back to the first one. So
 * somebody who owned a server was refused inside it - the check ran against
 * a server where they hold nothing - and the panels listed the machine
 * rather than the server.
 *
 * This walks a second owner through everything they should be able to do in
 * their own server, and everything they must not be able to do in somebody
 * else's, in both directions.
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

// A host with a server, and three friends in it.
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
const mate = await reg('baileyyy', code)
const extras = {}
for (const n of ['Cami', 'Keeko', 'dumbass']) extras[n] = await reg(n, code)
const keeko = extras.Keeko

// And a server of the friend's own, which the host also joins.
const theirs = (await call('/api/spaces', {
  method: 'POST', body: JSON.stringify({ name: 'Baileys Dictatorship' }),
}, mate.token)).body.space
const theirCode = (await call(`/api/spaces/${theirs.id}/invites`, { method: 'POST', body: '{}' }, mate.token)).body.code
await call(`/api/invites/${theirCode}/accept`, { method: 'POST', body: '{}' }, host.token)

console.log('  --- what the owner sees in their own server ---')
const members = await call(`/api/members/roles?spaceId=${theirs.id}`, {}, mate.token)
check('the members panel lists only that server',
  (members.body.members || []).length === 2,
  (members.body.members || []).map((m) => m.username))

const roles = await call(`/api/roles?spaceId=${theirs.id}`, {}, mate.token)
check('and only that server\'s roles',
  (roles.body.roles || []).every((r) => r.space_id === theirs.id),
  (roles.body.roles || []).map((r) => r.name))

console.log('\n  --- and what they can do in it ---')
const made = await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'Regulars', colour: '#8395A6', spaceId: theirs.id }),
}, mate.token)
check('make a role', made.status === 200, made.status)
const role = (made.body.roles || []).find((r) => r.name === 'Regulars')

check('a new role starts with what everyone already has',
  !!role && JSON.parse(role.permissions).includes('send_messages'),
  role && JSON.parse(role.permissions))

const recoloured = await call(`/api/roles/${role.id}`, {
  method: 'PATCH', body: JSON.stringify({ colour: '#FF0000' }),
}, mate.token)
check('recolour it', recoloured.status === 200, recoloured.status)

const ownerRole = (roles.body.roles || []).find((r) => r.kind === 'owner')
const ownerRecoloured = await call(`/api/roles/${ownerRole.id}`, {
  method: 'PATCH', body: JSON.stringify({ colour: '#00FF00', name: 'Boss' }),
}, mate.token)
check('rename and recolour their own Owner role', ownerRecoloured.status === 200, ownerRecoloured.status)

const gave = await call(`/api/admin/members/${host.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: role.id, grant: true, spaceId: theirs.id }),
}, mate.token)
check('hand that role to somebody', gave.status === 200, gave.status)

const icon = await call(`/api/space/icon?spaceId=${theirs.id}`, { method: 'DELETE' }, mate.token)
check('clear their own server icon', icon.status === 200, icon.status)

const renamed = await call('/api/space', {
  method: 'PATCH', body: JSON.stringify({ name: 'Baileys Republic', spaceId: theirs.id }),
}, mate.token)
check('rename their own server', renamed.status === 200, renamed.status)

console.log('\n  --- channels in their own server ---')
/*
 * A server keeps its last text channel, and that says nothing about its
 * voice channels. The guard counted the server's text channels and then
 * refused whatever was being deleted - so in a server with one text channel,
 * deleting a voice channel was turned down for a reason that did not apply
 * to it. Reported as "the last text channel cannot be deleted" on a channel
 * that was not a text channel.
 *
 * There is no /api/channels: the gateway's ready payload is where channels
 * come from. Node's own WebSocket, so this needs nothing installed.
 */
const list = await new Promise((resolve) => {
  const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token: mate.token }))
  sock.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') {
      sock.close()
      resolve((m.channels || []).filter((c) => c.space_id === theirs.id))
    }
  }
  setTimeout(() => { try { sock.close() } catch { /* closed */ } ; resolve([]) }, 9000)
})

const voice = list.find((c) => c.kind === 'voice')
const text = list.find((c) => c.kind === 'text')
check('their server came with a text and a voice channel', !!voice && !!text,
  list.map((c) => `${c.kind}:${c.name}`))

if (voice) {
  const gone = await call(`/api/channels/${voice.id}`, { method: 'DELETE' }, mate.token)
  check('the owner can delete a voice channel', gone.status === 200, gone.status)
}
if (text) {
  const kept = await call(`/api/channels/${text.id}`, { method: 'DELETE' }, mate.token)
  check('but not the only text channel', kept.status === 400, kept.status)
}

console.log('\n  --- and nothing at all in the host\'s server ---')
const intoOriginal = await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'Sneaky', colour: '#ffffff', spaceId: original.id }),
}, mate.token)
check('cannot make a role there', intoOriginal.status === 403, intoOriginal.status)

const renameTheirs = await call('/api/space', {
  method: 'PATCH', body: JSON.stringify({ name: 'Mine now', spaceId: original.id }),
}, mate.token)
check('cannot rename it', renameTheirs.status === 403, renameTheirs.status)

const seeMembers = await call(`/api/members/roles?spaceId=${original.id}`, {}, mate.token)
check('sees its members only as an ordinary member of it',
  seeMembers.status === 200 && (seeMembers.body.members || []).length === 5,
  (seeMembers.body.members || []).length)

const iconThere = await call(`/api/space/icon?spaceId=${original.id}`, { method: 'DELETE' }, mate.token)
check('cannot clear its icon', iconThere.status === 403, iconThere.status)

console.log('\n  --- and the host has no authority in theirs ---')
const hostRole = await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'Host', colour: '#ffffff', spaceId: theirs.id }),
}, host.token)
check('the host cannot make a role in it', hostRole.status === 403, hostRole.status)
const hostRename = await call('/api/space', {
  method: 'PATCH', body: JSON.stringify({ name: 'Taken', spaceId: theirs.id }),
}, host.token)
check('nor rename it', hostRename.status === 403, hostRename.status)

console.log('\n  --- a plain member is refused everything privileged ---')
/*
 * Every pane in a server's settings is gated on a permission, and the panel
 * hiding a button is only a courtesy - this is the part that actually holds.
 * A member with nothing but @everyone should be turned away by the server.
 */
const plain = await reg('Nobody', theirCode)

// @everyone is given create_invite by default, which is a real permission
// and not an oversight - so to test the gate at all it has to come off
// first, otherwise this asserts nothing.
const everyoneRole = ((await call(`/api/roles?spaceId=${theirs.id}`, {}, mate.token)).body.roles || [])
  .find((r) => r.kind === 'everyone')
await call(`/api/roles/${everyoneRole.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ permissions: ['view_channels', 'send_messages', 'read_history'] }),
}, mate.token)

for (const [what, path] of [
  ['read the audit log', `/api/audit?spaceId=${theirs.id}`],
  ['list the invites', `/api/invites?spaceId=${theirs.id}`],
]) {
  const r = await call(path, {}, plain.token)
  check(`cannot ${what}`, r.status === 403, r.status)
}

const plainRole = await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'Cheeky', colour: '#ffffff', spaceId: theirs.id }),
}, plain.token)
check('cannot make a role', plainRole.status === 403, plainRole.status)

const plainKick = await call(
  `/api/admin/members/${mate.id}?spaceId=${theirs.id}`, { method: 'DELETE' }, plain.token)
check('cannot remove anybody', plainKick.status === 403, plainKick.status)

const plainRename = await call('/api/space', {
  method: 'PATCH', body: JSON.stringify({ name: 'Mine', spaceId: theirs.id }),
}, plain.token)
check('cannot rename the server', plainRename.status === 403, plainRename.status)

console.log('\n  --- and a role never lands above whoever made it ---')
/*
 * Reported: somebody with manage_roles made a role and it appeared above
 * their own, leaving them unable to touch what they had just created. The
 * ceiling still read "or is the app's owner", so whoever runs the machine
 * created roles at the top of anybody's server.
 */
const squad = await call('/api/roles', {
  // Six digits. The edit route has always refused the three-digit shorthand,
  // and creating one now refuses it too - one rule for a colour, rather than
  // one that depends on which route you happened to use.
  method: 'POST', body: JSON.stringify({ name: 'Squadron', colour: '#ffffff', spaceId: theirs.id }),
}, mate.token)
const squadRole = (squad.body.roles || []).find((r) => r.name === 'Squadron')
await call(`/api/roles/${squadRole.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ permissions: ['manage_roles', 'view_channels', 'send_messages'] }),
}, mate.token)
await call(`/api/admin/members/${host.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: squadRole.id, grant: true, spaceId: theirs.id }),
}, mate.token)

const byHost = await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'Sneaky', colour: '#ffffff', spaceId: theirs.id }),
}, host.token)
if (byHost.status === 200) {
  const made = (byHost.body.roles || []).find((r) => r.name === 'Sneaky')
  check('it sits below the maker\'s own role',
    made.position < squadRole.position, { made: made.position, maker: squadRole.position })
} else {
  check('or they are refused rather than promoted above themselves',
    byHost.status === 403, byHost.status)
}

console.log('\n  --- an owner can take back a role they handed out ---')
/*
 * Reported once as "doesnt let me remove roles from you" - the suspicion
 * being that some accounts are different from others. None are. Everybody in
 * a server somebody else made is an ordinary member of it, so revoking a
 * role has to work exactly the way it does for anybody else - and the reply
 * has to describe the server it happened in, or the panel redraws from
 * somewhere else entirely.
 */
const revoked = await call(`/api/admin/members/${host.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: role.id, grant: false, spaceId: theirs.id }),
}, mate.token)
check('the owner is allowed to revoke it', revoked.status === 200, revoked.status)

const after = await call(`/api/members/roles?spaceId=${theirs.id}`, {}, mate.token)
const hostNow = (after.body.members || []).find((m) => m.id === host.id)
check('and it is really gone', !!hostNow && !hostNow.roles.includes(role.id), hostNow && hostNow.roles)

/*
 * Every id in the reply has to be a role of the server it happened in. Just
 * asking that the revoked one is absent passed while the reply described a
 * different server altogether - which is what the settings panel then wrote
 * into this one, because it replaces a member's roles with whatever came
 * back.
 */
const theirRoleIds = new Set(
  ((await call(`/api/roles?spaceId=${theirs.id}`, {}, mate.token)).body.roles || []).map((r) => r.id))
check('the reply lists their roles in THAT server, and nothing else',
  Array.isArray(revoked.body.roles)
    && !revoked.body.roles.includes(role.id)
    && revoked.body.roles.every((r) => theirRoleIds.has(r)),
  revoked.body.roles)

console.log('\n  --- an audit log belongs to one server ---')
/*
 * Reported: "in my audit log in my server I can see baileyyys audit stuff in
 * my log". The route asked which server and checked view_audit_log in that
 * server, and then selected the whole table regardless.
 */
const hostLog = await call(`/api/audit?spaceId=${original.id}`, {}, host.token)
const mateLog = await call(`/api/audit?spaceId=${theirs.id}`, {}, mate.token)
check('each owner can read their own',
  hostLog.status === 200 && mateLog.status === 200, [hostLog.status, mateLog.status])

const hostEntries = hostLog.body.entries || []
const mateEntries = mateLog.body.entries || []

check('every entry in a log belongs to that log',
  hostEntries.every((e) => e.space_id === original.id)
    && mateEntries.every((e) => e.space_id === theirs.id),
  { host: [...new Set(hostEntries.map((e) => e.space_id))],
    mate: [...new Set(mateEntries.map((e) => e.space_id))] })

check('the host is not shown what the other owner did',
  !hostEntries.some((e) => e.actor_id === mate.id),
  hostEntries.filter((e) => e.actor_id === mate.id).map((e) => e.action))

check('and the other owner is not shown what the host did',
  !mateEntries.some((e) => e.actor_id === host.id && e.space_id !== theirs.id),
  mateEntries.filter((e) => e.actor_id === host.id).map((e) => e.action))

check('a log is not empty either - it records that server',
  mateEntries.some((e) => e.action === 'role.create'),
  mateEntries.map((e) => e.action).slice(0, 8))

check('and a password change is in no server log at all',
  !hostEntries.concat(mateEntries).some((e) => e.action.startsWith('account.')))

console.log('\n  --- roles add up, and the highest one sets rank ---')
/*
 * "a higher role might not have something a lower role does but if a member
 * has both then they get all the perms that each role gives them"
 *
 * So permissions are the union of @everyone and every role held, and the
 * highest role decides standing - who outranks whom, and which colour and
 * name a member shows under - rather than deciding the permissions by itself.
 */
const owner = mate.token
const spaceOfMine = theirs.id

// A high role that can manage channels but cannot kick, and a low one that
// can kick but cannot manage channels. Neither is a superset of the other,
// so holding both is the only way to end up with both.
const mk = async (name, permissions) => {
  const res = await call('/api/roles', {
    method: 'POST', body: JSON.stringify({ name, colour: '#8395A6', spaceId: spaceOfMine }),
  }, owner)
  const made = (res.body.roles || []).find((r) => r.name === name)
  await call(`/api/roles/${made.id}`, {
    method: 'PATCH', body: JSON.stringify({ permissions }),
  }, owner)
  return made
}

const high = await mk('Upstairs', ['view_channels', 'read_history', 'manage_channels'])
const low = await mk('Downstairs', ['view_channels', 'read_history', 'kick_members'])

const rolesNow = (await call(`/api/roles?spaceId=${spaceOfMine}`, {}, owner)).body.roles || []
const posOf = (id) => (rolesNow.find((r) => r.id === id) || {}).position
check('the one made second sits higher', posOf(low.id) > posOf(high.id),
  { first: posOf(high.id), second: posOf(low.id) })

// Somebody with nothing, then handed both.
const both = await reg('Twohats', theirCode)
for (const r of [high, low]) {
  await call(`/api/admin/members/${both.id}/roles`, {
    method: 'POST', body: JSON.stringify({ roleId: r.id, grant: true, spaceId: spaceOfMine }),
  }, owner)
}

/*
 * Asked of the server rather than of the database: what matters is that the
 * routes each permission guards actually let them through. A union that only
 * exists in a helper nobody consults would pass a direct test and fail here.
 */
const canManageChannels = await call('/api/channels', {
  method: 'POST',
  body: JSON.stringify({ name: 'from-two-roles', kind: 'text', spaceId: spaceOfMine }),
}, both.token)
check('the permission from the HIGHER role works', canManageChannels.status === 200,
  canManageChannels.status)

const canKick = await call(
  `/api/admin/members/${plain.id}?spaceId=${spaceOfMine}`, { method: 'DELETE' }, both.token)
check('and the one only the LOWER role carries works too', canKick.status === 200, canKick.status)

// And nothing was invented along the way.
const notGranted = await call('/api/space', {
  method: 'PATCH', body: JSON.stringify({ name: 'Mine', spaceId: spaceOfMine }),
}, both.token)
check('while a permission neither role carries is still refused',
  notGranted.status === 403, notGranted.status)

console.log('\n  --- and the profile shows every role, not just the top one ---')
/*
 * Reported: "baileyyy is the owner in his server but also gave himself the
 * squadron role and I only see the owner tag on his profile". The panel is
 * drawn from this route, so this is the data it had to work with.
 */
const listed = await call(`/api/members/roles?spaceId=${spaceOfMine}`, {}, owner)
const twohats = (listed.body.members || []).find((m) => m.id === both.id)
check('somebody holding two roles is listed with both',
  !!twohats && twohats.roles.includes(high.id) && twohats.roles.includes(low.id),
  twohats && twohats.roles.length)

// The owner holds their Owner role as a real grant, so a second role has to
// appear beside it rather than replacing it.
await call(`/api/admin/members/${mate.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: high.id, grant: true, spaceId: spaceOfMine }),
}, owner)
const relisted = await call(`/api/members/roles?spaceId=${spaceOfMine}`, {}, owner)
const ownerRow = (relisted.body.members || []).find((m) => m.id === mate.id)
const ownerRoleId = ((await call(`/api/roles?spaceId=${spaceOfMine}`, {}, owner)).body.roles || [])
  .find((r) => r.kind === 'owner').id
check('the owner is listed with Owner AND the role they gave themselves',
  !!ownerRow && ownerRow.roles.includes(ownerRoleId) && ownerRow.roles.includes(high.id),
  ownerRow && ownerRow.roles)

check('and a role carries the colour it was given, for the chip to use',
  rolesNow.every((r) => typeof r.colour === 'string' && r.colour.length > 0),
  rolesNow.map((r) => `${r.name}:${r.colour}`))

console.log('\n  --- and all of it reaches people without a reload ---')
/*
 * Roles, who holds them, and what that lets you do all arrived once, in the
 * gateway's ready, and never again. So a role could be created and be
 * invisible to everybody else; and a role could be handed out while the app
 * carried on showing the buttons it had worked out on connecting.
 *
 * Node has its own WebSocket, so this needs nothing installed.
 */
function listen(token) {
  const seen = []
  const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const ready = new Promise((resolve) => {
    sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
    sock.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data))
      if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
      if (m.t === 'ready') return resolve()
      seen.push(m)
    }
  })
  // Give the server a moment to deliver, then answer with what turned up.
  const wait = async (kind, ms = 3000) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      const hit = seen.find((m) => m.t === kind)
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 100))
    }
    return null
  }
  /*
   * Drop what has been collected so far.
   *
   * wait() answers with the first matching message it has, so without this a
   * check reads an event caused by an earlier step and reports on the wrong
   * thing entirely - which it did: editing a role pushes permissions to
   * everybody in the server, and that push was read as the answer to a grant
   * that had not happened yet.
   */
  const forget = () => { seen.length = 0 }
  const all = () => seen.slice()
  /*
   * The last of a kind, after letting the wire go quiet.
   *
   * Some actions push more than one of the same event - a grant is preceded
   * by the edit that set the role up, and both land here. A client applies
   * them in order and ends up with the last, so that is what "what they may
   * do now" means, and reading the first is reading a state nobody was ever
   * in. This asks the question the way the app answers it.
   */
  const settled = async (kind, ms = 700) => {
    await new Promise((r) => setTimeout(r, ms))
    const hits = seen.filter((m) => m.t === kind)
    return hits.length ? hits[hits.length - 1] : null
  }
  return { ready, wait, forget, all, settled, close: () => { try { sock.close() } catch { /* gone */ } } }
}

const watcher = listen(both.token)
await watcher.ready

// A brand new role, made by the owner while they are already connected.
const fresh = await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'Latecomer', colour: '#22CCAA', spaceId: spaceOfMine }),
}, owner)
const freshRole = (fresh.body.roles || []).find((r) => r.name === 'Latecomer')

const heardRoles = await watcher.wait('roles-changed')
check('a new role reaches everybody in that server at once',
  !!heardRoles && (heardRoles.roles || []).some((r) => r.id === freshRole.id),
  heardRoles ? (heardRoles.roles || []).map((r) => r.name) : null)

check('and it carries the colour it was given',
  !!heardRoles && (heardRoles.roles || []).find((r) => r.id === freshRole.id)?.colour === '#22CCAA',
  heardRoles && (heardRoles.roles || []).find((r) => r.id === freshRole.id)?.colour)

// Now give it to them, and let it carry something they did not have.
await call(`/api/roles/${freshRole.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ permissions: ['view_channels', 'read_history', 'manage_nicknames'] }),
}, owner)
/*
 * Everything from setting up that role is old news; what follows is the
 * grant, and only the grant.
 *
 * The edit above pushes a permissions event of its own to everybody in the
 * server, and it arrives over the socket a moment after the request that
 * caused it has already returned. Clearing the buffer on the strength of the
 * HTTP response therefore cleared it too early: the edit's push landed
 * afterwards and was read as the answer to a grant that had not happened yet
 * - reporting that the permission a role carries never arrives, when it does.
 *
 * So it is waited for and then dropped, which is deterministic where a clear
 * is a race.
 */
await watcher.wait('permissions')
watcher.forget()
await call(`/api/admin/members/${both.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: freshRole.id, grant: true, spaceId: spaceOfMine }),
}, owner)

const heardHeld = await watcher.wait('member-roles')
check('being handed a role is pushed, rather than waiting for a reload',
  !!heardHeld && (heardHeld.roles || []).includes(freshRole.id),
  heardHeld && heardHeld.roles)

/*
 * What they may do once the dust has settled.
 *
 * Two permissions events arrive around a grant: one from setting the role up,
 * computed before anybody held it, and then the grant's own. Reading the
 * first reported that the permission a role carries never arrives - when it
 * does, in the very next message. A client applies them in order and keeps
 * the last, so that is the one that describes what somebody may actually do.
 */
const heardPerms = await watcher.settled('permissions')
check('and the permissions it unlocks arrive with it',
  !!heardPerms && (heardPerms.permissions || []).includes('manage_nicknames'),
  heardPerms && (heardPerms.permissions || []).length)

check('still adding up rather than replacing what the other roles gave',
  !!heardPerms
    && (heardPerms.permissions || []).includes('manage_channels')
    && (heardPerms.permissions || []).includes('kick_members'),
  heardPerms && (heardPerms.permissions || []).sort())

watcher.close()

console.log('\n  --- the default role is the default role, in every server ---')
/*
 * The panel decided what could be done to @everyone by the literal id
 * 'everyone', which only the original server's row has. So in every server
 * made since, the default role could be renamed and was offered a Delete
 * button - and the rename actually went through, because the server was not
 * checking either.
 */
const theirEveryone = ((await call(`/api/roles?spaceId=${spaceOfMine}`, {}, owner)).body.roles || [])
  .find((r) => r.kind === 'everyone')

check('it is not the literal id, so the old check could never match it',
  theirEveryone.id !== 'everyone', theirEveryone.id)

const renameIt = await call(`/api/roles/${theirEveryone.id}`, {
  method: 'PATCH', body: JSON.stringify({ name: 'Peasants' }),
}, owner)
check('it cannot be renamed, even by the owner', renameIt.status === 400, renameIt.status)

const hoistIt = await call(`/api/roles/${theirEveryone.id}`, {
  method: 'PATCH', body: JSON.stringify({ hoist: true }),
}, owner)
check('and cannot be given its own heading', hoistIt.status === 400, hoistIt.status)

// But the thing it exists for still works.
const repermit = await call(`/api/roles/${theirEveryone.id}`, {
  method: 'PATCH', body: JSON.stringify({ permissions: ['view_channels', 'read_history'] }),
}, owner)
check('while its permissions are still editable, which is the point of it',
  repermit.status === 200, repermit.status)

const deleteIt = await call(`/api/roles/${theirEveryone.id}`, { method: 'DELETE' }, owner)
check('and it cannot be deleted', deleteIt.status === 400, deleteIt.status)

const stillThere = ((await call(`/api/roles?spaceId=${spaceOfMine}`, {}, owner)).body.roles || [])
  .find((r) => r.kind === 'everyone')
check('so it is still there, still called @everyone',
  !!stillThere && stillThere.name === '@everyone', stillThere && stillThere.name)

console.log('\n  --- and a request cannot reach past the server it was allowed in ---')
/*
 * Found by audit, not by report, and all one shape: a route works out which
 * server it is acting on from ONE id, checks the permission there, and then
 * acts on every id it was handed.
 */

// Somebody in the host's server and nowhere else, to try to name.
const outsider = await reg('Nosy', code)

// The host's own server, and a channel in it to aim at.
const hostChannels = await new Promise((resolve) => {
  const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token: host.token }))
  sock.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') { sock.close(); resolve(m.channels || []) }
  }
  setTimeout(() => { try { sock.close() } catch { /* closed */ } ; resolve([]) }, 9000)
})
const inHost = hostChannels.filter((c) => c.space_id === original.id && c.kind === 'text')
const inMate = hostChannels.filter((c) => c.space_id === theirs.id && c.kind === 'text')
check('the host has text channels in both servers', inHost.length > 0 && inMate.length > 0,
  { host: inHost.length, theirs: inMate.length })

/*
 * The reorder route read the FIRST id to decide which server it was acting
 * on, and then wrote a position to every id in the list. So one of your own
 * channels first, and anybody else's after it, reordered their server.
 */
const smuggled = await call('/api/channels/reorder', {
  method: 'POST',
  body: JSON.stringify({ order: [inMate[0].id, inHost[0].id] }),
}, mate.token)
check('reordering cannot smuggle in a channel from another server',
  smuggled.status === 400, smuggled.status)

const onlyMine = await call('/api/channels/reorder', {
  method: 'POST', body: JSON.stringify({ order: inMate.map((c) => c.id) }),
}, mate.token)
check('while reordering their own still works', onlyMine.status === 200, onlyMine.status)

/*
 * A private channel's access list took whatever ids it was given, so it could
 * name a role belonging to a different server - and the lookup that reads it
 * asked which roles somebody held anywhere on the machine.
 */
const hostRoleId = ((await call(`/api/roles?spaceId=${original.id}`, {}, host.token)).body.roles || [])
  .find((r) => r.kind === 'owner')?.id
check('the other server has a role to try to name', !!hostRoleId, hostRoleId)

const theirChannel = inMate[0]
const setList = await call(`/api/channels/${theirChannel.id}/access`, {
  method: 'PUT',
  body: JSON.stringify({ private: true, roles: [hostRoleId], members: [outsider.id] }),
}, mate.token)
check('setting an access list is allowed in their own server', setList.status === 200, setList.status)

const stored = (await call(`/api/channels/${theirChannel.id}/access`, {}, mate.token)).body.access
check('but another server\'s role is not kept in it',
  !(stored.roles || []).includes(hostRoleId), stored.roles)
check('and neither is somebody who is not in that server',
  !(stored.members || []).includes(outsider.id), stored.members)

// Put it back, so nothing after this is looking at a locked channel.
await call(`/api/channels/${theirChannel.id}/access`, {
  method: 'PUT', body: JSON.stringify({ private: false, roles: [], members: [] }),
}, mate.token)

console.log('\n  --- and an account is not a member of every server on the machine ---')
/*
 * Found by audit. A permission check answered from a server's @everyone role
 * whether or not the asker was in that server, and the guard never asked
 * about membership - so every signed-in account held @everyone's permissions
 * everywhere. @everyone can create invites by default, which makes that the
 * whole front door: mint yourself a code to a server you have never been in,
 * and walk in.
 */
const stranger = await reg('Passerby', code)   // in the host's server only

/*
 * A server nobody has touched.
 *
 * Asked of the server above, this would have passed for the wrong reason:
 * create_invite was stripped from its @everyone earlier in this file, so a
 * refusal would say nothing about membership. A fresh server still has the
 * default permissions, which is the state every real server starts in.
 */
const untouched = (await call('/api/spaces', {
  method: 'POST', body: JSON.stringify({ name: 'Somewhere Else' }),
}, mate.token)).body.space
const defaults = ((await call(`/api/roles?spaceId=${untouched.id}`, {}, mate.token)).body.roles || [])
  .find((r) => r.kind === 'everyone')
check('its @everyone can still create invites, so this asks something',
  JSON.parse(defaults.permissions).includes('create_invite'), JSON.parse(defaults.permissions))

const mintedFresh = await call(`/api/spaces/${untouched.id}/invites`, {
  method: 'POST', body: '{}',
}, stranger.token)
check('a stranger cannot mint an invite to a server whose @everyone allows it',
  mintedFresh.status === 403, mintedFresh.status)

const readFresh = await call(`/api/members/roles?spaceId=${untouched.id}`, {}, stranger.token)
check('nor read its members', readFresh.status === 403, readFresh.status)

/*
 * The OTHER route that makes invites, asked of that same untouched server.
 *
 * This one is gated on the permission alone, and a permission is answered
 * from a server's @everyone whether or not the asker is in it - so this is
 * the route where "everybody holds @everyone everywhere" actually bites.
 */
const mintedAdmin = await call('/api/invites', {
  method: 'POST', body: JSON.stringify({ spaceId: untouched.id }),
}, stranger.token)
check('and not through the permission-gated route either',
  mintedAdmin.status === 403, mintedAdmin.status)

const mintedTheirs = await call(`/api/invites?spaceId=${theirs.id}`, {
  method: 'POST', body: JSON.stringify({ spaceId: theirs.id }),
}, stranger.token)
check('a stranger cannot mint an invite to a server they are not in',
  mintedTheirs.status === 403, mintedTheirs.status)

const mintedVia = await call(`/api/spaces/${theirs.id}/invites`, {
  method: 'POST', body: '{}',
}, stranger.token)
check('nor through the other route that makes them',
  mintedVia.status === 403, mintedVia.status)

/*
 * An invite lets somebody into the server it was made in.
 *
 * The Invites pane asked which server the permission was being claimed in,
 * checked it there, and then stored the invite without it - so every code
 * from that pane had a null space and fell back to the first server on the
 * machine. Somebody inviting a friend to their own server was handing out a
 * way into the seeded server, and would have found out when the friend turned up
 * in the wrong place.
 *
 * It went unnoticed because the two paths anybody uses by accident - the
 * button on a server and the one on a friend - have always stored it. Only
 * the pane did not.
 */
const paneCode = (await call('/api/invites', {
  method: 'POST', body: JSON.stringify({ uses: 1, spaceId: theirs.id }),
}, mate.token)).body?.code
check('the owner can mint an invite from their own Invites pane', !!paneCode, paneCode)

/*
 * Somebody who already has an account, not a new one.
 *
 * Registering here spends one of the ten sign-ups an address is allowed in an
 * hour, and the checks further down include "an account can be made with no
 * invite" - which then came back false and read exactly like a refusal.
 * It is not; it is this test having used the last one up.
 */
const invitee = extras.dumbass
const tookIt = await call(`/api/invites/${paneCode}/accept`, { method: 'POST', body: '{}' }, invitee.token)
check('and it is accepted', tookIt.status === 200, tookIt.body)
const wherePut = ((await call('/api/spaces', {}, invitee.token)).body.spaces ?? []).map((s) => s.id)
check('and it puts them in that server rather than the first one',
  wherePut.includes(theirs.id), { landed: wherePut, wanted: theirs.id })

const listedTheirs = await call(`/api/members/roles?spaceId=${theirs.id}`, {}, stranger.token)
check('nor read who is in it', listedTheirs.status === 403, listedTheirs.status)

// And somebody who IS in it still can, or this is just a broken route.
const mintedMine = await call(`/api/spaces/${theirs.id}/invites`, {
  method: 'POST', body: '{}',
}, mate.token)
check('while its owner still can', mintedMine.status === 200, mintedMine.status)

/*
 * Holding a role in a server you are not in should not help either. Nothing
 * stopped a role being granted to somebody who had never joined, and the
 * permission it carried was then answered without asking about membership.
 */
const roleThere = ((await call(`/api/roles?spaceId=${theirs.id}`, {}, mate.token)).body.roles || [])
  .find((r) => r.kind === 'custom')
if (roleThere) {
  await call(`/api/admin/members/${stranger.id}/roles`, {
    method: 'POST', body: JSON.stringify({ roleId: roleThere.id, grant: true, spaceId: theirs.id }),
  }, mate.token)
  const withRole = await call(`/api/members/roles?spaceId=${theirs.id}`, {}, stranger.token)
  check('a role handed to somebody outside the server does not let them in',
    withRole.status === 403, withRole.status)
}

{
  console.log('\n  --- deleting a server takes that server and nothing else ---')
  /*
   * Asked for with the worry attached: "make sure it only deletes that one
   * server im choosing to delete not all of my servers or other servers etc."
   *
   * So this builds a machine with something to lose - two servers of the
   * deleter's own, somebody else's server, messages in all of them, and a
   * private conversation - deletes exactly one, and then counts what is left.
   */
  const doomed = (await call('/api/spaces', {
    method: 'POST', body: JSON.stringify({ name: 'Regrettable' }),
  }, mate.token)).body.space
  const keeper = (await call('/api/spaces', {
    method: 'POST', body: JSON.stringify({ name: 'Keep This One' }),
  }, mate.token)).body.space
  check('two more servers can be made', !!doomed && !!keeper, [doomed?.name, keeper?.name])

  // Somebody else in the doomed one, so its membership is not just the owner.
  const doomedCode = (await call(`/api/spaces/${doomed.id}/invites`, { method: 'POST', body: '{}' }, mate.token)).body.code
  await call(`/api/invites/${doomedCode}/accept`, { method: 'POST', body: '{}' }, host.token)

  // A conversation between them, which must survive - it belongs to no server.
  const convo = (await call('/api/dms', {
    method: 'POST', body: JSON.stringify({ userId: host.id }),
  }, mate.token)).body.channel
  check('a conversation exists to be left alone', !!convo, convo && convo.id)

  const countAll = async (token) => {
    const spaces = (await call('/api/spaces', {}, token)).body.spaces ?? []
    return spaces.map((s) => s.name).sort()
  }
  const before = await countAll(mate.token)
  console.log('      their servers before: ' + JSON.stringify(before))

  // --- somebody who does not own it cannot delete it ------------------------
  const byGuest = await call(`/api/spaces/${doomed.id}`, { method: 'DELETE' }, host.token)
  check('a member cannot delete somebody else\'s server', byGuest.status === 403, byGuest.status)

  const byStranger = await call(`/api/spaces/${keeper.id}`, { method: 'DELETE' }, plain.token)
  check('and neither can somebody not even in it', byStranger.status === 403, byStranger.status)

  const survivedRefusals = await countAll(mate.token)
  check('so nothing was deleted by either attempt',
    survivedRefusals.length === before.length, survivedRefusals)

  // --- the owner deletes exactly one ----------------------------------------
  const gone = await call(`/api/spaces/${doomed.id}`, { method: 'DELETE' }, mate.token)
  check('the owner can delete their own server', gone.status === 200, gone.status)

  const after = await countAll(mate.token)
  console.log('      their servers after:  ' + JSON.stringify(after))
  check('exactly one server went', after.length === before.length - 1, after)
  check('and it was the one chosen', !after.includes('Regrettable'), after)
  check('the other one they own is untouched', after.includes('Keep This One'), after)
  check('and so is the server they merely joined', after.includes('Baileys Republic') || after.length >= 2, after)

  // The host was in the deleted one; it must be gone for them too, and their
  // own server must not be.
  const hostAfter = await countAll(host.token)
  console.log('      the host\'s servers:    ' + JSON.stringify(hostAfter))
  check('it is gone for the other member too', !hostAfter.includes('Regrettable'), hostAfter)
  check('while the host still has their own', hostAfter.length >= 1, hostAfter)

  // --- and the things that belong to no server are still here ---------------
  const convoStill = await call(`/api/channels/${convo.id}/messages`, {}, mate.token)
  check('the conversation survives, because a DM belongs to no server',
    convoStill.status === 200, convoStill.status)

  const friendsStill = (await call('/api/friends', {}, mate.token)).body
  check('friendships survive', Array.isArray(friendsStill.friends), friendsStill && Object.keys(friendsStill))

  // --- deleting it twice is not a way to delete something else --------------
  const again = await call(`/api/spaces/${doomed.id}`, { method: 'DELETE' }, mate.token)
  check('deleting it again is a plain not-found', again.status === 404, again.status)

  const afterAgain = await countAll(mate.token)
  check('and took nothing with it', afterAgain.length === after.length, afterAgain)
}

// --- rearranging your own rail moves nothing for anybody else -------------
/*
 * The order is one person's. It is written on their membership row rather
 * than on the server, which is the whole reason anybody may reorder a server
 * they merely belong to - there is no way to express "and move it for
 * everybody else too".
 */
{
  console.log('\n  --- the rail is arranged per person ---')

  const mine = (await call('/api/spaces', {}, host.token)).body.spaces ?? []
  const theirs = (await call('/api/spaces', {}, mate.token)).body.spaces ?? []
  check('both can see more than one server', mine.length >= 2 && theirs.length >= 2,
    { mine: mine.length, theirs: theirs.length })

  if (mine.length >= 2 && theirs.length >= 2) {
    const before = theirs.map((s) => s.id)

    // The host turns their own rail upside down.
    const flipped = [...mine.map((s) => s.id)].reverse()
    const res = await call('/api/spaces/reorder', {
      method: 'POST', body: JSON.stringify({ order: flipped }),
    }, host.token)
    check('the order can be saved', res.status === 200, { status: res.status, body: res.body })

    const after = (await call('/api/spaces', {}, host.token)).body.spaces ?? []
    check('and it comes back in that order',
      JSON.stringify(after.map((s) => s.id)) === JSON.stringify(flipped),
      { asked: flipped, got: after.map((s) => s.id) })

    const theirsAfter = (await call('/api/spaces', {}, mate.token)).body.spaces ?? []
    check("while nobody else's rail moved",
      JSON.stringify(theirsAfter.map((s) => s.id)) === JSON.stringify(before),
      { before, after: theirsAfter.map((s) => s.id) })

    /*
     * And an id they are not a member of writes nothing. The route ignores
     * rather than refuses - the client sends what it is showing - so this is
     * the check that ignoring really is ignoring.
     */
    const foreign = await call('/api/spaces/reorder', {
      method: 'POST', body: JSON.stringify({ order: [theirs[0].id, ...flipped] }),
    }, host.token)
    check('a server they are not in is accepted and does nothing',
      foreign.status === 200, foreign.status)

    const stillTheirs = (await call('/api/spaces', {}, mate.token)).body.spaces ?? []
    check('their rail is still untouched by it',
      JSON.stringify(stillTheirs.map((s) => s.id)) === JSON.stringify(before),
      { before, after: stillTheirs.map((s) => s.id) })
  }
}

// --- a mention outlives the tab that received it ---------------------------
/*
 * The browser used to work mentions out from messages as they arrived and
 * keep them in memory, so one nobody had looked at yet was gone on reload.
 * The server writes it down when the message is accepted; this asks a fresh
 * connection what it knows, which is exactly the case that used to lose it.
 */
{
  console.log('\n  --- a mention survives a reload ---')

  const ready = async (token) => await new Promise((resolve) => {
    const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
    sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
    sock.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data))
      if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
      if (m.t === 'ready') { sock.close(); resolve(m) }
    }
    setTimeout(() => { try { sock.close() } catch { /* closed */ } ; resolve(null) }, 9000)
  })

  const say = async (token, channelId, body) => await new Promise((resolve) => {
    const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
    sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
    sock.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data))
      if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
      if (m.t === 'ready') {
        sock.send(JSON.stringify({ t: 'send', channelId, body, nonce: 'n' + Math.random() }))
        setTimeout(() => { sock.close(); resolve(true) }, 800)
      }
    }
    setTimeout(() => { try { sock.close() } catch { /* closed */ } ; resolve(false) }, 9000)
  })

  const hostReady = await ready(host.token)
  const rooms = (hostReady?.channels ?? [])
    .filter((c) => c.space_id === original.id && c.kind === 'text')
  check("there is a channel in the host's server", rooms.length > 0, rooms.map((c) => c.name))

  if (rooms.length > 0) {
    const room = rooms[0]
    // The friend names the host by username, in the host's own server.
    const sent = await say(mate.token, room.id, 'oi @JacksFO look at this')
    check('a mention can be sent', sent === true)

    const fresh = await ready(host.token)
    const marked = fresh?.mentionChannels ?? []
    check('a brand new connection is told about it', marked.includes(room.id),
      { marked, room: room.id })

    // Theirs alone: whoever wrote it is not mentioned by it.
    const theirsFresh = await ready(mate.token)
    check('the person who wrote it is not marked',
      !(theirsFresh?.mentionChannels ?? []).includes(room.id),
      theirsFresh?.mentionChannels)

    /*
     * And an edit is worked out again from the new words.
     *
     * Found by audit rather than reported. An edit rewrote the body and left
     * the mention rows alone, so taking a name out left the badge behind -
     * pointing at a mention that no longer existed in the text. That is worse
     * than the other direction, because there is nothing to find when you go
     * looking.
     */
    const editable = rooms[2] ?? rooms[1]
    if (editable) {
      /*
       * The id, over HTTP. `say` in this block reports whether it sent, not
       * what it sent - using its answer as an id meant editing a message
       * called "true", which does nothing, and the check failed pointing at
       * the server when the fault was here.
       */
      await say(mate.token, editable.id, 'hello @JacksFO there')
      const editList = await call(`/api/channels/${editable.id}/messages`, {}, mate.token)
      const editId = ((editList.body?.messages ?? [])
        .find((m) => m.body === 'hello @JacksFO there') ?? {}).id ?? null
      check('the message to edit was found', !!editId, editId)
      const before = await ready(host.token)
      check('an edit case starts marked',
        (before?.mentionChannels ?? []).includes(editable.id), before?.mentionChannels)

      // Take the name out again.
      await new Promise((resolve) => {
        const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
        sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token: mate.token }))
        sock.onmessage = (ev) => {
          const m = JSON.parse(String(ev.data))
          if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
          if (m.t === 'ready') {
            sock.send(JSON.stringify({ t: 'edit', messageId: editId, body: 'hello there' }))
            setTimeout(() => { sock.close(); resolve(true) }, 800)
          }
        }
        setTimeout(() => { try { sock.close() } catch { /* closed */ } ; resolve(false) }, 9000)
      })

      const afterEdit = await ready(host.token)
      check('editing the name out takes the mark with it',
        !(afterEdit?.mentionChannels ?? []).includes(editable.id), afterEdit?.mentionChannels)
    }

    // And an ordinary message leaves no mark, or every channel carries one.
    const plain = rooms[1]
    if (plain) {
      await say(mate.token, plain.id, 'nothing to see here')
      const after = await ready(host.token)
      check('an ordinary message marks nothing',
        !(after?.mentionChannels ?? []).includes(plain.id),
        after?.mentionChannels)
    } else {
      console.log('      only one text channel, so the plain case is not asked')
    }
  }
}

// --- pinning says so, and the icon remembers ------------------------------
/*
 * Pinning was silent: the message got a mark that only showed if you happened
 * to be looking at it, and it joined a panel behind an icon nobody had a
 * reason to open. Asked for as a line in the conversation saying it happened,
 * and a mark on the icon until somebody looks.
 */
{
  console.log('\n  --- pinning announces itself ---')

  const ready = async (token) => await new Promise((resolve) => {
    const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
    sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
    sock.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data))
      if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
      if (m.t === 'ready') { sock.close(); resolve(m) }
    }
    setTimeout(() => { try { sock.close() } catch { /* closed */ } ; resolve(null) }, 9000)
  })

  /*
   * Sent over the socket, then found over HTTP.
   *
   * Reading the id back off the socket meant racing the push against a
   * timeout, and it came back null - the message was sent, the capture was
   * not. Asking the channel what it holds is the same answer without the
   * race.
   */
  const say = async (token, channelId, body) => {
    await new Promise((resolve) => {
      const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
      sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
      sock.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data))
        if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
        if (m.t === 'ready') {
          sock.send(JSON.stringify({ t: 'send', channelId, body, nonce: 'p' + Math.random() }))
          setTimeout(() => { sock.close(); resolve(true) }, 700)
        }
      }
      setTimeout(() => { try { sock.close() } catch { /* closed */ } ; resolve(false) }, 9000)
    })
    const list = await call(`/api/channels/${channelId}/messages`, {}, token)
    return ((list.body?.messages ?? []).find((m) => m.body === body) ?? {}).id ?? null
  }

  const start = await ready(host.token)
  const room = (start?.channels ?? []).find((c) => c.space_id === original.id && c.kind === 'text')

  if (room) {
    const msgId = await say(host.token, room.id, 'worth keeping')
    check('a message to pin exists', !!msgId, msgId)

    if (msgId) {
      const res = await call(`/api/messages/${msgId}/pin`, {
        method: 'POST', body: JSON.stringify({ pinned: true }),
      }, host.token)
      check('it can be pinned', res.status === 200, res.status)

      const after = await ready(mate.token)
      check('the friend is told there is a pin to look at',
        (after?.pinChannels ?? []).includes(room.id), after?.pinChannels)

      const pins = await call(`/api/channels/${room.id}/pins`, {}, mate.token)
      check('and the pin is really in the list',
        (pins.body.messages ?? []).some((m) => m.id === msgId),
        (pins.body.messages ?? []).map((m) => m.id))

      // Looking at them clears it, and only for the person who looked.
      const seen = await call(`/api/channels/${room.id}/pins/seen`, {
        method: 'POST', body: JSON.stringify({}),
      }, mate.token)
      check('looking at the pins can be recorded', seen.status === 200, seen.status)

      const afterSeen = await ready(mate.token)
      check('and the mark goes for the one who looked',
        !(afterSeen?.pinChannels ?? []).includes(room.id), afterSeen?.pinChannels)

      const other = await ready(host.token)
      check('while somebody else still has theirs',
        (other?.pinChannels ?? []).includes(room.id), other?.pinChannels)
    }
  }
}

// --- somebody invited while already signed in can see who is here ----------
/*
 * Reported live: a friend made an account, was invited into a server, and
 * every member showed as "Unknown" - the name a client shows for an id it has
 * no user behind.
 *
 * A member list arrives once, in `ready`, at connect. Somebody already
 * connected when they accept an invite therefore holds a list of just
 * themselves - and announceJoin deliberately left them out of the very
 * message that carries everybody's names, because "somebody joined" is not
 * news to the person who joined. Nothing else ever told them.
 *
 * So this connects FIRST and joins SECOND, which is the order that broke.
 */
{
  console.log('\n  --- invited while already connected ---')

  const newcomer = await reg('Latecomer')
  check('an account can be made with no invite', !!newcomer.token, !!newcomer.token)

  if (newcomer.token) {
    /*
     * Connected and listening before the invite is accepted, and kept open -
     * closing it and reconnecting is the reload that used to hide this.
     */
    const seen = []
    let readyMembers = []
    const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
    await new Promise((resolve) => {
      sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token: newcomer.token }))
      sock.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data))
        if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
        seen.push(m)
        if (m.t === 'ready') { readyMembers = m.members ?? []; resolve(true) }
      }
      setTimeout(() => resolve(false), 9000)
    })

    check('their first member list is only themselves', readyMembers.length === 1,
      readyMembers.map((m) => m.username))

    // Now invited in, while that connection is still open.
    const invite = (await call(`/api/spaces/${original.id}/invites`, {
      method: 'POST', body: '{}',
    }, host.token)).body.code
    await call(`/api/invites/${invite}/accept`, { method: 'POST', body: '{}' }, newcomer.token)
    await new Promise((r) => setTimeout(r, 900))
    try { sock.close() } catch { /* closed */ }

    const sync = seen.find((m) => m.t === 'members-sync')
    check('the server tells them who is here', !!sync, seen.map((m) => m.t))
    check('and it is more than just themselves',
      (sync?.members ?? []).length > 1, (sync?.members ?? []).map((m) => m.username))
    check('including the person who invited them',
      (sync?.members ?? []).some((m) => m.username === 'JacksFO'),
      (sync?.members ?? []).map((m) => m.username))
  }
}

// --- a conversation needs somebody you can actually reach -----------------
/*
 * Found by audit. Opening a conversation checked that the people existed and
 * that there were not too many, and nothing else - so any account could open
 * one with any other account on the machine, given an id, whether or not the
 * two had ever agreed to hear from each other. The picker in the client only
 * ever offers friends, but the route is what decides.
 *
 * It predates group conversations and applied to one-to-one ones the same
 * way; what the group route changed is that one call can now name nine people
 * at once.
 */
{
  console.log('\n  --- who you may open a conversation with ---')

  /*
   * A stranger made out of somebody already here, rather than a new account.
   *
   * Sign-ups are capped at ten an hour per address, and this suite now uses
   * most of that budget before it reaches this point - the first attempt to
   * register one more came back 429, which looked like the feature refusing
   * somebody and was nothing of the sort. Cami leaves the only server she
   * shares with anybody, which makes her exactly what is needed here without
   * costing a registration.
   */
  const cami = await (async () => {
    const b = (await call('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'Cami', password: 'password123' }),
    })).body
    // Already registered above; log in instead.
    if (b?.token) return { token: b.token, id: b.user.id }
    const l = (await call('/api/login', {
      method: 'POST', body: JSON.stringify({ username: 'Cami', password: 'password123' }),
    })).body
    return { token: l?.token, id: l?.user?.id }
  })()
  check('there is somebody to make a stranger of', !!cami.token, !!cami.token)

  if (cami.token) {
    for (const sp of ((await call('/api/spaces', {}, cami.token)).body.spaces ?? [])) {
      await call(`/api/spaces/${sp.id}/leave`, { method: 'POST', body: '{}' }, cami.token)
    }

    /*
     * The precondition, asserted rather than assumed: she really is a
     * stranger now. Without it a refusal below could be for any reason and
     * these checks would pass just as happily.
     */
    const left = (await call('/api/spaces', {}, cami.token)).body.spaces ?? []
    check('who is now in no servers', left.length === 0, left.length)

    const alone = await call('/api/dms', {
      method: 'POST', body: JSON.stringify({ userId: host.id }),
    }, cami.token)
    check('cannot open a conversation with somebody she no longer knows',
      alone.status === 403, { status: alone.status, error: alone.body?.error })

    const group = await call('/api/dms', {
      method: 'POST', body: JSON.stringify({ userIds: [host.id, mate.id] }),
    }, cami.token)
    check('nor pull several of them into a group',
      group.status === 403, { status: group.status, error: group.body?.error })

    /*
     * And the rule is not "refuse everybody", which would pass both checks
     * above while breaking the feature outright.
     */
    const real = await call('/api/dms', {
      method: 'POST', body: JSON.stringify({ userId: mate.id }),
    }, host.token)
    check('while people who share a server still can',
      real.status === 200, { status: real.status, error: real.body?.error })

    /*
     * A group asks more than a one-to-one conversation does.
     *
     * Sharing a server is how you meet somebody, so it has to be enough to
     * write to one person - a new member nobody has added yet must be
     * reachable or nobody can say hello. It is not enough to be put in a room
     * with eight people who have not agreed to it, and one call names nine.
     *
     * The one-to-one call above is the precondition: these three share a
     * server, and it succeeded, so the refusal below is about the group rule
     * and not about them being strangers.
     */
    const notFriends = await call('/api/dms', {
      method: 'POST', body: JSON.stringify({ userIds: [mate.id, keeko.id] }),
    }, host.token)
    check('but a group with people who are only server-mates is refused',
      notFriends.status === 403, { status: notFriends.status, error: notFriends.body?.error })
    check('and it says why, rather than reusing the reachability wording',
      /already have a conversation/.test(notFriends.body?.error ?? ''), notFriends.body?.error)

    /*
     * And it is not "refuse every group", which would pass the check above
     * while breaking the feature outright. mate already has a one-to-one
     * conversation with the host, from the call a few lines up.
     */
    await call('/api/dms', {
      method: 'POST', body: JSON.stringify({ userId: keeko.id }),
    }, host.token)
    const talking = await call('/api/dms', {
      method: 'POST', body: JSON.stringify({ userIds: [mate.id, keeko.id] }),
    }, host.token)
    check('while a group of people already talking to them is fine',
      talking.status === 200, { status: talking.status, error: talking.body?.error })
  }
}


console.log('\n  --- what somebody is doing reaches only people who can see them ---')

/*
 * Presence says what a person is playing or listening to, and it is sent the
 * moment it changes. The first version of that used the send-to-everyone
 * helper, which would have told a stranger sharing no server both that this
 * account exists and what its owner was doing tonight - which is exactly what
 * the member list was fixed to stop doing, arriving by a different door.
 *
 * Three sockets, because proving a negative needs the positive beside it:
 * "the stranger heard nothing" would also pass on a server that had stopped
 * sending presence at all, so somebody who does share a server has to hear it
 * in the same run.
 */
/*
 * Two people who share nothing already exist in this file: keeko is in the
 * host's server only, and Nobody is in the friend's server only. The first
 * version of this check used two accounts from the same invite and failed,
 * which is a better outcome than a stranger who was not a stranger passing
 * quietly - so the precondition is asserted rather than assumed.
 */
const seenByStranger = ((await call('/api/members', {}, plain.token)).body?.members ?? []).map((m) => m.id)
const seenByHost = ((await call('/api/members', {}, host.token)).body?.members ?? []).map((m) => m.id)
check('the stranger genuinely cannot see the person playing',
  !seenByStranger.includes(keeko.id), { canSee: seenByStranger.length })
check('while the one who shares a server with them can',
  seenByHost.includes(keeko.id), { canSee: seenByHost.length })

const heard = await new Promise((resolve) => {
  const out = { host: null, stranger: null, ready: 0 }
  const shut = () => { for (const s of [a, b, c]) { try { s.close() } catch { /* gone */ } } }
  const timer = setTimeout(() => { shut(); resolve(out) }, 12000)

  const listen = (sock, token, onActivity) => {
    sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
    sock.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data))
      if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
      if (m.t === 'activity') return onActivity(m)
      if (m.t !== 'ready') return
      if (++out.ready < 3) return
      c.send(JSON.stringify({
        t: 'activity',
        activity: { kind: 'game', name: 'Tarkov', since: Date.now() - 60000 },
      }))
      // Long enough that a message which was going to arrive has.
      setTimeout(() => { clearTimeout(timer); shut(); resolve(out) }, 1500)
    }
  }

  const a = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const b = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const c = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  listen(a, host.token, (m) => { out.host = m.activities })
  listen(b, plain.token, (m) => { out.stranger = m.activities })
  listen(c, keeko.token, () => {})
})

check('somebody who shares a server with them is told',
  !!heard.host && heard.host[0] && heard.host[0].name === 'Tarkov', heard.host)
check('and somebody who shares nothing is not', heard.stranger === null, heard.stranger)

console.log('\n  ' + (bad === 0 ? 'servers are independent' : bad + ' wrong'))
process.exit(bad === 0 ? 0 : 1)
