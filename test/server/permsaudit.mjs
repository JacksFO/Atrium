/**
 * An audit of per-channel permissions, written to find the holes.
 *
 * The suite beside this one checks that the feature works. This one assumes
 * it does and goes looking for the places it does not reach - a switch in the
 * panel with nothing behind it, a rule that stops applying when somebody's
 * roles change, a row left behind by something that was deleted.
 *
 * Every check here was a suspicion first. The ones that pass are suspicions
 * that turned out to be wrong, and they stay because the next edit can make
 * them right again.
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
 * A connection that remembers what it was told.
 *
 * Half of what is being audited here is not whether the server refuses, but
 * whether the app is told in time. A rule that the server enforces and never
 * announces leaves somebody looking at a channel they can no longer open,
 * which reads as the app being broken rather than as the rule working.
 */
const gateway = (token) => new Promise((resolve, reject) => {
  const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const seen = []
  let ready = null
  sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
  sock.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready' && !ready) { ready = m; return resolve(api) }
    seen.push(m)
  }
  const api = {
    ready: () => ready,
    seen: () => seen,
    forget: () => { seen.length = 0 },
    close: () => { try { sock.close() } catch { /* already closed */ } },
  }
  setTimeout(() => reject(new Error('the gateway never said ready')), 15000)
})
const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms))

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
const mod = await reg('baileyyy', code)
const plain = await reg('Nipeno', code)

const roles = (await call(`/api/roles?spaceId=${space.id}`, {}, host.token)).body.roles
const everyone = roles.find((r) => r.kind === 'everyone')

