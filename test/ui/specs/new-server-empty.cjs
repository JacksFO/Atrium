/**
 * A server you just made has you in it, and nobody else.
 *
 * Reported: "I just made a new server and all the people that was in my
 * original server are also shown in my new server."
 *
 * The database was right - the new server had exactly one member. The screen
 * invented the rest. The member column filters everyone this account can see
 * down to the people in the server on show, and when it does not know who
 * they are it fell back to showing all of them. A server made a moment ago is
 * exactly the case it does not know: that map arrives once, with `ready`, and
 * nothing re-sends it.
 *
 * So this makes a server the way somebody actually does - from inside the
 * running app, without reconnecting - which is the only way to catch it. A
 * reload would have papered straight over it.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'new-server-empty',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy', 'Keeko', 'Cami'],
    })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.mrow').length > 0`)
    await wait(2000)

    const before = await js(`(() => [...document.querySelectorAll('.mempane .mrow')]
      .map((m) => m.textContent.trim()))()`)
    console.log('      the original server lists: ' + JSON.stringify(before))
    check('the original server has everybody in it', before.length >= 4, before)

    /*
     * Made through the app's own API from the page that is already running,
     * so the client is in exactly the state it is in when somebody presses
     * the button - no reconnection, no fresh ready.
     */
    const made = await js(`(async () => {
      const token = ${JSON.stringify(setup.me?.token ?? '')}
      const r = await (await fetch('/api/spaces', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ name: 'Somewhere New' }) })).json()
      return { ok: !!r.space, id: r.space && r.space.id } })()`)
    check('a new server can be made', made.ok === true, made)

    // Let the rail hear about it, then walk into it the way anybody would.
    await until('the new server in the rail',
      `document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)').length >= 2`, 12000)
    await wait(1500)
    await js(`(() => {
      const pips = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]
      if (pips[1]) pips[1].click()
      return 1 })()`)
    await wait(3000)

    const now = await js(`(() => ({
      server: (document.querySelector('.sidepane .nm, .sidepane .chd .tt') || {}).textContent || '',
      names: [...document.querySelectorAll('.mempane .mrow')].map((m) => m.textContent.trim()),
    }))()`)
    console.log('      the new server lists: ' + JSON.stringify(now))

    check('we are looking at the new server', /Somewhere New/i.test(now.server), now.server)
    check('it lists exactly one person', now.names.length === 1, now.names)
    check('and that person is the one who made it',
      /JacksFO/i.test(now.names[0] || ''), now.names)

    /*
     * Named individually, because "one person" would also pass if the wrong
     * single person were listed.
     */
    for (const other of ['baileyyy', 'Keeko', 'Cami']) {
      check(`${other} is not in a server they never joined`,
        !now.names.some((n) => new RegExp(other, 'i').test(n)), now.names)
    }

    // And the original is untouched by any of this.
    await js(`(() => {
      const pips = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]
      if (pips[0]) pips[0].click()
      return 1 })()`)
    await wait(2500)
    const back = await js(`(() => [...document.querySelectorAll('.mempane .mrow')]
      .map((m) => m.textContent.trim()))()`)
    console.log('      back in the original: ' + JSON.stringify(back))
    check('the original still lists everybody', back.length === before.length, back)
  },
}
