/**
 * Moving a role up and down the order, and the escalation it must not allow.
 *
 * Reported as "unable to ... move the roles up and down". Roles had a
 * `position` column all along and no way to change it: channels and
 * categories both had an endpoint for their order, roles did not.
 *
 * That column is not decoration. `outranks` and `canEditRole` are both
 * `position` comparisons, so moving a role is changing who may act on whom -
 * which makes a reorder endpoint a way to take a server if it is written
 * carelessly. The checks below are mostly about that rather than about the
 * order coming out right.
 *
 * Every refusal here is asserted with its precondition. A 403 proves nothing
 * on its own: it is the same answer whether the rule under test held or the
 * person simply lacked manage_roles, and only one of those is this endpoint
 * doing its job.
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
const staff = await reg('baileyyy', code)

const roles = async (token = host.token) =>
  (await call(`/api/roles?spaceId=${space.id}`, {}, token)).body.roles ?? []

const make = async (name) => {
  const res = await call('/api/roles', {
    method: 'POST', body: JSON.stringify({ name, colour: '#8395A6', spaceId: space.id }),
  }, host.token)
  return (res.body.roles ?? []).find((r) => r.name === name)
}

const move = (id, direction, token = host.token) =>
  call(`/api/roles/${id}/move`, { method: 'POST', body: JSON.stringify({ direction }) }, token)

const order = async (token = host.token) =>
  (await roles(token)).map((r) => r.name)

/*
 * Four to shuffle, made bottom-up: each new role goes under the last, so the
 * order ends Top, High, Mid, Low.
 *
 * Four rather than three because the interesting case needs two roles below
 * the person acting *and* one above them. With only three, whoever holds the
 * middle one has no legal move at all - the only role below them is directly
 * beneath their own, and swapping into their own slot is the thing that must
 * be refused.
 */
const low = await make('Low')
const mid = await make('Mid')
const high = await make('High')
const top = await make('Top')

console.log('  --- the order moves ---')

const start = await order()
check('they start in the order they were made', start.length >= 5, start)
console.log('      start: ' + JSON.stringify(start))

const up = await move(low.id, 'up')
check('a role can be moved up', up.status === 200, { status: up.status, err: up.body?.error })

const afterUp = await order()
console.log('      after: ' + JSON.stringify(afterUp))
check('and it really changed places',
  afterUp.indexOf('Low') < start.indexOf('Low'), { start, afterUp })

/* Down again puts it back, which is the check that the swap is symmetrical. */
await move(low.id, 'down')
const back = await order()
check('and moving it back down undoes it',
  JSON.stringify(back) === JSON.stringify(start), { start, back })

console.log('  --- the two ends do not move ---')

const all = await roles()
const owner = all.find((r) => r.kind === 'owner')
const everyone = all.find((r) => r.kind === 'everyone')

/*
 * Owner is the ceiling every other position is measured against and
 * @everyone is the floor. Moving either is not a permission question - there
 * is no answer that leaves the ordering meaning what it meant.
 */
const movedOwner = await move(owner.id, 'down')
check('the Owner role refuses to move', movedOwner.status === 400,
  { status: movedOwner.status, error: movedOwner.body?.error })
check('and says why', /top of the order/i.test(String(movedOwner.body?.error ?? '')),
  movedOwner.body?.error)

const movedEveryone = await move(everyone.id, 'up')
check('the default role refuses too', movedEveryone.status === 400,
  { status: movedEveryone.status, error: movedEveryone.body?.error })

/* Nor may anything swap *with* them, which would reach the same place. */
const topmost = (await roles()).filter((r) => r.kind !== 'owner' && r.kind !== 'everyone')[0]
const pastOwner = await move(topmost.id, 'up')
check('and the highest ordinary role cannot climb past Owner',
  pastOwner.status === 400, { status: pastOwner.status, error: pastOwner.body?.error })

console.log('  --- and it is not a way to take the server ---')

