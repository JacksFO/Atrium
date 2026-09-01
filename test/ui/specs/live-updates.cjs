/**
 * What one person changes, another person sees, without reloading.
 *
 * Asked for as: make sure things that should be live are live - permissions
 * and roles came to mind, "like if i give someone a role they are then put
 * into that role on the members list", and whatever else is not.
 *
 * Every check is the same shape: the owner changes something through the API
 * from outside the window, and the window - signed in as somebody else and
 * never reloaded after that - is asked what it shows. A push that the server
 * sends and the client drops looks exactly like a push that was never sent,
 * and only the second window can tell them apart.
 */
const W = require('../where.cjs')
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'live-updates',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    const owner = setup.me?.token ?? ''
    const mate = setup.friends?.baileyyy?.token ?? ''
    const mateId = setup.friends?.baileyyy?.id ?? ''
    check('there are two accounts', !!owner && !!mate && !!mateId)

    /* No content-type without a body: the server refuses a request that says
       it carries JSON and carries nothing, which is a 400 that reads exactly
       like the thing under test not working. */
    const asOwner = (method, path, body) => js(`(async () => {
      const has = ${JSON.stringify(body !== undefined)}
      const r = await fetch(${JSON.stringify(path)}, {
        method: ${JSON.stringify(method)},
        headers: has
          ? { 'content-type': 'application/json',
              authorization: 'Bearer ' + ${JSON.stringify(owner)} }
          : { authorization: 'Bearer ' + ${JSON.stringify(owner)} },
        ...(has ? { body: ${JSON.stringify(JSON.stringify(body === undefined ? null : body))} } : {}),
      })
      return { status: r.status, body: await r.json().catch(() => null) } })()`)

    const space = await js(`(async () => {
      const r = await (await fetch('/api/spaces', { headers: {
        authorization: 'Bearer ' + ${JSON.stringify(owner)} } })).json()
      return r.spaces[0] })()`)

    /* Watched as the owner, so the member list and its role headings are all
       drawn - that is the screen the report is about. */
    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1800)

    /*
     * Them, connected.
     *
     * A hoisted role groups the people who are *here* - somebody offline is
     * under Offline whatever they hold, which is right and is what every app
     * that has this does. So the second account needs a socket of its own
     * before any of this can be seen at all: a second window would do it and
     * there is one window, so this is their connection, opened from inside
     * the page and left open.
     */
    const connected = await js(`(() => new Promise((done) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const s = new WebSocket(proto + '//' + location.host + '/gateway')
      window.__mate = s
      s.onopen = () => s.send(JSON.stringify({ t: 'hello', token: ${JSON.stringify(mate)} }))
      s.onmessage = (e) => {
        const m = JSON.parse(e.data)
        if (m.t === 'ready') done(true)
      }
      setTimeout(() => done(false), 8000)
    }))()`)
    check('the other account can be connected as well', connected === true)
    await wait(1200)

    const headings = () => js(
      `[...document.querySelectorAll('.mempane .hd2, .mempane .sect')].map((h) => h.textContent.trim())`)

    // ---- a role somebody is given puts them under it ---------------------
    await asOwner('POST', '/api/roles', { spaceId: space.id, name: 'Moderators' })
    const roleId = await js(`(async () => {
      const r = await (await fetch('/api/roles?spaceId=' + ${JSON.stringify(space.id)}, {
        headers: { authorization: 'Bearer ' + ${JSON.stringify(owner)} } })).json()
      const f = (r.roles || []).find((x) => x.name === 'Moderators')
      return f ? f.id : null })()`)
    check('a role can be made', !!roleId, roleId)

    /* Hoisted, which is what "listed separately" means: a role shows as its
       own heading in the member list when it is set to. */
    await asOwner('PATCH', `/api/roles/${roleId}`, { hoist: true })

    const before = await headings()
    console.log('      headings before: ' + JSON.stringify(before))

    await asOwner('POST', `/api/admin/members/${mateId}/roles`, {
      spaceId: space.id, roleId, grant: true,
    })

    const grouped = await until('them to appear under it',
      `[...document.querySelectorAll('.mempane .hd2, .mempane .sect')]
         .some((h) => /Moderators/i.test(h.textContent))`, 12000)
    console.log('      headings after: ' + JSON.stringify(await headings()))
    check('somebody given a hoisted role is listed under it, live', grouped === true)

    // ---- renaming that role renames the heading --------------------------
    await asOwner('PATCH', `/api/roles/${roleId}`, { name: 'Keepers' })
    const renamed = await until('the heading to follow the name',
      `[...document.querySelectorAll('.mempane .hd2, .mempane .sect')]
         .some((h) => /Keepers/i.test(h.textContent))`, 12000)
    check('renaming a role renames the heading, live', renamed === true)

    // ---- a channel made by somebody else turns up ------------------------
    await asOwner('POST', '/api/channels', {
      spaceId: space.id, name: 'live-test', kind: 'text',
    })
    const appeared = await until('the channel to arrive',
      `[...document.querySelectorAll('.chan')].some((c) => /live-test/.test(c.textContent))`, 12000)
    check('a channel somebody else makes turns up, live', appeared === true)

    // ---- and renaming it follows -----------------------------------------
    const chanId = await js(`(async () => {
      const r = await (await fetch('/api/channels?spaceId=' + ${JSON.stringify(space.id)}, {
        headers: { authorization: 'Bearer ' + ${JSON.stringify(owner)} } })).json()
      const c = (r.channels || []).find((x) => x.name === 'live-test')
      return c ? c.id : null })()`)
    await asOwner('PATCH', `/api/channels/${chanId}`, { name: 'live-renamed' })
    const chanRenamed = await until('the new name',
      `[...document.querySelectorAll('.chan')].some((c) => /live-renamed/.test(c.textContent))`, 12000)
    check('renaming a channel follows, live', chanRenamed === true)

    // ---- a nickname somebody is given ------------------------------------
    await asOwner('POST', `/api/admin/members/${mateId}/nickname`, {
      spaceId: space.id, nickname: 'Bailz',
    })
    const nick = await until('the nickname in the member list',
      `[...document.querySelectorAll('.mempane .mem')].some((m) => /Bailz/.test(m.textContent))`,
      12000)
    check('a nickname given to somebody shows, live', nick === true)

    // ---- the server itself -----------------------------------------------
    /* `/api/space`, singular, with the server named in the body: there is no
       PATCH on /api/spaces/:id at all, and asking for one answers 404 - which
       is a passing test away from reading as "renaming is not live". */
    await asOwner('PATCH', '/api/space', { spaceId: space.id, name: 'Cellar' })
    const spaceRenamed = await until('the server name',
      `document.body.textContent.includes('Cellar')`, 12000)
    check('renaming the server follows, live', spaceRenamed === true)

    // ---- what a role looks like ------------------------------------------
    await asOwner('PATCH', `/api/roles/${roleId}`, { colour: '#FF00AA' })
    const recoloured = await until('the colour to follow', `(() => {
      const head = [...document.querySelectorAll('.mempane .hd2, .mempane .sect')]
        .find((h) => /Keepers/i.test(h.textContent))
      return !!head && getComputedStyle(head).color === 'rgb(255, 0, 170)'
    })()`, 12000)
    check('a role recoloured shows its new colour, live', recoloured === true)

    // ---- somebody changing their own name --------------------------------
    await js(`(async () => {
      const r = await fetch('/api/me', { method: 'PATCH',
        headers: { 'content-type': 'application/json',
                   authorization: 'Bearer ' + ${JSON.stringify(mate)} },
        body: JSON.stringify({ display_name: 'Renamed Person' }) })
      return { status: r.status } })()`)
    /* They carry a nickname in this server, which wins - so the display name
       is watched where a nickname does not reach. */
    await asOwner('POST', `/api/admin/members/${mateId}/nickname`, {
      spaceId: space.id, nickname: '',
    })
    const theirName = await until('their new name',
      `[...document.querySelectorAll('.mempane .mem')].some((m) => /Renamed Person/.test(m.textContent))`,
      12000)
    check('somebody renaming themselves is seen by others, live', theirName === true)

    // ---- a channel taken away --------------------------------------------
    await asOwner('DELETE', `/api/channels/${chanId}`)
    const chanGone = await until('the channel to go',
      `![...document.querySelectorAll('.chan')].some((c) => /live-renamed/.test(c.textContent))`,
      12000)
    check('a channel deleted by somebody else goes, live', chanGone === true)

    // ---- a role taken away -----------------------------------------------
    await asOwner('DELETE', `/api/roles/${roleId}`)
    const headGone = await until('the heading to go',
      `![...document.querySelectorAll('.mempane .hd2, .mempane .sect')]
         .some((h) => /Keepers/i.test(h.textContent))`, 12000)
    check('a role deleted takes its heading with it, live', headGone === true)

    // ---- and somebody removed from the server ----------------------------
    await asOwner('DELETE', `/api/admin/members/${mateId}`, { spaceId: space.id })
    const memberGone = await until('them to leave the list',
      `![...document.querySelectorAll('.mempane .mem')].some((m) => /Renamed Person/.test(m.textContent))`,
      12000)
    check('somebody removed leaves the member list, live', memberGone === true)

    // ---- an invite somebody else makes -----------------------------------
    /*
     * The list was fetched once when the pane opened and followed nothing
     * after that, so two people tidying invites saw two different lists and
     * a code revoked by one still looked live to the other.
     */
    const opened = await js(`(() => {
      const b = [...document.querySelectorAll('.sidepane [aria-label]')]
        .find((x) => / settings$/.test(x.getAttribute('aria-label')))
      if (!b) return { ok: false, why: 'no way into the server settings' }
      b.click()
      return { ok: true } })()`)
    check('the server settings can be opened', opened.ok === true, opened)
    await until('them', `!!document.querySelector('.settings')`, 8000)
    await js(`(() => {
      const b = [...document.querySelectorAll('.snav button')]
        .find((x) => /invites/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await wait(900)

    /* Your settings and a server's are one window now, and the pane that
       scrolls in it is .smain. .sbody was the older window's, so this
       counted nothing and reported 0 -> 0 whatever happened. */
    const COUNT = `document.querySelectorAll('${W.SETTINGS_PANE} .chan, .sbody .chan').length`
    const had = await js(COUNT)
    const made = await asOwner('POST', '/api/invites', { spaceId: space.id })
    check('an invite can be made', made.status === 200, made)

    const grew = await until('the list to follow', `${COUNT} > ${had}`, 12000)
    console.log(`      invites listed: ${had} -> ${await js(COUNT)}`)
    check('an invite somebody else makes appears without reopening the pane',
      grew === true)

    // ---- and your own second window --------------------------------------
    /*
     * A preference is a fact about you and nobody else, which is exactly why
     * it was told to nobody at all - including your own other machine.
     * Muting a channel on the desktop left it ringing on the phone until
     * that one was reloaded.
     *
     * The window here is the owner's, so "somebody else" is the same person
     * somewhere else: the change is made through the API with the owner's own
     * token, which is what a second window is.
     */
    await js(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      return 1 })()`)
    await wait(600)

    const chan = await js(`(async () => {
      const r = await (await fetch('/api/channels?spaceId=' + ${JSON.stringify(space.id)}, {
        headers: { authorization: 'Bearer ' + ${JSON.stringify(owner)} } })).json()
      const c = (r.channels || []).find((x) => /general/i.test(x.name))
      return c ? c.id : null })()`)
    check('there is a channel to quieten', !!chan, chan)

    const muted = await asOwner('PUT', `/api/channels/${chan}/prefs`, { muteFor: 0 })
    check('it can be muted from elsewhere', muted.status === 200, muted)

    /* The bell on the row is drawn from the same fact, so it is the honest
       thing to watch. */
    const wentQuiet = await until('the row to go quiet', `(() => {
      const row = [...document.querySelectorAll('.sidepane .chan')]
        .find((c) => /general/i.test(c.textContent || ''))
      return !!row && !!row.querySelector('svg')
    })()`, 12000)
    check('a channel muted in another window goes quiet here too', wentQuiet === true)
  },
}
