/**
 * Somebody arriving shows up without a reload.
 *
 * Two reports, one shape. Invite somebody to a server and they were not in
 * the member list until you refreshed. Accept a friend request and they were
 * not in the conversations list - you had to go to Friends, message them, and
 * reload before they appeared.
 *
 * Both times the server knew and never said. Joining told only the person
 * joining; the friendship event carried no names, and every row on screen is
 * drawn from the people this client knows about - which did not include
 * somebody who had just become relevant.
 *
 * So nothing here reloads after the moment being tested. A reload would paper
 * straight over both.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'live-arrivals',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    // Nobody else to begin with: the owner alone, so anybody who turns up is
    // unambiguously somebody who turned up while we were watching.
    const setup = await signIn(js, { owner: 'JacksFO', friends: [] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.mem').length > 0`)
    await wait(2000)

    const before = await js(`(() => [...document.querySelectorAll('.mempane .mrow')]
      .map((m) => m.textContent.trim()))()`)
    console.log('      members to begin with: ' + JSON.stringify(before))
    check('only the owner is here', before.length === 1, before)

    // --- somebody accepts an invite ---------------------------------------
    const invited = await js(`(async () => {
      const mine = ${JSON.stringify(setup.me?.token ?? '')}
      const spaceId = ${JSON.stringify(setup.spaceId ?? '')}
      const invite = await (await fetch('/api/spaces/' + spaceId + '/invites', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + mine },
        body: '{}' })).json()
      const them = await (await fetch('/api/register', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'Newcomer', displayName: 'Newcomer',
          password: 'password123', invite: invite.code }) })).json()
      return { ok: !!them.token, token: them.token, id: them.user && them.user.id } })()`)
    check('somebody can be invited in', invited.ok === true, invited)

    // No reload. The list has to change on its own.
    await until('the newcomer in the member list',
      `[...document.querySelectorAll('.mempane .mrow')].some((m) => /Newcomer/.test(m.textContent))`,
      12000)
    const afterJoin = await js(`(() => [...document.querySelectorAll('.mempane .mrow')]
      .map((m) => m.textContent.trim()))()`)
    console.log('      members after they joined: ' + JSON.stringify(afterJoin))
    check('somebody who joins appears without a refresh',
      afterJoin.some((n) => /Newcomer/.test(n)), afterJoin)
    check('and nobody else arrived with them', afterJoin.length === 2, afterJoin)

    // --- somebody becomes a friend ----------------------------------------
    /*
     * A person in no shared server, so the conversations list has no other
     * reason to know about them - which is the case that failed.
     */
    const asked = await js(`(async () => {
      const stranger = await (await fetch('/api/register', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'Chels', displayName: 'Chels', password: 'password123' }) })).json()
      if (!stranger.token) return { ok: false }
      // They ask, and we accept - the direction that was reported.
      const askRes = await fetch('/api/friends/request', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + stranger.token },
        body: JSON.stringify({ name: 'JacksFO' }) })
      return { ok: askRes.status === 200, status: askRes.status, id: stranger.user.id } })()`)
    check('a stranger can send a friend request', asked.ok === true, asked)

    // Accept it, the way the Friends screen does - and then do not reload.
    const accepted = await js(`(async () => {
      const mine = ${JSON.stringify(setup.me?.token ?? '')}
      const r = await fetch('/api/friends/accept', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + mine },
        body: JSON.stringify({ userId: ${JSON.stringify(asked.id ?? '')} }) })
      return { status: r.status } })()`)
    check('the request can be accepted', accepted.status === 200, accepted)

    /*
     * Straight to the conversations list. Not through Friends, and without
     * messaging them - that was the workaround, and the workaround passing
     * would prove nothing.
     */
    await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
    await wait(1500)

    const showed = await until('the new friend under Direct messages',
      `[...document.querySelectorAll('.chan .nm')].some((n) => /Chels/.test(n.textContent))`,
      12000)
    check('a new friend appears in the conversations list without a refresh', showed === true)

    const dms = await js(`(() => [...document.querySelectorAll('.chan .nm')]
      .map((n) => n.textContent.trim()))()`)
    console.log('      conversations list: ' + JSON.stringify(dms))
    check('and they are the one who was just added',
      dms.some((n) => /Chels/.test(n)), dms)
  },
}