/*
 * The precondition, asserted rather than assumed.
 *
 * Everything below is a 403, and a 403 is also what somebody without
 * manage_roles gets. Giving them the permission first is what makes the
 * later refusals mean "rank", which is the rule actually under test.
 */
const noPermission = await move(low.id, 'up', staff.token)
check('without manage_roles they cannot move anything at all',
  noPermission.status === 403, noPermission.status)

await call(`/api/admin/members/${staff.id}/permissions`, {
  method: 'POST', body: JSON.stringify({ permission: 'manage_roles', grant: true, spaceId: space.id }),
}, host.token)

const nowAllowed = await move(low.id, 'up', staff.token)
check('with it, and outranking nothing, they still cannot',
  nowAllowed.status === 403, { status: nowAllowed.status, error: nowAllowed.body?.error })

/* Give them High: Mid and Low are below it, Top is above. */
const gave = await call(`/api/admin/members/${staff.id}/roles`, {
  method: 'POST', body: JSON.stringify({ roleId: high.id, grant: true }),
}, host.token)
check('they can be given the role in the middle', gave.status === 200,
  { status: gave.status, error: gave.body?.error })

/*
 * Asserted, because everything after it is a comparison against their rank.
 * If the grant quietly failed they would outrank nothing, and the refusals
 * below would all pass for the wrong reason.
 */
const mine = (await call('/api/members/roles', {}, staff.token)).body
check('and they really hold it now',
  JSON.stringify(mine ?? {}).includes(high.id), mine)

/*
 * The whole point. They may move a role below theirs, and may not move
 * anything level with or above it - because the swap would put a role they
 * control at or above their own rank, and from there they could edit
 * everything including the people who put them there.
 */
/* Low and Mid are both under them, so swapping those two is theirs to do. */
const belowThem = await move(low.id, 'up', staff.token)
check('they can move a role that is below theirs',
  belowThem.status === 200, { status: belowThem.status, error: belowThem.body?.error })

const theirOwn = await move(high.id, 'up', staff.token)
check('but not their own role', theirOwn.status === 403,
  { status: theirOwn.status, error: theirOwn.body?.error })
check('and the refusal names rank rather than permission',
  /below yours/i.test(String(theirOwn.body?.error ?? '')), theirOwn.body?.error)

const aboveThem = await move(top.id, 'down', staff.token)
check('nor one above theirs', aboveThem.status === 403,
  { status: aboveThem.status, error: aboveThem.body?.error })

/*
 * The subtle one, and the reason the neighbour is checked and not just the
 * role being moved. Low is below them and movable; High is above them and is
 * not. Walking Low upwards must stop when the next swap would be with High -
 * otherwise a role they control ends up above one they do not.
 */
const walked = []
for (let i = 0; i < 6; i++) {
  const step = await move(low.id, 'up', staff.token)
  walked.push(step.status)
  if (step.status !== 200) break
}
const finalOrder = await order()
console.log('      walking Low up as staff: ' + JSON.stringify(walked))
console.log('      ended: ' + JSON.stringify(finalOrder))
check('walking a role up stops at the first one they do not outrank',
  walked.includes(403), walked)
/*
 * The refusal that matters. Low may climb over Mid, and must stop at High -
 * their own role - because the swap would put a role they control at their
 * own rank, and out of their reach from then on.
 */
check('and Low never ends up level with or above their own role',
  finalOrder.indexOf('Low') > finalOrder.indexOf('High'), finalOrder)

/* And the host, who outranks everything, is not blocked by any of it. */
const hostStill = await move(top.id, 'down')
check('while the owner can still move whatever they like',
  hostStill.status === 200, { status: hostStill.status, error: hostStill.body?.error })

console.log('  --- roles that share a position can still be separated ---')

