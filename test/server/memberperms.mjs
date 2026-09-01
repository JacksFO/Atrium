/**
 * Giving one person one permission, without making a role for it.
 *
 * Asked for as "instead of giving them a role I can just give them some perms
 * I want to give them specifically", with a single private channel as the
 * example.
 *
 * Every check here is enforcement rather than reporting. A grant that shows
 * in the panel and changes nothing the server allows is the failure this is
 * looking for, so nothing is asserted by reading back the list that was just
 * written - the audit log is fetched, the channel is read, and the refusals
 * are made to name themselves.
 *
 * Preconditions are asserted, not assumed. Two of the refusals below can
 * happen for the wrong reason - rank rather than the rule being tested - and
 * a test that only counts 403s cannot tell them apart.
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
const staff = await reg('baileyyy', code)
const mate = await reg('Cami', code)

const grant = (who, permission, on) =>
  call(`/api/admin/members/${who}/permissions`, {
    method: 'POST', body: JSON.stringify({ permission, grant: on, spaceId: space.id }),
  }, host.token)

console.log('  --- a permission given to one person, and actually enforced ---')

/*
 * The precondition. Without this line a later 200 proves nothing: they might
 * have been able to read the log all along.
 */
const before = await call(`/api/audit?spaceId=${space.id}`, {}, mate.token)
check('to begin with they cannot read the audit log', before.status === 403, before.status)

const given = await grant(mate.id, 'view_audit_log', true)
check('the grant is accepted', given.status === 200, given.body)
check('and it says what they now have personally',
  (given.body?.permissions ?? []).includes('view_audit_log'), given.body)

const after = await call(`/api/audit?spaceId=${space.id}`, {}, mate.token)
check('and now the server lets them read it', after.status === 200, after.status)

const listed = await call(`/api/members/roles?spaceId=${space.id}`, {}, host.token)
const mateRow = (listed.body?.members ?? []).find((m) => m.id === mate.id)
check('the members panel shows it against them',
  (mateRow?.extras ?? []).includes('view_audit_log'), mateRow?.extras)

const taken = await grant(mate.id, 'view_audit_log', false)
check('taking it back is accepted', taken.status === 200, taken.body)
const afterTaken = await call(`/api/audit?spaceId=${space.id}`, {}, mate.token)
check('and the server refuses them again', afterTaken.status === 403, afterTaken.status)

console.log('  --- a role gives the same thing, and the personal grant is not what holds it ---')

/*
 * The case that would be a silent data loss: somebody has a permission twice,
 * once through a role and once personally, and turning off the personal one
 * takes it away entirely. Grants add; nothing here subtracts.
 */
const watchers = (await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'Watchers', spaceId: space.id }),
}, host.token)).body.roles.find((r) => r.name === 'Watchers')
await call(`/api/roles/${watchers.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ permissions: ['view_channels', 'read_history', 'view_audit_log'] }),
}, host.token)
await call(`/api/admin/members/${mate.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: watchers.id, grant: true, spaceId: space.id }),
}, host.token)

const byRole = await call(`/api/audit?spaceId=${space.id}`, {}, mate.token)
check('the role alone lets them read it', byRole.status === 200, byRole.status)

await grant(mate.id, 'view_audit_log', true)
await grant(mate.id, 'view_audit_log', false)
const stillByRole = await call(`/api/audit?spaceId=${space.id}`, {}, mate.token)
check('removing the personal grant leaves the role\'s copy alone',
  stillByRole.status === 200, stillByRole.status)

console.log('  --- what somebody with manage_roles may hand out ---')

/*
 * Staff is given rank as well as manage_roles, and that is the whole point of
 * this section. A member with no roles has position 0, and so does everybody
 * else with no roles - so every refusal below would happen anyway, for a
 * reason that has nothing to do with the rule being tested.
 */
const staffRole = (await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'Staff', spaceId: space.id }),
}, host.token)).body.roles.find((r) => r.name === 'Staff')
await call(`/api/roles/${staffRole.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ permissions: ['view_channels', 'read_history', 'send_messages', 'manage_roles'] }),
}, host.token)
await call(`/api/admin/members/${staff.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: staffRole.id, grant: true, spaceId: space.id }),
}, host.token)

