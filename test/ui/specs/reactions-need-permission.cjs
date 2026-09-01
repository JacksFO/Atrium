/**
 * Somebody who cannot react is not offered the button.
 *
 * The reaction control was shown to everybody. Clicking it sent a request the
 * server refused, and nothing said why - so to the person clicking, the app
 * was broken rather than the permission missing.
 *
 * There are three ways to react and all three had to be closed, which is the
 * reason this spec exists rather than a line in another one: the button in
 * the hover row, the pills under a message, and the emoji row in the
 * right-click menu. Shutting the first and leaving the third is a fix that
 * looks complete and still fails silently.
 *
 * The pills stay on screen on purpose. Who reacted is worth knowing whether
 * or not you can join in - they simply stop being something you can press.
 *
 * Both directions are checked. A spec that only sees the controls disappear
 * cannot tell "the permission works" from "the message never rendered", so
 * the permission is given back at the end and everything has to return.
 */
const { signIn, sayAs } = require('../lib.cjs')

/** What this account is actually offered on the message on screen. */
const OFFERED = `(() => {
  const row = document.querySelector('.msg')
  if (!row) return { row: false }
  const pills = [...document.querySelectorAll('.rcs .rc')]
  return {
    row: true,
    pills: pills.length,
    /*
     * Pressable means pressable, however it is done.
     *
     * The client this replaced swapped the button for a span with .is-static
     * on it. This one keeps the button and disables it, which cannot be
     * pressed either and keeps the disabled look a browser gives for free.
     * Either satisfies the thing being asked - so the check is "can this be
     * pressed", not "which element is it".
     */
    pillsPressable: pills.filter((p) => p.tagName === 'BUTTON' && !p.disabled).length,
    pillsStatic: pills.filter(
      (p) => p.classList.contains('is-static') || p.disabled).length,
    // The hover row is rendered whether or not the pointer is over it.
    reactButton: !!document.querySelector('.tools button[title="React"]'),
    replyButton: !!document.querySelector('.tools button[title="Reply"]'),
  }
})()`

/** Open the right-click menu on the message and report what it offers. */
const MENU = `(async () => {
  const row = document.querySelector('.msg')
  if (!row) return { opened: false }
  const r = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + 10),
  }))
  await new Promise((res) => setTimeout(res, 400))
  const menu = document.querySelector('.ctx')
  const out = {
    opened: !!menu,
    emojiRow: !!document.querySelector('.mq'),
    items: menu ? menu.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80) : null,
  }
  document.body.click()
  await new Promise((res) => setTimeout(res, 200))
  return out
})()`

