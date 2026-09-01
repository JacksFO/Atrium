/**
 * Who @ offers, in the place you are typing it.
 *
 * Reported as "when Im in a server chat and i do @namehere it shows me a list
 * of all names I have added no ones that are only in that server" - both
 * halves of which are the same fault. The list was built from every member
 * the account could see anywhere, which is everyone added as a friend plus
 * everyone from every other server, so it offered people who are not here and
 * left out people who are.
 *
 * Naming somebody who cannot see the channel does nothing: a mention is
 * recorded against the people entitled to read it. So the picker was offering
 * names that would have gone nowhere.
 *
 * Both directions, because the fix that only removes is as wrong as the bug:
 * a picker that offers nobody would pass a test looking only for absences.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'mention-scope',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy', 'Cami'],
    })
    check('the server can be set up', setup.ok === true, setup.why)

    /*
     * A second server with nobody else in it, so the friends made above are
     * friends who are NOT here - which is the case the report is about.
     */
    const made = await js(`(async () => {
      const t = localStorage.getItem('atrium.token')
      const r = await (await fetch('/api/spaces', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t },
        body: JSON.stringify({ name: 'The Attic' }) })).json()
      return { ok: !!r.space, id: r.space && r.space.id } })()`)
    check('a second server can be made', made.ok === true, made)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(2000)

    /** Type an @ into the composer and read back what is offered. */
    const offer = async () => {
      const names = await js(`(async () => {
        const input = (document.querySelector('.cmp textarea') || [...document.querySelectorAll('.cmp input')].find((i) => i.type !== 'file'))
        if (!input) return { ok: false, why: 'no composer' }
        // Through the setter React installed, or React never hears about it
        // and the picker is driven by a value the component does not have.
        const set = Object.getOwnPropertyDescriptor(
          (document.querySelector('.cmp textarea') ? window.HTMLTextAreaElement : window.HTMLInputElement).prototype, 'value').set
        set.call(input, '')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.focus()
        set.call(input, '@')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 700))
        const rows = [...document.querySelectorAll('.cmp .picker .pitem b')]
        return { ok: true, open: !!document.querySelector('.cmp .picker'),
          names: rows.map((n) => n.textContent.trim()) } })()`)
      // Leave the box empty for the next one.
      await js(`(() => {
        const input = (document.querySelector('.cmp textarea') || [...document.querySelectorAll('.cmp input')].find((i) => i.type !== 'file'))
        const set = Object.getOwnPropertyDescriptor((document.querySelector('.cmp textarea') ? window.HTMLTextAreaElement : window.HTMLInputElement).prototype, 'value').set
        if (input) { set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) }
        return 1 })()`)
      return names
    }

    // --- the first server, where the friends actually are --------------------
    const home = await offer()
    console.log('      in the first server: ' + JSON.stringify(home))
    check('the picker opens on @', home.open === true, home)
    /*
     * The precondition for the whole spec. If it offered nobody here, every
     * absence checked below would pass for the wrong reason.
     */
    check('and offers the people who are in this server',
      home.names.some((n) => /baileyyy/i.test(n)) && home.names.some((n) => /Cami/i.test(n)),
      home.names)

    // --- the second server, where they are not -------------------------------
    await js(`(() => { const p = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]; if (p[1]) p[1].click(); return 1 })()`)
    await wait(2500)

    const attic = await offer()
    console.log('      in The Attic: ' + JSON.stringify(attic))
    check('the picker still opens there', attic.open === true, attic)
    check('and offers me, who is in it',
      attic.names.some((n) => /JacksFO/i.test(n)), attic.names)
    check('and not the friends who are not in it',
      !attic.names.some((n) => /baileyyy/i.test(n) || /Cami/i.test(n)), attic.names)

    /*
     * Roles are the same fault one level along: ready carries the roles of
     * every server, and each of them has an Owner. Another server's role has
     * no business being offered here.
     */
    const roleRows = await js(`(async () => {
      const input = (document.querySelector('.cmp textarea') || [...document.querySelectorAll('.cmp input')].find((i) => i.type !== 'file'))
      const set = Object.getOwnPropertyDescriptor((document.querySelector('.cmp textarea') ? window.HTMLTextAreaElement : window.HTMLInputElement).prototype, 'value').set
      set.call(input, '@')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 700))
      const out = [...document.querySelectorAll('.cmp .picker .pitem')].map((r) => ({
        name: (r.querySelector('b') || {}).textContent.trim(),
        hint: (r.querySelector('.args') || {}).textContent || '',
      }))
      set.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return out })()`)
    console.log('      rows: ' + JSON.stringify(roleRows))
    // One Owner, not one per server on the machine.
    const owners = roleRows.filter((r) => /^owner$/i.test(r.name))
    check('and only this server\'s Owner role, not every server\'s',
      owners.length <= 1, roleRows.map((r) => r.name))
  },
}
