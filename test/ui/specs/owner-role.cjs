/**
 * Whoever made a server can rename and recolour its Owner role.
 *
 * Asked for directly: "can we add the abilty to chaage owner role colour and
 * name". The server already allowed it - the route takes name, colour, hoist
 * and mentionable on the Owner role from whoever owns that server - but the
 * settings panel replaced the whole editor with a note, so there was nothing
 * to type into.
 *
 * What it allows is still not editable, and it still cannot be deleted: it
 * allows everything by definition, and the position ordering is anchored on
 * it. Only the dressing opens up.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'owner-role',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    // Baileyyy's own server, so this is asked of somebody who really owns one
    // rather than of whoever happens to run the machine.
    const mine = await js(`(async () => {
      const token = ${JSON.stringify(setup.friends?.baileyyy?.token ?? '')}
      if (!token) return { ok: false, why: 'no token' }
      const made = await (await fetch('/api/spaces', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ name: 'Baileys Dictatorship' }) })).json()
      localStorage.setItem('atrium.token', token)
      return { ok: !!made.space, spaceId: made.space && made.space.id } })()`)
    check('he has a server of his own', mine.ok === true, mine)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)').length >= 2`)
    await wait(2000)
    await js(`(() => { const p = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]; if (p[1]) p[1].click(); return 1 })()`)
    await wait(2000)

    /** Open settings and land on the roles pane. */
    const openRoles = async () => {
      await js(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /settings/i.test(x.title || x.getAttribute('aria-label') || ''))
        if (b) b.click()
        return 1 })()`)
      await wait(1500)
      await js(`(() => {
        const b = [...document.querySelectorAll('.snav button')].find((x) => /roles/i.test(x.textContent))
        if (b) b.click()
        return 1 })()`)
      await wait(1200)
      // And select the Owner role in the list on the left.
      return js(`(() => {
        const rows = [...document.querySelectorAll('.chlist .chan')]
        const owner = rows.find((r) => /owner/i.test(r.textContent))
        if (owner) owner.click()
        return { roles: rows.map((r) => r.textContent.trim()), found: !!owner } })()`)
    }

    const opened = await openRoles()
    check('the roles pane lists the Owner role', opened.found === true, opened.roles)
    await wait(1000)

    const editor = await js(`(() => {
      const rows = [...document.querySelectorAll('.sbody .row, .row')]
      const titled = rows.map((r) => (r.querySelector('.row .t') || {}).textContent || '').filter(Boolean)
      return {
        titles: titled,
        nameInput: !!document.querySelector('.card .fld input[type="text"], .card .fld input:not([type])'),
        /* A colour picker rather than a row of chosen colours - every colour
           rather than eight of them, which is the same offer made
           differently. */
        swatches: document.querySelectorAll('input[type="color"]').length,
        note: [...document.querySelectorAll('.card .hint')].map((h) => h.textContent).join(' '),
        deleteOffered: [...document.querySelectorAll('button')].some((b) => /delete role/i.test(b.textContent)),
      } })()`)
    console.log('      owner role editor: ' + JSON.stringify(editor))

    check('the owner is given a name field', editor.nameInput === true, editor.nameInput)
    check('and a set of colours to choose from', editor.swatches > 0, editor.swatches)
    check('and is told its permissions are fixed',
      /allows everything|cannot be changed/i.test(editor.note), editor.note)
    check('and is not offered a way to delete it', editor.deleteOffered === false)

    // Rename it, the way the panel does: type, then blur.
    const renamed = await js(`(async () => {
      const input = document.querySelector('.card .fld input[type="text"], .card .fld input:not([type])')
      if (!input) return { ok: false, why: 'no field' }
      /*
       * Typed, then focusout - not focus() and blur().
       *
       * The panel saves on blur and React listens for focusout, so the event
       * has to bubble to the root either way. Going through real focus made
       * this depend on the Electron window being the focused window: when it
       * was not, focus() did nothing, blur() had nothing to undo, no event
       * fired, and the name silently never saved.
       *
       * Worse, the check that was meant to catch that could not: comparing
       * activeElement to the input reads as "blurred" both when focus worked
       * and when it never happened at all.
       */
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(input, 'Supreme Leader')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      return { ok: true, typed: input.value } })()`)
    check('the name can be typed into', renamed.typed === 'Supreme Leader', renamed)
    await wait(2000)


    // Pick a colour that is not the one it was seeded with.
    /* Set on the picker and let go of, which is what the panel listens for:
       a colour input fires on every step of a drag, so it saves when the
       dragging stops rather than on the way. */
    await js(`(() => {
      const el = document.querySelector('input[type="color"]')
      if (!el) return 0
      const set = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set
      set.call(el, '#22cc88')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return 1 })()`)
    await wait(2000)

    const stored = await js(`(async () => {
      const token = ${JSON.stringify(setup.friends?.baileyyy?.token ?? '')}
      const r = await (await fetch('/api/roles?spaceId=' + ${JSON.stringify(mine.spaceId ?? '')}, {
        headers: { authorization: 'Bearer ' + token } })).json()
      const owner = (r.roles || []).find((x) => x.kind === 'owner')
      return owner ? { name: owner.name, colour: owner.colour } : null })()`)
    console.log('      stored on the server: ' + JSON.stringify(stored))

    check('the new name really reached the server',
      stored && stored.name === 'Supreme Leader', stored)
    check('and so did the new colour',
      stored && stored.colour !== '#4C8DFF', stored && stored.colour)

    /*
     * And somebody else holding manage_roles does not get those fields. The
     * server refuses them, so offering the fields would only produce an error
     * they cannot do anything about.
     */
    const asStaff = await js(`(async () => {
      const owner = ${JSON.stringify(setup.friends?.baileyyy?.token ?? '')}
      const spaceId = ${JSON.stringify(mine.spaceId ?? '')}
      const host = ${JSON.stringify(setup.me?.token ?? '')}
      const hostId = ${JSON.stringify(setup.me?.id ?? '')}
      const send = async (url, method, body, token) => (await fetch(url, { method,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: body === undefined ? undefined : JSON.stringify(body) })).json()

      // Let the host in, and give them a role that can manage roles.
      const invite = await send('/api/spaces/' + spaceId + '/invites', 'POST', {}, owner)
      await send('/api/invites/' + invite.code + '/accept', 'POST', {}, host)
      const made = await send('/api/roles', 'POST', { name: 'Staff', colour: '#8395A6', spaceId }, owner)
      const staff = (made.roles || []).find((r) => r.name === 'Staff')
      await send('/api/roles/' + staff.id, 'PATCH',
        { permissions: ['view_channels', 'read_history', 'manage_roles'] }, owner)
      await send('/api/admin/members/' + hostId + '/roles', 'POST',
        { roleId: staff.id, grant: true, spaceId }, owner)

      // Now try to rename the Owner role as them.
      const roles = await send('/api/roles?spaceId=' + spaceId, 'GET', undefined, owner)
      const ownerRole = (roles.roles || []).find((r) => r.kind === 'owner')
      const res = await fetch('/api/roles/' + ownerRole.id, { method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + host },
        body: JSON.stringify({ name: 'Mine now' }) })
      return { status: res.status } })()`)
    check('somebody else with manage_roles is refused by the server',
      asStaff.status === 403, asStaff.status)
  },
}