const asStaff = (who, permission, on) =>
  call(`/api/admin/members/${who}/permissions`, {
    method: 'POST', body: JSON.stringify({ permission, grant: on, spaceId: space.id }),
  }, staff.token)

// The precondition for everything below: they really can use this route, so a
// refusal is about what they asked for and not about who they are.
const allowed = await asStaff(mate.id, 'add_reactions', true)
check('staff can give away something they hold', allowed.status === 200, allowed.body)

const notMine = await asStaff(mate.id, 'manage_space', true)
check('but not something they do not hold themselves', notMine.status === 403, notMine.status)
check('and it says so, rather than blaming rank',
  /do not have yourself/.test(notMine.body?.error ?? ''), notMine.body)

/*
 * Something they DO hold, deliberately.
 *
 * Asked with a permission they lack, this refusal has two possible causes and
 * the status code cannot tell them apart - it would pass with the rank check
 * deleted, on the strength of the other rule. add_reactions comes from
 * @everyone, so only rank can refuse this.
 */
const toSelf = await asStaff(staff.id, 'add_reactions', true)
check('and never to themselves', toSelf.status === 403, toSelf.body)

const upward = await asStaff(host.id, 'view_audit_log', true)
check('and never to the owner of the server', upward.status === 400, upward.status)

/*
 * And never upward to somebody who simply outranks them, which is a different
 * refusal from the owner's: the owner is turned away before rank is even
 * consulted, so testing only the owner leaves the ordinary case uncovered.
 */
