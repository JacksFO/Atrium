/**
 * Somebody with several roles is listed once, under the highest of them.
 *
 * Asked about a server whose owner had also given themselves another role:
 * both are set to show separately, so should he appear under Owner, under
 * Squadron, or under both? Once, under Owner - the highest role he holds that
 * groups the list.
 *
 * Worth a browser test rather than a reading of the code, because the answer
 * depends on three things agreeing: the roles arriving in position order, the
 * grouping walking them in that order, and a member being claimed by the first
 * group that takes them. Any one of those quietly changing puts somebody in
 * two places at once, and the code still looks right.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'role-grouping',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    /*
     * His own server, then two more roles in it that both show separately -
     * one just below Owner and one at the bottom - and all of them given to
     * him. Two rather than one so this measures "the highest" rather than
     * "the first that happens to be looked at".
     */
    const built = await js(`(async () => {
      const token = ${JSON.stringify(setup.friends?.baileyyy?.token ?? '')}
      if (!token) return { ok: false, why: 'no token for Baileyyy' }
      const send = async (url, method, body) => (await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: body === undefined ? undefined : JSON.stringify(body),
      })).json()

      const made = await send('/api/spaces', 'POST', { name: 'Baileys Dictatorship' })
      const spaceId = made.space && made.space.id
      if (!spaceId) return { ok: false, why: 'no server was made' }

      const mk = async (name) => {
        const res = await send('/api/roles', 'POST', { name, colour: '#8FD98A', spaceId })
        const role = (res.roles || []).find((r) => r.name === name)
        // Show separately, or it groups nothing and this measures nothing.
        await send('/api/roles/' + role.id, 'PATCH', { hoist: true })
        await send('/api/admin/members/' + made.space.owner_id + '/roles', 'POST',
          { roleId: role.id, grant: true, spaceId })
        return role
      }
      const squadron = await mk('Squadron')
      const regulars = await mk('Regulars')

      const roles = (await send('/api/roles?spaceId=' + spaceId, 'GET')).roles || []
      localStorage.setItem('atrium.token', token)
      return {
        ok: true,
        spaceId,
        me: made.space.owner_id,
        squadron: squadron.id,
        regulars: regulars.id,
        order: roles.map((r) => r.name + ':' + r.position + ':hoist' + r.hoist),
      } })()`)

    check('his server and two more separate roles exist', built.ok === true, built.why ?? built)
    console.log('      roles, highest first: ' + JSON.stringify(built.order))

    // Owner has to be the highest of them, or the rest of this asks nothing.
    check('Owner is the highest role he holds',
      (built.order || [])[0] && /^Owner:/.test(built.order[0]), built.order && built.order[0])

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)').length >= 2`)
    await wait(2000)
    await js(`(() => { const p = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]; if (p[1]) p[1].click(); return 1 })()`)
    await wait(2000)

    /*
     * Read the column as it is built: each group is one div holding its
     * heading and its rows, so a name can be attributed to the heading above
     * it rather than guessed at from document order.
     */
    const column = await js(`(() => {
      const groups = [...document.querySelectorAll('.mempane .mem > div')].map((box) => ({
        heading: (box.querySelector('.sect') || {}).textContent || '',
        names: [...box.querySelectorAll('.mrow')].map((m) => m.textContent.trim()),
      }))
      return {
        server: (document.querySelector('.sidepane .nm, .sidepane .chd .tt') || {}).textContent,
        groups,
      } })()`)
    console.log('      member column: ' + JSON.stringify(column.groups))

    check('looking at his own server', /Dictatorship/i.test(column.server || ''), column.server)

    const groups = column.groups || []
    const mentions = groups.filter((g) => g.names.some((n) => /baileyyy/i.test(n)))

    check('he appears exactly once in the whole column',
      mentions.length === 1, mentions.map((g) => g.heading.trim()))

    check('and that once is under Owner',
      mentions.length === 1 && /owner/i.test(mentions[0].heading), mentions[0]?.heading)

    /*
     * The other two headings must not be carrying him as well. They may not
     * appear at all - a heading with nobody under it is not drawn - and that
     * is a pass, because the point is only that he is not in them.
     */
    for (const name of ['Squadron', 'Regulars']) {
      const group = groups.find((g) => g.heading.includes(name))
      check(`${name} does not list him too`,
        !group || !group.names.some((n) => /baileyyy/i.test(n)),
        group ? group.names : '(no such heading, nobody holds it as their highest)')
    }

    check('the Owner heading counts one person',
      /—\s*1|- 1/.test(mentions[0]?.heading || ''), mentions[0]?.heading)

    /*
     * And when the highest role is not set to show separately, he drops to
     * the highest one that is - rather than to the top of the list, or out of
     * the groups altogether.
     *
     * Only if the server will let Owner be edited that way. It guards which
     * of that role's fields it accepts, so a refusal here is a legitimate
     * answer and not a failure of the grouping.
     */
    const unhoisted = await js(`(async () => {
      const token = ${JSON.stringify(setup.friends?.baileyyy?.token ?? '')}
      const roles = await (await fetch('/api/roles?spaceId=' + ${JSON.stringify(built.spaceId ?? '')}, {
        headers: { authorization: 'Bearer ' + token } })).json()
      const owner = (roles.roles || []).find((r) => r.kind === 'owner')
      const res = await fetch('/api/roles/' + owner.id, { method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ hoist: false }) })
      return { status: res.status } })()`)

    if (unhoisted.status === 200) {
      await win.loadURL(base + '/')
      await until('the app', `document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)').length >= 2`)
      await wait(2000)
      await js(`(() => { const p = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]; if (p[1]) p[1].click(); return 1 })()`)
      await wait(2000)

      const after = await js(`(() => [...document.querySelectorAll('.mempane .mem > div')].map((box) => ({
        heading: (box.querySelector('.sect') || {}).textContent || '',
        names: [...box.querySelectorAll('.mrow')].map((m) => m.textContent.trim()),
      })))()`)
      console.log('      with Owner no longer separate: ' + JSON.stringify(after))

      const now = (after || []).filter((g) => g.names.some((n) => /baileyyy/i.test(n)))
      check('he still appears exactly once', now.length === 1, now.map((g) => g.heading.trim()))
      check('and falls to Regulars, the highest that still shows separately',
        now.length === 1 && /Regulars/i.test(now[0].heading), now[0]?.heading)
    } else {
      console.log('      Owner cannot be unhoisted (' + unhoisted.status + '), so that half is not asked')
    }

    /*
     * The tie-break is NOT checked here, deliberately.
     *
     * Two roles sharing a position is the case that needed settling, and it
     * cannot be built through the API as an owner: their ceiling is 99, so it
     * would take ninety-nine roles to collide. A check written for it here
     * passed without ever creating a tie - the positions came back 2 and 1,
     * untouched, and it compared one settled list against itself.
     *
     * It lives in roleorder.test.ts instead, where a tie is one line.
     */
  },
}
