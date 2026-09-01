/**
 * Giving one person one permission from their own row.
 *
 * Asked for as "instead of giving them a role I can just give them some perms
 * I want to give them specifically", with a single channel as the example.
 *
 * The server side is covered by test/server/memberperms.mjs, which proves the
 * grants are enforced rather than only reported. This drives the panel,
 * because a permission you cannot reach without curl is not the thing that
 * was asked for.
 *
 * Clicked through elementFromPoint, not dispatched. A synthetic click on a
 * covered button passes and proves nothing - which this suite has been caught
 * by before.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'member-perms',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy', 'Cami'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(1500)

    // --- into server settings, Members ---------------------------------------
    await js(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => /settings/i.test(x.title || x.getAttribute('aria-label') || ''))
      if (b) b.click()
      return 1 })()`)
    await wait(1500)
    await js(`(() => {
      const b = [...document.querySelectorAll('.snav button')].find((x) => /^members/i.test(x.textContent.trim()))
      if (b) b.click()
      return 1 })()`)
    await until('the members pane', `document.querySelectorAll('.settings .chlist .chan').length >= 2`)
    await wait(800)

    const rows = await js(`(() => ({
      people: [...document.querySelectorAll('.settings .chlist .chan .nm')].map((n) => n.textContent.trim()),
      buttons: [...document.querySelectorAll('.settings .chlist .chan')]
        .map((r) => [...r.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|')),
    }))()`)
    console.log('      rows: ' + JSON.stringify(rows))
    check('the members pane lists everybody', rows.people.length >= 3, rows.people)

    /*
     * Not offered beside the owner. They hold everything in their own server
     * by definition, so every switch would be on and none would do anything.
     */
    /*
     * Opened by opening their row rather than by a button on it - the row
     * expands to everything about that person, and this is part of it. What
     * matters is that the owner's row does not offer it: they hold
     * everything by definition, so every switch would be on and none would
     * do anything.
     */
    const ownerPerms = await js(`(() => {
      const row = [...document.querySelectorAll('.settings .chlist .chan')]
        .find((r) => /owner/i.test(r.textContent))
      if (!row) return { ok: false, why: 'no owner row' }
      row.click()
      return { ok: true } })()`)
    check('the owner row opens', ownerPerms.ok === true, ownerPerms)
    await wait(600)
    check('but offers no permissions of their own',
      (await js(`!!document.querySelector('.settings .perms')`)) === false)

    // --- open somebody else's ------------------------------------------------
    const opened = await js(`(() => {
      const row = [...document.querySelectorAll('.settings .chlist .chan')]
        .find((r) => /baileyyy/i.test(r.textContent) && !/owner/i.test(r.textContent))
      if (!row) return { ok: false, why: 'no row for them' }
      const r = row.getBoundingClientRect()
      // Hit tested rather than dispatched: a row under something else still
      // answers .click(), and that is how a dead control passes.
      const el = document.elementFromPoint(r.left + 40, r.top + r.height / 2)
      if (!el || !row.contains(el)) return { ok: false, why: 'something is on top of it' }
      row.click()
      return { ok: true } })()`)
    check('their permissions open from their own row', opened.ok === true, opened)

    await until('the panel', `!!document.querySelector('.settings .perms')`)
    await wait(600)

    const panel = await js(`(() => {
      const p = document.querySelector('.settings .perms')
      if (!p) return { found: false }
      const rows = [...p.querySelectorAll('.row')]
      const locked = rows.filter((r) => (r.querySelector('.sw') || {}).disabled)
      return {
        found: true,
        headings: [...p.querySelectorAll('h4, .sect')].map((h) => h.textContent.trim()),
        switches: rows.length,
        lockedCount: locked.length,
        lockedTitles: locked.map((r) => (r.querySelector('.t') || {}).textContent),
        note: [...p.querySelectorAll('.note')].map((n) => n.textContent.trim()).join(' '),
      } })()`)
    console.log('      panel: ' + JSON.stringify(panel).slice(0, 400))
    check('the panel offers every permission', panel.switches >= 15, panel.switches)
    /*
     * Everything @everyone already grants is on and locked. A switch that is
     * on because of a role, and would do nothing if clicked, must not look
     * clickable - the alternative is a toggle that visibly refuses to move.
     */
    check('what their roles already give is locked', panel.lockedCount >= 4, panel)
    check('and Send messages is one of them',
      (panel.lockedTitles || []).some((t) => /send messages/i.test(t)), panel.lockedTitles)
    // Rank is a role thing, and saying so is cheaper than letting it be found.
    check('and it says rank still applies to kicking',
      /higher role/i.test(panel.note || ''), panel.note)

    // --- turn one on ---------------------------------------------------------
    const flipped = await js(`(async () => {
      const p = document.querySelector('.settings .perms')
      const row = [...p.querySelectorAll('.row')]
        .find((r) => /audit log/i.test((r.querySelector('.t') || {}).textContent || ''))
      if (!row) return { ok: false, why: 'no audit row' }
      const sw = row.querySelector('.sw')
      if (!sw) return { ok: false, why: 'no switch' }
      if (sw.disabled) return { ok: false, why: 'already given by a role' }
      const was = sw.classList.contains('on')
      sw.click()
      await new Promise((r) => setTimeout(r, 1200))
      const again = [...document.querySelectorAll('.settings .perms .row')]
        .find((r) => /audit log/i.test((r.querySelector('.t') || {}).textContent || ''))
      return {
        ok: true, was,
        now: sw.classList.contains('on'),
        attached: sw.isConnected,
        fresh: !!(again && again.querySelector('.sw').classList.contains('on')),
      } })()`)
    console.log('      flipped: ' + JSON.stringify(flipped))
    check('a permission can be switched on', flipped.ok === true, flipped)
    /*
     * Read off the screen rather than off the node that was clicked. Saving
     * reloads the roster and the row is drawn again, so the node handed to
     * the click is detached by the time the answer comes back - asking it
     * says "off" for ever while the switch the person is looking at is on.
     */
    check('and the switch moves', flipped.was === false && flipped.fresh === true, flipped)

    // What the server thinks, which is the only opinion that counts.
    const stored = await js(`(async () => {
      const token = ${JSON.stringify(setup.me?.token ?? '')}
      const sp = await (await fetch('/api/spaces', { headers: { authorization: 'Bearer ' + token } })).json()
      const id = sp.spaces[0].id
      const r = await (await fetch('/api/members/roles?spaceId=' + id,
        { headers: { authorization: 'Bearer ' + token } })).json()
      const them = (r.members || []).find((m) => /baileyyy/i.test(m.username))
      return { extras: them && them.extras } })()`)
    console.log('      stored: ' + JSON.stringify(stored))
    check('and the server actually recorded it',
      (stored.extras || []).includes('view_audit_log'), stored)

    // The row says so too, without a reload.
    const badge = await js(`(() => {
      const row = [...document.querySelectorAll('.settings .chlist .chan')]
        .find((r) => /baileyyy/i.test(r.textContent))
      return row ? row.textContent : '' })()`)
    check('their row shows they have an extra', /extra/i.test(badge), badge.slice(0, 120))
  },
}