const bossRole = (await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'Boss', spaceId: space.id }),
}, host.token)).body.roles.find((r) => r.name === 'Boss')
await call(`/api/admin/members/${mate.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: bossRole.id, grant: true, spaceId: space.id }),
}, host.token)
check('the precondition: Boss really does sit above Staff',
  bossRole.position > staffRole.position, [bossRole.position, staffRole.position])

const higher = await asStaff(mate.id, 'add_reactions', true)
check('and never to somebody who outranks them', higher.status === 403, higher.body)

const madeUp = await grant(mate.id, 'become_admin', true)
check('a permission that does not exist is refused', madeUp.status === 400, madeUp.body)

console.log('  --- letting one person into one private channel ---')

const secret = (await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name: 'plans', kind: 'text', spaceId: space.id }),
}, host.token)).body.channel
await call(`/api/channels/${secret.id}/access`, {
  method: 'PUT', body: JSON.stringify({ private: true, roles: [], members: [] }),
}, host.token)

const shut = await call(`/api/channels/${secret.id}/messages`, {}, mate.token)
check('a private channel is shut to them', shut.status === 403, shut.status)

const offered = await call(`/api/admin/members/${mate.id}/channels?spaceId=${space.id}`, {}, host.token)
check('it is offered on their row', (offered.body?.channels ?? []).some((c) => c.id === secret.id),
  offered.body?.channels)
check('and shown as not yet allowed',
  (offered.body?.channels ?? []).find((c) => c.id === secret.id)?.allowed === false,
  offered.body?.channels)

const letIn = await call(`/api/admin/members/${mate.id}/channels`, {
  method: 'POST', body: JSON.stringify({ channelId: secret.id, grant: true, spaceId: space.id }),
}, host.token)
check('letting them in is accepted', letIn.status === 200, letIn.body)

const open = await call(`/api/channels/${secret.id}/messages`, {}, mate.token)
check('and the channel opens to them', open.status === 200, open.status)

// Everybody else stays out. Naming one person is not the same as unlocking it.
const others = await call(`/api/channels/${secret.id}/messages`, {}, staff.token)
check('while everybody else stays out', others.status === 403, others.status)

const backOut = await call(`/api/admin/members/${mate.id}/channels`, {
  method: 'POST', body: JSON.stringify({ channelId: secret.id, grant: false, spaceId: space.id }),
}, host.token)
check('taking it back is accepted', backOut.status === 200, backOut.body)
const shutAgain = await call(`/api/channels/${secret.id}/messages`, {}, mate.token)
check('and the channel shuts again', shutAgain.status === 403, shutAgain.status)

/*
 * An open channel refuses the row rather than storing one nobody can see.
 * Left to be written, that row decides who keeps access the day somebody
 * makes the channel private - which is a rule nobody set.
 */
const general = (await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name: 'general-2', kind: 'text', spaceId: space.id }),
}, host.token)).body.channel
const pointless = await call(`/api/admin/members/${mate.id}/channels`, {
  method: 'POST', body: JSON.stringify({ channelId: general.id, grant: true, spaceId: space.id }),
}, host.token)
check('naming somebody on an open channel is refused', pointless.status === 400, pointless.body)

console.log('  --- and the channel appears without a reload ---')

/*
 * Through a real socket, because that is the part that was broken.
 *
 * Both routes that change a channel's access list pushed an "access-changed"
 * event, with a comment saying each client would ask again - and nothing in
 * the client listens for it, because there is no route to ask with: a channel
 * list only ever arrives in the gateway's ready. So the whole feature did
 * nothing until the person next reloaded, and every HTTP check above passed
 * while it did.
 */
const listen = (token, want, ms = 6000) => new Promise((done) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const heard = []
  const timer = setTimeout(() => { ws.close(); done({ ok: false, heard }) }, ms)
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token })))
  ws.addEventListener('message', (e) => {
    let m
    try { m = JSON.parse(e.data) } catch { return }
    if (m.t === 'ready') { heard.push('ready'); return }
    heard.push(m.t)
    if (want(m)) { clearTimeout(timer); ws.close(); done({ ok: true, message: m, heard }) }
  })
})

const watcher = await reg('dumbass', code)
const hush = (await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name: 'quiet', kind: 'text', spaceId: space.id }),
}, host.token)).body.channel
await call(`/api/channels/${hush.id}/access`, {
  method: 'PUT', body: JSON.stringify({ private: true, roles: [], members: [] }),
}, host.token)

const appears = listen(watcher.token, (m) => m.t === 'channel-created' && m.channel?.id === hush.id)
// A moment for the socket to say hello and be handed its ready, or the push
// happens before anybody is listening and this passes for the wrong reason
// in the other direction.
await new Promise((r) => setTimeout(r, 1500))
await call(`/api/admin/members/${watcher.id}/channels`, {
  method: 'POST', body: JSON.stringify({ channelId: hush.id, grant: true, spaceId: space.id }),
}, host.token)
const got = await appears
check('being let in puts the channel in their sidebar straight away', got.ok === true, got.heard)

const goes = listen(watcher.token, (m) => m.t === 'channel-deleted' && m.id === hush.id)
await new Promise((r) => setTimeout(r, 1500))
await call(`/api/admin/members/${watcher.id}/channels`, {
  method: 'POST', body: JSON.stringify({ channelId: hush.id, grant: false, spaceId: space.id }),
}, host.token)
const gone = await goes
check('and taking it back removes it again', gone.ok === true, gone.heard)

/*
 * And nobody else hears about it. The old event went to everybody in the
 * server holding view_channels, which handed the id of a private channel to
 * people with no way into it - the same shape as the role-mention leak.
 */
const quiet = listen(mate.token, (m) => /channel-(created|deleted)/.test(m.t) && (m.channel?.id === hush.id || m.id === hush.id), 3500)
await new Promise((r) => setTimeout(r, 1500))
await call(`/api/admin/members/${watcher.id}/channels`, {
  method: 'POST', body: JSON.stringify({ channelId: hush.id, grant: true, spaceId: space.id }),
}, host.token)
const bystander = await quiet
check('while somebody with no way into it hears nothing at all',
  bystander.ok === false && bystander.heard.every((t) => t === 'ready'), bystander.heard)

console.log('  --- and a role that unlocks a channel does the same ---')

/*
 * The likeliest version of the same silence, and the one nobody would have
 * connected to this: a role is usually how somebody gets into a private
 * channel, and handing one over put nothing in their sidebar either. Same
 * cause - the channel list only arrives in ready - and it has been true for
 * as long as private channels have.
 */
const vault = (await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name: 'vault', kind: 'text', spaceId: space.id }),
}, host.token)).body.channel
const keyRole = (await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'Keyholder', spaceId: space.id }),
}, host.token)).body.roles.find((r) => r.name === 'Keyholder')
await call(`/api/channels/${vault.id}/access`, {
  method: 'PUT', body: JSON.stringify({ private: true, roles: [keyRole.id], members: [] }),
}, host.token)

const shutOut = await call(`/api/channels/${vault.id}/messages`, {}, watcher.token)
check('the channel is shut to somebody without the role', shutOut.status === 403, shutOut.status)

const byRoleArrives = listen(watcher.token,
  (m) => m.t === 'channel-created' && m.channel?.id === vault.id)
await new Promise((r) => setTimeout(r, 1500))
await call(`/api/admin/members/${watcher.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: keyRole.id, grant: true, spaceId: space.id }),
}, host.token)
const arrived = await byRoleArrives
check('being given the role puts the channel in their sidebar', arrived.ok === true, arrived.heard)

