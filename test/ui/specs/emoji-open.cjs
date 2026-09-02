/**
 * How long the emoji picker takes to open, now that it holds five hundred.
 *
 * The table went from fifty-five to five hundred and eight, and the picker
 * draws every one it is given as its own button - so the first frame after
 * opening it went from a small list to a large one. jsdom said 49ms, which is
 * not a number to act on: it is slower than a browser at building a DOM by
 * enough to be the wrong answer in either direction.
 *
 * So this asks the browser. What matters is the gap between pressing the
 * button and the list being there, because that is the whole of what somebody
 * feels - and whether typing into it stays quick, since the list is rebuilt on
 * every keystroke.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'emoji-open',
  width: 1300,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1200)

    /* The button that opens it, found by what it does rather than by where it
       sits - the composer's controls have moved before. */
    const opened = await js(`(() => {
      const btn = [...document.querySelectorAll('.cmp button, .composer button')]
        .find((b) => /emoji/i.test(b.getAttribute('aria-label') || b.title || ''))
      if (!btn) return { there: false }
      const t = performance.now()
      btn.click()
      return { there: true, clickedAt: t }
    })()`)
    check('there is an emoji button', opened.there === true, opened)

    await until('the picker', `!!document.querySelector('.emoji .escroll')`, 8000)

    const drawn = await js(`(() => {
      const buttons = document.querySelectorAll('.emoji .gr button').length
      return { buttons }
    })()`)
    console.log('      drawn:   ' + JSON.stringify(drawn))
    check('it draws the whole table', drawn.buttons > 400, drawn)

    /*
     * Reopened and timed properly. The first open pays for whatever else the
     * app was doing; what somebody feels every time after is this one.
     */
    await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1 })()`)
    await wait(600)

    const timed = await js(`(async () => {
      const btn = [...document.querySelectorAll('.cmp button, .composer button')]
        .find((b) => /emoji/i.test(b.getAttribute('aria-label') || b.title || ''))
      const start = performance.now()
      btn.click()
      /* Two frames: one for React to draw it, one for the browser to have
         laid it out. Anything measured before that is measuring the click. */
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const there = document.querySelectorAll('.emoji .gr button').length
      return { ms: Math.round(performance.now() - start), there }
    })()`)
    console.log('      opening: ' + JSON.stringify(timed))
    check('and it is there once it opens', timed.there > 400, timed)
    /*
     * A tenth of a second is the line: under it a list reads as having been
     * there already, over it as having been fetched.
     */
    check('and opens without a visible wait', timed.ms < 100, timed)

    /* And typing into it, which rebuilds the list on every keystroke. */
    const typed = await js(`(async () => {
      const box = document.querySelector('.emoji input')
      if (!box) return { ms: -1 }
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const start = performance.now()
      set.call(box, 'sm')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return { ms: Math.round(performance.now() - start),
        left: document.querySelectorAll('.emoji .gr button').length }
    })()`)
    console.log('      typing:  ' + JSON.stringify(typed))
    check('and narrows quickly as somebody types', typed.ms >= 0 && typed.ms < 100, typed)
  },
}