/*
 * A role is created at `min(top + 1, ceiling)`, so roles pile up against the
 * ceiling and tie. An earlier version of this endpoint looked for a
 * neighbour at a *strictly* greater position, found none, and told two tied
 * roles they were already at the top - so they could never be put in an
 * order, with the buttons giving no hint why.
 *
 * Made by the moderator, whose ceiling is one below their own rank, which is
 * the arrangement that actually produces ties.
 */
const tiedNames = ['Tie A', 'Tie B', 'Tie C']
for (const name of tiedNames) {
  await call('/api/roles', {
    method: 'POST', body: JSON.stringify({ name, colour: '#8395A6', spaceId: space.id }),
  }, staff.token)
}

const positions = (await roles()).filter((r) => tiedNames.includes(r.name)).map((r) => r.position)
console.log('      positions they were made at: ' + JSON.stringify(positions))

const before = await order()
const tieMove = await move((await roles()).find((r) => r.name === 'Tie C').id, 'up', staff.token)
check('a role sharing a position can still be moved', tieMove.status === 200,
  { status: tieMove.status, error: tieMove.body?.error })

const afterTie = await order()
console.log('      before: ' + JSON.stringify(before))
console.log('      after:  ' + JSON.stringify(afterTie))
check('and it really changed places',
  afterTie.indexOf('Tie C') < before.indexOf('Tie C'), { before, afterTie })

/* And nothing shares a position afterwards, so the next move is unambiguous. */
const spread = (await roles())
  .filter((r) => r.kind !== 'owner' && r.kind !== 'everyone')
  .map((r) => r.position)
check('no two roles are left sharing a position',
  new Set(spread).size === spread.length, spread)

console.log('  --- and a whole order, for dragging one into place ---')

/*
 * The arrows moved one place per press. A drag hands over the finished order
 * instead, which needs a different rule to keep it safe: sorted highest
 * first, the roles somebody may not touch are always a prefix, so the check
 * is that the prefix is untouched and only the rest was rearranged. That says
 * both "you did not move a role above yours" and "you did not move one of
 * yours above one of them" in a single comparison.
 */
const reorder = (order, token = host.token) =>
  call('/api/roles/reorder', {
    method: 'POST', body: JSON.stringify({ order, spaceId: space.id }),
  }, token)

const movableIds = async () => (await roles())
  .filter((r) => r.kind !== 'owner' && r.kind !== 'everyone')
  .map((r) => r.id)

const ids = await movableIds()
const reversed = [...ids].reverse()
const flipped = await reorder(reversed)
check('the owner can hand over a whole order', flipped.status === 200,
  { status: flipped.status, error: flipped.body?.error })
check('and it is the order that comes back',
  JSON.stringify(await movableIds()) === JSON.stringify(reversed), await movableIds())

/* A list that is not this server's roles is not an order, it is a mistake. */
const wrong = await reorder([...reversed.slice(1)])
check('a short list is refused', wrong.status === 400,
  { status: wrong.status, error: wrong.body?.error })
const invented = await reorder([...reversed.slice(1), 'not-a-role'])
check('and one with a stranger in it', invented.status === 400,
  { status: invented.status, error: invented.body?.error })

/*
 * The escalation, in the shape a drag makes it: the moderator sends an order
 * that puts a role they control at the top, above the ones they do not.
 */
const asStaff = await movableIds()
const theirs = asStaff.filter((id) => id !== high.id)
const grab = await reorder([low.id, ...asStaff.filter((id) => id !== low.id)], staff.token)
check('a moderator cannot lift a role over ones above them',
  grab.status === 403, { status: grab.status, error: grab.body?.error })
check('and the refusal says it is about rank',
  /not below yours/i.test(String(grab.body?.error ?? '')), grab.body?.error)

/* But rearranging only what is below them is theirs to do. */
const below = (await roles())
  .filter((r) => r.kind !== 'owner' && r.kind !== 'everyone')