const makeRole = async (name, permissions) => {
  const made = ((await call('/api/roles', {
    method: 'POST', body: JSON.stringify({ name, spaceId: space.id }),
  }, host.token)).body.roles ?? []).find((r) => r.name === name)
  await call(`/api/roles/${made.id}`, {
    method: 'PATCH', body: JSON.stringify({ permissions }),
  }, host.token)
  return made
}
const giveRole = (who, roleId) => call(`/api/admin/members/${who}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId, grant: true, spaceId: space.id }),
}, host.token)

const makeChannel = async (name) => (await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name, kind: 'text', spaceId: space.id }),
}, host.token)).body.channel

const setChannel = (channelId, kind, subjectId, rules, token = host.token) =>
  call(`/api/channels/${channelId}/permissions`, {
    method: 'PUT', body: JSON.stringify({ kind, subjectId, rules }),
  }, token)

// The staff role holds everything the panel lets a channel take away, so
// every refusal below is the channel's doing and not a missing permission.
const staff = await makeRole('staff', [
  'view_channels', 'manage_channels', 'manage_roles', 'send_messages',
  'attach_files', 'add_reactions', 'read_history', 'create_invite', 'manage_messages',
])
await giveRole(mod.id, staff.id)

console.log('  --- a switch in the panel has something behind it ---')

const office = await makeChannel('office')

// The precondition. Both of these have to be allowed before a denial proves
// anything: a 403 from somebody who never had the permission says nothing.
const canRenameFirst = await call(`/api/channels/${office.id}`, {
  method: 'PATCH', body: JSON.stringify({ topic: 'before' }),
}, mod.token)
check('to begin with they can edit the channel', canRenameFirst.status === 200, canRenameFirst.status)

const canRuleFirst = await setChannel(office.id, 'role', everyone.id, { add_reactions: false }, mod.token)
check('and they can write a rule in it', canRuleFirst.status === 200, canRuleFirst.status)

/*
 * Manage channel, denied in this channel.
 *
 * The panel offers the row, so the row has to do something. If renaming
 * still works, the switch is decoration - which is the exact failure the
 * comment above CHANNEL_PERMISSIONS says must not happen.
 */
await setChannel(office.id, 'role', staff.id, { manage_channels: false })
const renameAfter = await call(`/api/channels/${office.id}`, {
  method: 'PATCH', body: JSON.stringify({ topic: 'after' }),
}, mod.token)
check('denying Manage channel here stops them editing it',
  renameAfter.status === 403, renameAfter.status)

/*
 * Deleting is checked on a channel of its own.
 *
 * The first version of this used `office` for everything after it, so the
 * run where deleting was still allowed took the channel away and every check
 * below answered 404 - four failures reported as one fault, and none of them
 * saying what they were really about.
 */
const spare = await makeChannel('spare')
await setChannel(spare.id, 'role', staff.id, { manage_channels: false })
const deleteAfter = await call(`/api/channels/${spare.id}`, { method: 'DELETE' }, mod.token)
check('and stops them deleting it', deleteAfter.status === 403, deleteAfter.status)

/*
 * Manage permissions, denied in this channel.
 *
 * The one that matters most: if this does not hold, a channel cannot be
 * closed to a moderator at all, because they can simply reopen it.
 */
await setChannel(office.id, 'role', staff.id, { manage_channels: false, manage_roles: false })
const ruleAfter = await setChannel(office.id, 'role', everyone.id, { add_reactions: true }, mod.token)
check('denying Manage permissions here stops them rewriting the rules',
  ruleAfter.status === 403, ruleAfter.status)

const undoOwnDenial = await setChannel(office.id, 'role', staff.id, { manage_roles: true }, mod.token)
check('and they cannot lift the denial that is on them',
  undoOwnDenial.status === 403, undoOwnDenial.status)

console.log('  --- and you cannot hand yourself back what this channel took ---')

const quiet = await makeChannel('quiet')
await setChannel(quiet.id, 'role', staff.id, { send_messages: false })

/*
 * They hold send_messages across the server, and this channel has taken it
 * away from them. Allowing it back to themselves here is the loophole: the
 * rule that says "you can only give what you have" has to mean what you have
 * HERE, or every channel-level denial is advisory to anybody holding
 * manage_roles.
 */
const handBack = await setChannel(quiet.id, 'member', mod.id, { send_messages: true }, mod.token)
check('they cannot allow themselves what this channel denies them',
  handBack.status === 403, handBack.body?.error)

console.log('  --- a rule that is not about @everyone still moves the sidebar ---')

const lounge = await makeChannel('lounge')
const muted = await makeRole('muted', ['view_channels', 'read_history'])

const watching = await gateway(plain.token)
const before = watching.ready().channels.map((c) => c.id)
check('they can see the channel to begin with', before.includes(lounge.id), before.length)

// Not private - @everyone can still see it. One role cannot, which is a
// thing the panel lets you say and therefore a thing that has to work.
await setChannel(lounge.id, 'role', muted.id, { view_channels: false })
watching.forget()
await giveRole(plain.id, muted.id)
await settle()

const told = watching.seen().filter((m) => m.t === 'channel-deleted' && m.id === lounge.id)
check('being given a role that is denied view takes the channel off them',
  told.length === 1, watching.seen().map((m) => m.t))

const reallyShut = await call(`/api/channels/${lounge.id}/messages`, {}, plain.token)
check('and the server really has closed it to them', reallyShut.status === 403, reallyShut.status)
watching.close()

console.log('  --- a channel they cannot open is not named to them at all ---')

/*
 * Not the badge - the id.
 *
 * A client cannot draw a badge against a channel it does not have, so a leak
 * here shows up as nothing on screen and would have gone on doing so. What
 * arrives on the wire is a channel id somebody is not entitled to know
 * exists, with a count beside it saying how much is being said in it.
 */
const cellar = await makeChannel('cellar')

/**
 * Say something, as somebody, over the socket - and optionally mark a
 * channel read on the way out.
 *
 * Reading it first is what makes the unread check mean anything. A channel
 * nobody has ever opened has no read_state row, and the unread query only
 * counts a server channel against one - so the first version of this test
 * created no unread at all and passed with the filter deliberately removed.
 */
const overSocket = (token, work) => new Promise((done) => {
  const sock = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }))
  sock.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.t === 'ping') return sock.send(JSON.stringify({ t: 'pong' }))
    if (m.t !== 'ready') return
    for (const out of work) sock.send(JSON.stringify(out))
    setTimeout(() => { try { sock.close() } catch { /* closed */ } ; done(true) }, 900)
  }
  setTimeout(() => done(false), 12000)
})

// Read it, so there is a read mark for something newer to be measured
// against, then leave something newer and something naming them.
await overSocket(host.token, [{ t: 'send', channelId: cellar.id, body: 'first', nonce: 'a1' }])
await overSocket(plain.token, [{ t: 'read', channelId: cellar.id }])
await overSocket(host.token, [
  { t: 'send', channelId: cellar.id, body: 'second', nonce: 'a2' },
  { t: 'send', channelId: cellar.id, body: '@everyone look in here', nonce: 'a3' },
])

const openToThem = await gateway(plain.token)
const whileOpen = openToThem.ready()
/*
 * The precondition, and the part the first version of this got wrong. If
 * there is nothing unread and nothing naming them while the channel is open,
 * the check below is measuring an empty list against an empty list and would
 * pass with the filtering torn out.
 */
check('while it is open, its id really is in those lists', Boolean(
  (whileOpen.channels ?? []).some((c) => c.id === cellar.id)
  && (whileOpen.unread ?? []).some((u) => u.channelId === cellar.id)
  && (whileOpen.mentionChannels ?? []).includes(cellar.id)
), {
  channels: (whileOpen.channels ?? []).some((c) => c.id === cellar.id),
  unread: (whileOpen.unread ?? []).some((u) => u.channelId === cellar.id),
  mentions: (whileOpen.mentionChannels ?? []).includes(cellar.id),
})
openToThem.close()

await setChannel(cellar.id, 'role', everyone.id, { view_channels: false })

const shutOut = await gateway(plain.token)
const said = shutOut.ready()
const named = {
  inChannels: (said.channels ?? []).some((c) => c.id === cellar.id),
  inUnread: (said.unread ?? []).some((u) => u.channelId === cellar.id),
  inMentions: (said.mentionChannels ?? []).includes(cellar.id),
  inPins: (said.pinChannels ?? []).includes(cellar.id),
  inChannelPerms: Object.values(said.channelPermissions ?? {})
    .some((byChannel) => Object.keys(byChannel ?? {}).includes(cellar.id)),
}
check('once closed, its id is in none of the lists ready carries',
  Object.values(named).every((v) => v === false), named)
shutOut.close()

console.log('  --- nothing is left behind by a delete ---')

const attic = await makeChannel('attic')
const temp = await makeRole('temp', ['view_channels', 'send_messages'])
await setChannel(attic.id, 'role', temp.id, { send_messages: false })

const withRule = (await call(`/api/channels/${attic.id}/permissions`, {}, host.token)).body
check('the rule is there while the role is', (withRule?.overrides ?? []).length === 1, withRule)

await call(`/api/roles/${temp.id}`, { method: 'DELETE' }, host.token)
const afterRoleGone = (await call(`/api/channels/${attic.id}/permissions`, {}, host.token)).body
check('and goes when the role does',
  (afterRoleGone?.overrides ?? []).length === 0, afterRoleGone?.overrides)

const gone = await makeChannel('gone')
await setChannel(gone.id, 'role', everyone.id, { send_messages: false })
await call(`/api/channels/${gone.id}`, { method: 'DELETE' }, host.token)
const orphans = await call(`/api/channels/${gone.id}/permissions`, {}, host.token)
check('a deleted channel leaves no rules to be inherited',
  orphans.status === 404, orphans.status)

console.log('  --- the owner cannot be shut out of their own server ---')

const vault = await makeChannel('vault')
await setChannel(vault.id, 'role', everyone.id, { view_channels: false, send_messages: false })
const ownerStillIn = await call(`/api/channels/${vault.id}/messages`, {}, host.token)
check('the owner reads a channel that denies @everyone', ownerStillIn.status === 200, ownerStillIn.status)

/*
 * And a rule written about the owner by name does not bite either. Whoever
 * made a server holds every permission in it by definition - a member rule
 * that appeared to override that would be a panel telling a lie.
 */
await setChannel(vault.id, 'member', host.id, { view_channels: false })
const stillTheirs = await call(`/api/channels/${vault.id}/messages`, {}, host.token)
check('and one written about them by name changes nothing', stillTheirs.status === 200, stillTheirs.status)

console.log('  --- a stranger is refused before anything is looked up ---')

/*
 * 401, not 404.
 *
 * The category routes read the category before checking who was asking, so
 * an unauthenticated request was told whether an id exists. Nearly worthless
 * on its own - the ids are random - and an inconsistent front door: every
 * other route here refuses a stranger first. Found by poking the live server
 * after deploying it.
 */
for (const [what, path, opts] of [
  ['reading its permissions', `/api/categories/${'0'.repeat(8)}/permissions`, {}],
  ['writing them', `/api/categories/${'0'.repeat(8)}/permissions`,
    { method: 'PUT', body: JSON.stringify({ kind: 'role', subjectId: 'x', rules: {} }) }],
  ['renaming it', `/api/categories/${'0'.repeat(8)}`,
    { method: 'PATCH', body: JSON.stringify({ name: 'x' }) }],
  ['deleting it', `/api/categories/${'0'.repeat(8)}`, { method: 'DELETE' }],
]) {
  const anon = await call(path, opts)
  check(`a stranger ${what} is told to sign in, not whether it exists`,
    anon.status === 401, anon.status)
}

console.log('  --- rules belong to the server they were written in ---')

const theirs = (await call('/api/spaces', {
  method: 'POST', body: JSON.stringify({ name: 'Attic' }),
}, plain.token)).body.space
const theirRole = ((await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'attic-role', spaceId: theirs.id }),
}, plain.token)).body.roles ?? []).find((r) => r.name === 'attic-role')

const crossServer = await setChannel(office.id, 'role', theirRole.id, { send_messages: false })
check('a role from another server cannot be named in this one',
  crossServer.status === 400, crossServer.body?.error)

const outsider = await setChannel(office.id, 'member', plain.id, { send_messages: false }, plain.token)
check('and somebody with no standing here cannot write one at all',
  outsider.status === 403, outsider.status)

console.log(bad === 0 ? '\n  all good' : `\n  ${bad} FAILED`)
process.exitCode = bad === 0 ? 0 : 1