module.exports = {
  name: 'reactions-need-permission',
  width: 1280,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)
    const mate = setup.friends?.Baileyyy
    check('there is somebody without the run of the place', !!mate?.token, setup.friends)

    /* A message with a reaction already on it, so there is a pill to judge. */
    await sayAs(js, setup.me.token, 'react to this')
    await wait(600)
    const reacted = await js(`(async () => {
      const r = await fetch('/api/channels', { headers: { authorization: 'Bearer ' + ${JSON.stringify(setup.me.token)} } })
      return { ok: r.ok } })()`)
    void reacted

    await win.loadURL(base + '/')
    await until('the message', `document.querySelectorAll('.msg').length > 0`, 15000)
    await wait(1000)

    // React to it as the owner, through the UI, so there is a real pill.
    await js(`(() => {
      const b = document.querySelector('.tools button[title="React"]')
      if (b) b.click()
      return 1 })()`)
    await wait(600)
    /* The React button on a message opens the whole picker here; the row of
       four lives on the right-click menu. Either way ends in a reaction. */
    await until('the picker', `!!document.querySelector('.emoji .gr button')`, 8000)
    await js(`(() => {
      const first = document.querySelector('.emoji .gr button')
      if (first) first.click()
      return 1 })()`)
    await until('the reaction', `document.querySelectorAll('.rcs .rc').length > 0`, 8000)

    // ---- as somebody who may react ------------------------------------------
    const asOwner = await js(OFFERED)
    console.log('      owner:     ' + JSON.stringify(asOwner))
    check('there is a message with a reaction on it', asOwner.pills > 0, asOwner)
    check('the owner is offered the button', asOwner.reactButton === true, asOwner)
    check('and the pills can be pressed', asOwner.pillsPressable === asOwner.pills, asOwner)

    // ---- take the permission away from everyone -----------------------------
    const revoked = await js(`(async () => {
      const H = { 'content-type': 'application/json',
                  authorization: 'Bearer ' + ${JSON.stringify(setup.me.token)} }
      const roles = await (await fetch('/api/roles', { headers: H })).json()
      const list = roles.roles || roles
      const everyone = list.find((r) => r.kind === 'everyone')
      if (!everyone) return { ok: false, why: 'no @everyone role', got: list.map((r) => r.kind) }
      // SELECT * hands back the raw column, so this is a JSON string on the
      // way out and an array on the way in.
      const now = typeof everyone.permissions === 'string'
        ? JSON.parse(everyone.permissions) : (everyone.permissions || [])
      const kept = now.filter((p) => p !== 'add_reactions')
      const r = await fetch('/api/roles/' + everyone.id, {
        method: 'PATCH', headers: H, body: JSON.stringify({ permissions: kept }) })
      return { ok: r.ok, status: r.status, id: everyone.id, kept,
               had: now.includes('add_reactions') } })()`)
    console.log('      revoked:   ' + JSON.stringify({ ok: revoked.ok, status: revoked.status }))
    check('add_reactions can be taken away from @everyone', revoked.ok === true, revoked)
    check('and it really was in the list to begin with', revoked.had === true, revoked)
    check('and is not in it now', revoked.kept && !revoked.kept.includes('add_reactions'), revoked.kept)

    /* Become them. */
    await js(`(() => { localStorage.setItem('atrium.token', ${JSON.stringify(mate.token)}); return 1 })()`)
    await win.loadURL(base + '/')
    await until('their view', `document.querySelectorAll('.msg').length > 0`, 15000)
    await wait(1200)

    const asMate = await js(OFFERED)
    console.log('      no perm:   ' + JSON.stringify(asMate))
    // The precondition: they are looking at the same message, not an empty
    // channel where every control is missing for the dullest of reasons.
    check('they can see the message', asMate.row === true, asMate)
    check('and the reaction is still on screen', asMate.pills > 0, asMate)

    check('no React button is offered', asMate.reactButton === false, asMate)
    check('but the rest of the row is untouched', asMate.replyButton === true, asMate)
    check('and the pills are not buttons any more',
      asMate.pills > 0 && asMate.pillsPressable === 0, asMate)
    check('they are shown as plainly not pressable', asMate.pillsStatic === asMate.pills, asMate)

    const mateMenu = await js(MENU)
    console.log('      their menu:' + JSON.stringify(mateMenu))
    check('the right-click menu still opens', mateMenu.opened === true, mateMenu)
    check('and offers no emoji row - the third way in', mateMenu.emojiRow === false, mateMenu)

    // ---- give it back, so this proves the permission and not the render -----
    await js(`(() => { localStorage.setItem('atrium.token', ${JSON.stringify(setup.me.token)}); return 1 })()`)
    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.msg').length > 0`, 15000)
    await wait(800)

    const restored = await js(`(async () => {
      const H = { 'content-type': 'application/json',
                  authorization: 'Bearer ' + ${JSON.stringify(setup.me.token)} }
      const roles = await (await fetch('/api/roles', { headers: H })).json()
      const list = roles.roles || roles
      const everyone = list.find((r) => r.kind === 'everyone')
      const now = typeof everyone.permissions === 'string'
        ? JSON.parse(everyone.permissions) : (everyone.permissions || [])
      const back = [...now.filter((p) => p !== 'add_reactions'), 'add_reactions']
      const r = await fetch('/api/roles/' + everyone.id, {
        method: 'PATCH', headers: H, body: JSON.stringify({ permissions: back }) })
      return { ok: r.ok } })()`)
    check('the permission can be given back', restored.ok === true, restored)

    await js(`(() => { localStorage.setItem('atrium.token', ${JSON.stringify(mate.token)}); return 1 })()`)
    await win.loadURL(base + '/')
    await until('their view again', `document.querySelectorAll('.msg').length > 0`, 25000)
    await wait(1500)

    const after = await js(OFFERED)
    console.log('      restored:  ' + JSON.stringify(after))
    check('and then they are offered it', after.reactButton === true, after)
    check('the message is back on screen', after.pills > 0, after)
    check('and the pills can be pressed again',
      after.pills > 0 && after.pillsPressable === after.pills, after)
  },
}