const byRoleGoes = listen(watcher.token, (m) => m.t === 'channel-deleted' && m.id === vault.id)
await new Promise((r) => setTimeout(r, 1500))
await call(`/api/admin/members/${watcher.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: keyRole.id, grant: false, spaceId: space.id }),
}, host.token)
const went = await byRoleGoes
check('and taking the role back removes it', went.ok === true, went.heard)

console.log('  --- and losing access to a voice channel ends the call ---')

/*
 * Being in a voice channel is held in memory in the gateway and nowhere else,
 * so taking somebody off a private channel's list took the entry out of their
 * sidebar and left them sitting in the call, talking. The list said they were
 * out and the room said they were in.
 */
const booth = (await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name: 'booth', kind: 'voice', spaceId: space.id }),
}, host.token)).body.channel
await call(`/api/channels/${booth.id}/access`, {
  method: 'PUT', body: JSON.stringify({ private: true, roles: [], members: [watcher.id] }),
}, host.token)

const call_ = { joined: false, kicked: false, heard: [] }
await new Promise((done) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const timer = setTimeout(() => { try { ws.close() } catch {} ; done() }, 12000)
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token: watcher.token })))
  ws.addEventListener('message', async (e) => {
    let m
    try { m = JSON.parse(e.data) } catch { return }
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') return ws.send(JSON.stringify({ t: 'voice-join', channelId: booth.id }))
    call_.heard.push(m.t)

    /*
     * The precondition, in band: the server has to say they are in the
     * channel before being turned out of it can mean anything. Without it a
     * missing voice-kick and a join that never happened look identical.
     */
    if (m.t === 'voice-state' && !call_.joined) {
      const here = (m.occupants ?? []).some(
        (o) => o.userId === watcher.id && o.channelId === booth.id)
      if (!here) return
      call_.joined = true
      await call(`/api/admin/members/${watcher.id}/channels`, {
        method: 'POST',
        body: JSON.stringify({ channelId: booth.id, grant: false, spaceId: space.id }),
      }, host.token)
      return
    }

    if (m.t === 'voice-kick') {
      call_.kicked = true
      clearTimeout(timer)
      try { ws.close() } catch {}
      done()
    }
  })
})
check('they were really in the call first', call_.joined === true, call_.heard)
check('and losing access turns them out of it', call_.kicked === true, call_.heard)

console.log('  --- pinning is its own permission ---')

/*
 * It used to ride on manage_messages, which is "delete anybody's messages" -
 * so the only way to let somebody pin was to let them delete. Asked for as
 * allowing people and roles to pin, unpin, and clear up the line saying so.
 */
const chans = (await call(`/api/members/roles?spaceId=${space.id}`, {}, host.token)).status
check('the server is reachable for this section', chans === 200, chans)

const said = await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name: 'noticeboard', kind: 'text', spaceId: space.id }),
}, host.token)
const board = said.body.channel

/*
 * A message to pin, said over the gateway - the only way to send one - and
 * then read back over HTTP rather than picked out of the socket. What the
 * push looks like is not what is being tested here, and depending on its
 * shape is how this first came back holding nothing at all.
 */
await new Promise((done) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const timer = setTimeout(() => { try { ws.close() } catch {} ; done() }, 9000)
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token: host.token })))
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t !== 'ready') return
    ws.send(JSON.stringify({ t: 'send', channelId: board.id, body: 'worth keeping', nonce: 'pin-1' }))
    setTimeout(() => { clearTimeout(timer); try { ws.close() } catch {} ; done() }, 1200)
  })
})
const posted = (await call(`/api/channels/${board.id}/messages`, {}, host.token)).body?.messages ?? []
const msgId = posted.find((m) => m.body === 'worth keeping')?.id
check('there is something to pin', !!msgId, { found: posted.length, msgId })

/*
 * The precondition. This account holds no permission of its own, so a
 * refusal below is about the permission rather than about them being a
 * stranger to the server.
 */
const nope = await call(`/api/messages/${msgId}/pin`, {
  method: 'POST', body: JSON.stringify({ pinned: true }),
}, watcher.token)
check('somebody with nothing cannot pin', nope.status === 403, nope.status)

await grant(watcher.id, 'manage_pins', true)
const yes = await call(`/api/messages/${msgId}/pin`, {
  method: 'POST', body: JSON.stringify({ pinned: true }),
}, watcher.token)
check('and can once given the pin permission', yes.status === 200, yes.body)

/*
 * And it is genuinely the lighter permission: pinning must not have quietly
 * handed them the ability to delete everybody else's messages.
 */
const stillCannotModerate = await call(`/api/audit?spaceId=${space.id}`, {}, watcher.token)
check('without having been given anything else', stillCannotModerate.status === 403,
  stillCannotModerate.status)

const unpin = await call(`/api/messages/${msgId}/pin`, {
  method: 'POST', body: JSON.stringify({ pinned: false }),
}, watcher.token)
check('and can unpin again', unpin.status === 200, unpin.status)

/*
 * The heavier permission still allows it, so nobody who could pin this
 * morning has lost the ability.
 */
const byModerator = await call(`/api/messages/${msgId}/pin`, {
  method: 'POST', body: JSON.stringify({ pinned: true }),
}, host.token)
check('and managing messages still allows it', byModerator.status === 200, byModerator.status)

/*
 * Clearing up the line that says somebody pinned.
 *
 * That line is the one message nobody wrote, and tidying it away is what the
 * pin permission promises. Deleting goes over the gateway, which knew only
 * about manage_messages - so the menu appeared, the click did nothing, and
 * the app looked broken rather than saying no.
 *
 * Both halves, because the interesting part is the boundary: the notice yes,
 * and a message somebody actually said still no. A permission that let its
 * holder delete the notice by also letting them delete everything would pass
 * the first check on its own.
 */
const notice = ((await call(`/api/channels/${board.id}/messages`, {}, host.token)).body?.messages ?? [])
  .find((m) => m.kind === 'pin' && m.author_id !== watcher.id)
check('the pin left a line saying so, written by somebody else',
  !!notice && notice.author_id === host.id, notice?.id)

const asked = (token, messageId) => new Promise((done) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const timer = setTimeout(() => { try { ws.close() } catch {} ; done() }, 9000)
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token })))
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t !== 'ready') return
    ws.send(JSON.stringify({ t: 'delete', messageId }))
    // The gateway ignores what it will not do rather than answering, so the
    // result is read back from the channel afterwards rather than waited for.
    setTimeout(() => { clearTimeout(timer); try { ws.close() } catch {} ; done() }, 1200)
  })
})

await asked(watcher.token, notice.id)
const afterNotice = (await call(`/api/channels/${board.id}/messages`, {}, host.token)).body?.messages ?? []
check('the pin permission can clear that line',
  !afterNotice.some((m) => m.id === notice.id), afterNotice.map((m) => m.kind))

await asked(watcher.token, msgId)
const afterReal = (await call(`/api/channels/${board.id}/messages`, {}, host.token)).body?.messages ?? []
check('but not what somebody actually said',
  afterReal.some((m) => m.id === msgId), afterReal.map((m) => m.body))

console.log('  --- moved into a channel they cannot see ---')

/*
 * Asked for as: if somebody in a channel can move members, they should be
 * able to move in somebody who does not have access to it.
 *
 * It used to be refused, on the grounds that moving somebody somewhere they
 * cannot see strands them there. That was true, and the thing to fix. Being
 * placed in a call is the permission to be in it now, and it lasts exactly as
 * long as they are there.
 */
const vip = (await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name: 'staff-room', kind: 'voice', spaceId: space.id }),
}, host.token)).body.channel
await call(`/api/channels/${vip.id}/access`, {
  method: 'PUT', body: JSON.stringify({ private: true, roles: [], members: [] }),
}, host.token)
const lobby = (await call('/api/channels', {
  method: 'POST', body: JSON.stringify({ name: 'lobby', kind: 'voice', spaceId: space.id }),
}, host.token)).body.channel

// The precondition. Without it the 200 below proves only that they could
// always get in.
const closedToThem = await call('/api/voice/token', {
  method: 'POST', body: JSON.stringify({ channelId: vip.id }),
}, mate.token)
check('they cannot get into the private room on their own', closedToThem.status === 403, closedToThem.status)

/*
 * Both ends on real sockets: the move needs them to already be in a call,
 * which is state the gateway holds and nothing else can set.
 *
 * Their socket stays open past the end of this, and is closed at the bottom
 * of the section instead. Being placed somewhere lasts exactly as long as
 * they are in the call, so hanging up is what ends it - and closing the
 * socket here raced the token request below and failed about one run in
 * three, which read as the feature being broken rather than the test
 * hanging up on itself.
 */
const theirs = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
const mine = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
const moved = await new Promise((done) => {
  const state = { inLobby: false, told: null }
  const timer = setTimeout(() => done(state), 12000)

  let ready = 0
  const bothReady = () => {
    if (++ready < 2) return
    theirs.send(JSON.stringify({ t: 'voice-join', channelId: lobby.id }))
  }

  theirs.addEventListener('open', () => theirs.send(JSON.stringify({ t: 'hello', token: mate.token })))
  mine.addEventListener('open', () => mine.send(JSON.stringify({ t: 'hello', token: host.token })))
  mine.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.t === 'ping') return mine.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') bothReady()
  })
  theirs.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.t === 'ping') return theirs.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') return bothReady()
    if (m.t === 'voice-state' && !state.inLobby) {
      const here = (m.occupants ?? []).some((o) => o.userId === mate.id && o.channelId === lobby.id)
      if (!here) return
      state.inLobby = true
      mine.send(JSON.stringify({ t: 'voice-move-member', userId: mate.id, channelId: vip.id }))
      return
    }
    if (m.t === 'voice-moved') {
      state.told = m.channelId
      clearTimeout(timer)
      done(state)
    }
  })
})
check('they were in an ordinary channel first', moved.inLobby === true, moved)
check('and are moved into the private one', moved.told === vip.id, moved)

/*
 * And the move is worth something: the token they are minted next has to be
 * granted, or they arrive somewhere they cannot connect to.
 */
const nowIn = await call('/api/voice/token', {
  method: 'POST', body: JSON.stringify({ channelId: vip.id }),
}, mate.token)
check('being put there is what lets them in', nowIn.status === 200, nowIn.status)

/*
 * Nothing was granted, and nothing is left behind. Somebody who was never
 * moved is still refused, which is what tells the two apart.
 */
const other = await call('/api/voice/token', {
  method: 'POST', body: JSON.stringify({ channelId: vip.id }),
}, staff.token)
check('while somebody who was not moved is still refused', other.status === 403, other.status)

const stillShut = await call(`/api/channels/${vip.id}/messages`, {}, mate.token)
check('and being carried in is not consent to what was said in there',
  stillShut.status === 403, stillShut.status)

/*
 * The way an app actually arrives.
 *
 * Being moved makes the client rebuild its connection, and anything that
 * announces the leave on the way deletes the record of them being in the
 * call - which is the whole of the permission. The token asked for a moment
 * later was then refused, and being moved threw somebody out of voice
 * instead of putting them in the room.
 *
 * Driven here as the sequence rather than trusted to the client, because the
 * check above passes on a feature that fails in the app: it asked for a
 * token while sitting perfectly still, which is the one thing a client being
 * moved never does.
 */
const announced = await new Promise((done) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const timer = setTimeout(() => { try { ws.close() } catch {} ; done(false) }, 9000)
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token: mate.token })))
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t !== 'ready') return
    ws.send(JSON.stringify({ t: 'voice-leave' }))
    setTimeout(() => { clearTimeout(timer); try { ws.close() } catch {} ; done(true) }, 900)
  })
})
check('their app can announce the leave on the way', announced === true)
const midMove = await call('/api/voice/token', {
  method: 'POST', body: JSON.stringify({ channelId: vip.id }),
}, mate.token)
check('and they still arrive in the room they were carried into',
  midMove.status === 200, midMove.status)

/*
 * And hanging up takes it away again, which is the whole reason this is safe
 * to allow: nothing was granted, so there is nothing left to revoke.
 */
/*
 * Arriving spends the pass, so what is being measured below is presence and
 * nothing else. Without this the pass would still be good for a minute and
 * the refusal would prove only that it had not expired yet.
 */
const inTheRoom = await new Promise((done) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway')
  const timer = setTimeout(() => { try { ws.close() } catch {} ; done(false) }, 9000)
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token: mate.token })))
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
    if (m.t !== 'ready') return
    ws.send(JSON.stringify({ t: 'voice-join', channelId: vip.id }))
    setTimeout(() => { clearTimeout(timer); try { ws.close() } catch {} ; done(true) }, 900)
  })
})
check('their app announces that it is there', inTheRoom === true)

try { theirs.close(); mine.close() } catch {}
await new Promise((r) => setTimeout(r, 800))
const afterHangingUp = await call('/api/voice/token', {
  method: 'POST', body: JSON.stringify({ channelId: vip.id }),
}, mate.token)
check('and it lasts exactly as long as the call does', afterHangingUp.status === 403,
  afterHangingUp.status)

console.log('  --- authority does not survive leaving the server ---')

/*
 * A grant is not a fact about a person, it is a fact about them being here.
 * Left behind, it sits waiting: whoever removed somebody would find that
 * letting them back in silently restored what had just been taken away.
 * Roles are cleared on the way out for exactly this reason.
 */
const rejoiner = await reg('Keeko', code)
await grant(rejoiner.id, 'view_audit_log', true)
const held = await call(`/api/audit?spaceId=${space.id}`, {}, rejoiner.token)
check('somebody given a permission has it', held.status === 200, held.status)

await call(`/api/spaces/${space.id}/leave`, { method: 'POST', body: '{}' }, rejoiner.token)
const backCode = (await call(`/api/spaces/${space.id}/invites`, { method: 'POST', body: '{}' }, host.token)).body.code
await call(`/api/invites/${backCode}/accept`, { method: 'POST', body: '{}' }, rejoiner.token)

// Asserted, because everything below reads as a refusal if they simply
// failed to get back in.
const backIn = await call(`/api/members/roles?spaceId=${space.id}`, {}, host.token)
check('they really are back in',
  (backIn.body?.members ?? []).some((m) => m.id === rejoiner.id),
  (backIn.body?.members ?? []).map((m) => m.username))

const afterRejoin = await call(`/api/audit?spaceId=${space.id}`, {}, rejoiner.token)
check('but leaving and coming back does not restore it', afterRejoin.status === 403, afterRejoin.status)

console.log(bad === 0 ? '\n  all good' : `\n  ${bad} failed`)
process.exit(bad === 0 ? 0 : 1)
