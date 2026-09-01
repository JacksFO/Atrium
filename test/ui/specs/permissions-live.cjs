/**
 * A permission changed by somebody else, without a reload.
 *
 * Asked for as: "if i lock a channel, if i give someone a role or specific
 * permission, that they are all live instantly and no refreshes or reloads
 * are needed".
 *
 * The routes all push and the client applies what they push - which is easy
 * to read in the code and proves nothing, because every one of those pushes
 * has to reach a client that has already drawn the old answer. So this
 * changes things as the owner, through the API, and asks the *other* account's
 * open window what it can see. Nothing is reloaded after signing in.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'permissions-live',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    const owner = setup.me?.token ?? ''
    const mate = setup.friends?.baileyyy?.token ?? ''
    check('there are two accounts', !!owner && !!mate)

    /** As the owner, from outside the window being watched. */
    const asOwner = (method, path, body) => js(`(async () => {
      const r = await fetch(${JSON.stringify(path)}, {
        method: ${JSON.stringify(method)},
        headers: { 'content-type': 'application/json',
                   authorization: 'Bearer ' + ${JSON.stringify(owner)} },
        body: ${JSON.stringify(body === undefined ? null : JSON.stringify(body))},
      })
      return { status: r.status, body: await r.json().catch(() => null) } })()`)

    const space = await js(`(async () => {
      const r = await (await fetch('/api/spaces', { headers: {
        authorization: 'Bearer ' + ${JSON.stringify(owner)} } })).json()
      return r.spaces[0] })()`)
    const everyone = await js(`(async () => {
      const r = await (await fetch('/api/roles?spaceId=' + ${JSON.stringify(space.id)}, {
        headers: { authorization: 'Bearer ' + ${JSON.stringify(owner)} } })).json()
      const all = r.roles || []
      const e = all.find((x) => x.kind === 'everyone')
      return e ? e.id : null })()`)
    check('there is an @everyone role to change', !!everyone, everyone)

    /* Signed in as the other person, and not reloaded again after this. */
    await js(`localStorage.setItem('atrium.token', ${JSON.stringify(mate)})`)
    await win.loadURL(base + '/')
    await until('their channel list', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1800)

    const channel = await js(`(() => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /general/i.test(r.textContent || ''))
      if (row) row.click()
      return row ? row.textContent.trim() : null })()`)
    check('they can open a channel', !!channel, channel)
    await until('the message box', `!!document.querySelector('.cmp textarea')`, 10000)

    const openId = await js(`(async () => {
      const r = await (await fetch('/api/channels?spaceId=' + ${JSON.stringify(space.id)}, {
        headers: { authorization: 'Bearer ' + ${JSON.stringify(owner)} } })).json()
      const c = (r.channels || []).find((x) => /general/i.test(x.name))
      return c ? c.id : null })()`)
    check('and that channel can be named to the server', !!openId, openId)

    // ---- 1. take writing away, and watch the box go --------------------
    const denied = await asOwner('PUT', `/api/channels/${openId}/permissions`, {
      kind: 'role', subjectId: everyone, rules: { send_messages: false },
    })
    check('the owner can refuse writing there', denied.status === 200, denied)

    const wentReadOnly = await until('the box to go',
      `!document.querySelector('.cmp textarea')`, 12000)
    check('their message box goes without a reload', wentReadOnly === true)
    check('and it says why', await js(`!!document.querySelector('.cmp .cantsend')`) === true)

    // ---- 2. give it back, and watch it return ---------------------------
    const back = await asOwner('PUT', `/api/channels/${openId}/permissions`, {
      kind: 'role', subjectId: everyone, rules: {},
    })
    check('the owner can give it back', back.status === 200, back)
    const cameBack = await until('the box to come back',
      `!!document.querySelector('.cmp textarea')`, 12000)
    check('and it comes back, still without a reload', cameBack === true)

    // ---- 3. hide the channel entirely -----------------------------------
    const hidden = await asOwner('PUT', `/api/channels/${openId}/permissions`, {
      kind: 'role', subjectId: everyone, rules: { view_channels: false },
    })
    check('the owner can hide it', hidden.status === 200, hidden)

    /*
     * Absent, not greyed. The whole point of the view permission is that a
     * channel somebody may not see is a channel that is not there.
     */
    const vanished = await until('the channel to go from their list',
      `![...document.querySelectorAll('.chan')].some((r) => /general/i.test(r.textContent || ''))`,
      12000)
    check('a hidden channel leaves their list without a reload', vanished === true)

    await asOwner('PUT', `/api/channels/${openId}/permissions`, {
      kind: 'role', subjectId: everyone, rules: {},
    })
    const returned = await until('and comes back when it is unhidden',
      `[...document.querySelectorAll('.chan')].some((r) => /general/i.test(r.textContent || ''))`,
      12000)
    check('and comes back when it is unhidden', returned === true)

    // ---- 4. a permission given to them personally -----------------------
    /*
     * Watched through a control that is absent without the permission rather
     * than through a list of what somebody holds: gated things in this app
     * are not drawn at all, so their appearing is the only honest proof that
     * the client believes the new answer.
     */
    const me = await js(`(async () => {
      const r = await (await fetch('/api/me', { headers: {
        authorization: 'Bearer ' + ${JSON.stringify('MATE')} } })).json()
      return r.user ? r.user.id : null })()`.replace('MATE', mate))
    check('their own id can be asked for', !!me, me)

    /* Named exactly. "settings" at the end of a label is also the bell's
       ("Notification settings") and your own ("Your settings"), so a
       suffix match answered true before anything had been granted. */
    /* What manage_channels buys, and nothing else does: the plus on a
       heading. The settings door is not it - every member has that. */
    const PLUS = `[...document.querySelectorAll('.sidepane [aria-label]')]
      .some((b) => /^New channel in /.test(b.getAttribute('aria-label')))`
    /*
     * What an ordinary member is shown before anything is given to them.
     *
     * They hold what @everyone holds, which includes create_invite - so
     * Invite people is theirs and belongs here. Everything about arranging
     * the place is not, and was: the list that decides "is there a settings
     * pane for you" was also deciding "may you make a channel", and every
     * member holds one of its entries.
     */
    const seen = await js(
      `[...document.querySelectorAll('.sidepane [aria-label]')].map((b) => b.getAttribute('aria-label'))`)
    console.log('      what a member is offered: ' + JSON.stringify(seen))
    check('a member is offered the invite they may make',
      seen.includes('Invite people'), seen)
    /*
     * And nothing for arranging the place. The settings door itself is
     * theirs and stays: holding create_invite means there is one pane in
     * there for them, which is the rule that door is drawn by.
     */
    check('and no plus to make channels with',
      !seen.some((l) => /^New channel in /.test(l)), seen)

    const granted = await asOwner('POST', `/api/admin/members/${me}/permissions`, {
      spaceId: space.id, permission: 'manage_channels', grant: true,
    })
    check('the owner can give one to them by hand', granted.status === 200, granted)

    const came = await until('the plus to appear', PLUS, 12000)
    check('a permission given to one person arrives without a reload', came === true)

    // ---- 5. and the same through a role ---------------------------------
    await asOwner('POST', `/api/admin/members/${me}/permissions`, {
      spaceId: space.id, permission: 'manage_channels', grant: false,
    })
    const went = await until('and to go again', `!(${PLUS})`, 12000)
    check('and goes again when it is taken back', went === true)

    const role = await asOwner('POST', '/api/roles', {
      spaceId: space.id, name: 'Helpers', permissions: ['manage_channels'],
    })
    check('a role can be made', role.status === 200, role)
    const roleId = await js(`(async () => {
      const r = await (await fetch('/api/roles?spaceId=' + ${JSON.stringify(space.id)}, {
        headers: { authorization: 'Bearer ' + ${JSON.stringify(owner)} } })).json()
      const found = (r.roles || []).find((x) => x.name === 'Helpers')
      return found ? found.id : null })()`)
    check('and found again', !!roleId, roleId)

    /* Made, then given its permissions: the create route takes a name and a
       colour and nothing else, so a role asked for with permissions arrives
       with none. */
    const armed = await asOwner('PATCH', `/api/roles/${roleId}`, {
      permissions: ['manage_channels'],
    })
    check('and given something to allow', armed.status === 200, armed)

    const gave = await asOwner('POST', `/api/admin/members/${me}/roles`, {
      spaceId: space.id, roleId, grant: true,
    })
    check('and handed to them', gave.status === 200, gave)

    const byRole = await until('the plus to appear from a role', PLUS, 12000)
    check('a role handed to somebody arrives without a reload', byRole === true)
  },
}
