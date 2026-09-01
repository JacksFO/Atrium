/**
 * The message box on a phone, empty.
 *
 * composer-grows checks that it expands as you type, and does it at 1400px.
 * Nothing looked at it narrow and empty - which is the state it is in every
 * time somebody opens the app, and the state a screenshot showed with its
 * own placeholder cut in half and a scrollbar beside it.
 *
 * The box is sized from its content, and an empty box has none - so a
 * placeholder that wraps to two lines has one line of room to be drawn in.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'composer-phone',
  width: 390,
  height: 844,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the message box', `!!document.querySelector('.cmp textarea')`)
    await wait(1800)

    const empty = await js(`(() => {
      const t = document.querySelector('.cmp textarea')
      if (!t) return { found: false }
      const r = t.getBoundingClientRect()
      const cs = getComputedStyle(t)
      return {
        found: true,
        value: t.value,
        placeholder: t.placeholder,
        /* More content than room is the whole fault: with no value at all,
           the only thing that can overflow is the placeholder. */
        scrollHeight: t.scrollHeight,
        clientHeight: t.clientHeight,
        clipped: t.scrollHeight > t.clientHeight + 1,
        scrolls: t.scrollHeight > t.clientHeight + 1 && cs.overflowY !== 'hidden',
        width: Math.round(r.width),
        height: Math.round(r.height),
        lineHeight: cs.lineHeight,
        overflowY: cs.overflowY,
      } })()`)
    console.log('      empty box: ' + JSON.stringify(empty))

    check('the message box is there', empty.found === true, empty)
    check('and nothing is in it yet', empty.value === '', empty.value)
    check('the placeholder is not cut off',
      empty.clipped === false, {
        placeholder: empty.placeholder,
        scrollHeight: empty.scrollHeight,
        clientHeight: empty.clientHeight,
      })

    /*
     * And the whole composer row stays inside the screen. A box that fits its
     * own text and hangs off the edge is the same fault one layer out.
     */
    const row = await js(`(() => {
      const c = document.querySelector('.cmp')
      const r = c.getBoundingClientRect()
      return {
        left: Math.round(r.left), right: Math.round(r.right),
        vw: window.innerWidth,
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      } })()`)
    check('the composer is inside the screen',
      row.left >= 0 && row.right <= row.vw, row)
    check('and the page does not scroll sideways', row.sideways === false, row)

    // Typing still grows it, which is what composer-grows checks at desktop
    // width - repeated here because the fix for the above must not undo it.
    await js(`(() => {
      const t = document.querySelector('.cmp textarea')
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      set.call(t, 'one\\ntwo\\nthree')
      t.dispatchEvent(new Event('input', { bubbles: true }))
      return 1 })()`)
    await wait(400)
    const grown = await js(`(() => {
      const t = document.querySelector('.cmp textarea')
      return { height: Math.round(t.getBoundingClientRect().height) } })()`)
    check('and it still grows when there is something to show',
      grown.height > empty.height, { empty: empty.height, grown: grown.height })
  },
}
