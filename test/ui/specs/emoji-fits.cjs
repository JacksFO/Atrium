/**
 * The emoji panel fits its own width.
 *
 * Reported as "there is a slide bar left and right which i dont want just
 * make it big enough to see them all without scrolling left and right".
 *
 * A sideways scrollbar on a grid of pictures is always something refusing to
 * shrink rather than a panel that is too narrow - grid items will not go
 * below their own contents unless told they may. This finds which one, so
 * the fix is aimed rather than guessed at.
 */
const { signIn, typeAndSend } = require('../lib.cjs')

module.exports = {
  name: 'emoji-fits',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(2000)

    const sent = await typeAndSend(js, 'something to react to')
    check('there is a message to react to', sent !== false, sent)
    await until('the message', `document.querySelectorAll('.stream [data-msg]').length > 0`)
    await wait(800)

    // Open it the way somebody does: right-click, then the plus.
    await js(`(() => {
      const rows = [...document.querySelectorAll('.stream [data-msg]')]
      rows[rows.length - 1].dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }))
      return 1 })()`)
    await until('the menu', `!!document.querySelector('.ctx')`, 6000)
    await wait(400)
    await js(`(() => {
      const b = [...document.querySelectorAll('.mq')].pop()
      if (b) b.click()
      return 1 })()`)
    await until('the emoji panel', `!!document.querySelector('.emoji')`, 6000)
    await wait(600)

    const fit = await js(`(() => {
      const panel = document.querySelector('.emoji')
      if (!panel) return { found: false }
      /*
       * Anything inside holding more than it has room for. A scrollbar is
       * drawn by whichever box that is, so naming it is the whole diagnosis.
       */
      const spilling = []
      for (const el of [panel, ...panel.querySelectorAll('*')]) {
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          spilling.push({
            cls: (typeof el.className === 'string' ? el.className : el.tagName).slice(0, 24),
            by: el.scrollWidth - el.clientWidth,
            wants: el.scrollWidth,
            has: el.clientWidth,
          })
        }
      }
      const grid = panel.querySelector('.gr')
      const cell = panel.querySelector('.gr button')
      return {
        found: true,
        spilling,
        panelWidth: Math.round(panel.getBoundingClientRect().width),
        gridWidth: grid ? Math.round(grid.getBoundingClientRect().width) : null,
        cellWidth: cell ? Math.round(cell.getBoundingClientRect().width) : null,
        columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null,
      } })()`)
    console.log('      panel: ' + JSON.stringify(fit))

    check('the panel is on screen', fit.found === true, fit)
    /*
     * The whole complaint. Nothing in a grid of pictures should need scrolling
     * sideways: every column is meant to be visible at once.
     */
    check('nothing in it needs scrolling sideways',
      (fit.spilling || []).length === 0, fit.spilling)
    // And it is genuinely showing a grid, so the check above is not vacuous.
    check('and it really is a grid of emoji',
      (fit.columns ?? 0) >= 6 && (fit.cellWidth ?? 0) > 0, fit)
  },
}