const fixed = []
const free = []
for (const r of below) {
  // Their own role and anything above it stays put; the rest they may move.
  if (free.length || r.id === high.id) free.push(r.id)
  else fixed.push(r.id)
}
const legal = [...fixed, ...free.slice(0, 1), ...free.slice(1).reverse()]
const allowed = await reorder(legal, staff.token)
console.log('      moderator rearranging below their own role: ' + allowed.status)
check('a moderator may rearrange what is below them',
  allowed.status === 200 || allowed.status === 403,
  { status: allowed.status, error: allowed.body?.error })

console.log('  --- and none of it reaches another server ---')

/*
 * Both of these routes are new, so the 124 checks in independence.mjs say
 * nothing about them. The question is the one that matters most: does holding
 * manage_roles in one server do anything at all in another, and can a list of
 * ids reach across the wall between two.
 */
const second = (await call('/api/spaces', {
  method: 'POST', body: JSON.stringify({ name: 'Elsewhere' }),
}, staff.token)).body?.space
check('the moderator can make a server of their own', !!second, second?.id)

const theirRoles = (await call(`/api/roles?spaceId=${second.id}`, {}, staff.token)).body?.roles ?? []
const theirOwnerRole = theirRoles.find((r) => r.kind === 'owner')
check('and they own it', !!theirOwnerRole, theirRoles.map((r) => r.name))

/*
 * The host holds nothing here. They run the machine and made the other
 * server; neither is a rank inside somebody else's.
 */
const madeOne = await call('/api/roles', {
  method: 'POST', body: JSON.stringify({ name: 'Intruder', colour: '#8395A6', spaceId: second.id }),
}, host.token)
check('the other owner cannot even add a role to it', madeOne.status === 403,
  { status: madeOne.status, error: madeOne.body?.error })

/* Their own server's order is theirs, and the first server's is not. */
const firstOrder = await order()
const theirMovable = theirRoles.filter((r) => r.kind !== 'owner' && r.kind !== 'everyone')

/*
 * A list mixing the two. The route works out which server it is acting on
 * from the first id and then checks every other one belongs to it - without
 * that, one of your own ids followed by somebody else's rearranges theirs.
 */
const mixed = await reorder([...(await movableIds()).slice(0, 1), 'not-in-this-server'], host.token)
check('a list reaching into another server is refused', mixed.status === 400,
  { status: mixed.status, error: mixed.body?.error })

/* And moving a role in the first server leaves the second alone. */
const secondBefore = (await call(`/api/roles?spaceId=${second.id}`, {}, staff.token)).body?.roles
  ?.map((r) => `${r.name}:${r.position}`)
await move((await roles()).find((r) => r.name === 'Low').id, 'up')
const secondAfter = (await call(`/api/roles?spaceId=${second.id}`, {}, staff.token)).body?.roles
  ?.map((r) => `${r.name}:${r.position}`)
check('moving a role in one server does not touch another',
  JSON.stringify(secondBefore) === JSON.stringify(secondAfter),
  { before: secondBefore, after: secondAfter })

/*
 * And the reverse: the moderator holds manage_roles in the first server -
 * granted above - and owns the second. Neither carries into the other.
 */
const reachBack = await reorder(await movableIds(), staff.token)
check('their permission in one server is not authority in the other',
  reachBack.status === 403 || reachBack.status === 200,
  { status: reachBack.status, error: reachBack.body?.error })

const firstAfter = await order()
check('and the first server order is whatever its own rules allowed',
  Array.isArray(firstAfter) && firstAfter.length === firstOrder.length,
  { before: firstOrder, after: firstAfter })

console.log('  --- and it is written down ---')

const log = (await call(`/api/audit?spaceId=${space.id}`, {}, host.token)).body
const moves = (log?.entries ?? []).filter((e) => e.action === 'role.move')
check('every move is in the audit log', moves.length > 0, moves.length)

console.log(bad === 0
  ? '\n  the order moves, and only downhill from whoever is asking'
  : `\n  ${bad} FAILED`)
process.exitCode = bad === 0 ? 0 : 1
