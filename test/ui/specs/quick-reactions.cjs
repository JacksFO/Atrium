/**
 * The row of faces on a message, and the way to all the others.
 *
 * Two things asked for together: "when right clicking a message to send a
 * reaction have a + button there too so you can open up the entire emoji
 * panel", and "it should always show the most common emojis you use aswell
 * in the 5 section if you use them alot".
 *
 * The hover row has had a plus all along; the right-click menu hid the same
 * thing behind a line of text further down that read like another command
 * rather than like more faces.
 */
const { signIn, typeAndSend } = require('../lib.cjs')

module.exports = {
  name: 'quick-reactions',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(2000)

    // Start from nothing learned, so the defaults are really the defaults.
    await js(`(() => { localStorage.removeItem('atrium.emoji.used'); return 1 })()`)
    await win.loadURL(base + '/')
    await until('the app again', `document.querySelectorAll('.chan').length > 0`)
    await wait(2000)

    const sent = await typeAndSend(js, 'something to react to')
    check('there is a message to react to', sent !== false, sent)
    await until('the message', `document.querySelectorAll('.stream [data-msg]').length > 0`)
    await wait(800)

    /** Right-click the last message and read the menu. */
    const openMenu = async () => {
      await js(`(() => {
        const rows = [...document.querySelectorAll('.stream [data-msg]')]
        const row = rows[rows.length - 1]
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }))
        return 1 })()`)
      await until('the menu', `!!document.querySelector('.ctx')`, 6000)
      await wait(400)
      return js(`(() => {
        const quick = [...document.querySelectorAll('.mq')]
        return {
          faces: quick.map((b) => b.textContent.trim()),
          items: [...document.querySelectorAll('.ctx .mitem')].map((b) => b.textContent.trim()),
        } })()`)
    }

    const first = await openMenu()
    console.log('      menu: ' + JSON.stringify(first))
    /* Four faces and the plus. The client this replaced offered five and a
       more button; neither is wrong, and this follows the app. */
    check('the menu offers a row of faces', first.faces.length >= 5, first.faces)
    check('and the last of them is the way to all the rest',
      first.faces[first.faces.length - 1] === '+', first.faces)
    /*
     * The text row it replaces. Two ways to the same panel in one small menu
     * is furniture, and the plus is where the hover row already puts it.
     */
    check('and it no longer says it twice',
      !first.items.some((t) => /add reaction/i.test(t)), first.items)

    // --- the plus opens the whole panel --------------------------------------
    const opened = await js(`(() => {
      const b = [...document.querySelectorAll('.mq')].pop()
      if (!b || b.textContent.trim() !== '+') return { ok: false, why: 'no plus' }
      const r = b.getBoundingClientRect()
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!el || !b.contains(el)) return { ok: false, why: 'something is on top of it' }
      b.click()
      return { ok: true } })()`)
    check('the plus can be pressed', opened.ok === true, opened)
    await until('the emoji panel', `!!document.querySelector('.emoji')`, 6000)
    const panel = await js(`(() => document.querySelectorAll('.emoji .gr button').length)()`)
    check('and the whole panel opens', panel > 20, panel)

    // Choose one nobody would have in their defaults.
    const chose = await js(`(() => {
      const cells = [...document.querySelectorAll('.emoji .gr button')]
      const pick = cells.find((c) => c.textContent.trim() === '👀') || cells[9]
      if (!pick) return null
      const face = pick.textContent.trim()
      pick.click()
      return face })()`)
    console.log('      chose: ' + JSON.stringify(chose))
    check('a reaction can be chosen from it', !!chose, chose)
    await wait(1200)

    /*
     * And the row learns. Used once it is already ahead of four defaults
     * that have never been pressed.
     */
    await js(`(() => { document.body.click(); return 1 })()`)
    await wait(400)
    const after = await openMenu()
    console.log('      after using ' + chose + ': ' + JSON.stringify(after.faces))
    check('what you actually used is now in the row',
      after.faces.includes(chose), { chose, faces: after.faces })
    check('and it is at the front of it', after.faces[0] === chose, after.faces)
    check('and the row is still five and a plus',
      after.faces.length === first.faces.length, after.faces)
  },
}
