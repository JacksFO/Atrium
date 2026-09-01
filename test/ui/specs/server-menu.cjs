/**
 * Right-clicking a server offers a menu, and does not rearrange anything.
 *
 * It used to nudge the server along the rail with no menu at all - meant as
 * an easier aim than a drag in a narrow column, and reported as "why did that
 * move?" by somebody looking for a menu. The nudge is still available; it is
 * in the menu now, where it says what it is about to do.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'server-menu',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the rail', `document.querySelectorAll('.pane.rail .rl').length > 0`)
    await wait(1500)

    /* The order before, so "it did not move" is measured rather than felt. */
    const order = () => js(`[...document.querySelectorAll('.pane.rail .rl')]
      .map((b) => (b.getAttribute('title') || '')).filter((t) => t)`)
    const before = await order()

    const opened = await js(`(() => {
      const tile = [...document.querySelectorAll('.pane.rail .rl')]
        .find((b) => !b.classList.contains('rlread') && !b.classList.contains('rlnew')
          && b.getAttribute('aria-label') !== 'Conversations')
      if (!tile) return { hit: false, why: 'no server tile' }
      const r = tile.getBoundingClientRect()
      tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
        clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }))
      return { hit: true } })()`)
    check('a server can be right-clicked', opened.hit === true, opened)
    await until('the menu', `!!document.querySelector('.ctx')`)

    const items = await js(`[...document.querySelectorAll('.ctx .mitem')]
      .map((b) => b.textContent.trim())`)
    console.log('      items: ' + JSON.stringify(items))
    check('it offers to mark the server read', items.some((t) => /mark as read/i.test(t)), items)
    check('and to move it', items.some((t) => /move up/i.test(t))
      && items.some((t) => /move down/i.test(t)), items)
    /* The owner cannot leave their own server - the server says so - so the
       item is absent rather than an item that only ever refuses. */
    check('and the owner is not offered a way to leave their own',
      !items.some((t) => /leave server/i.test(t)), items)

    check('and nothing moved just from asking', JSON.stringify(await order()) === JSON.stringify(before),
      { before, after: await order() })
  },
}
