/**
 * The pinned messages open in one place, however you get to them.
 *
 * There are two ways in: the pin icon at the top of the chat, and the "See
 * pins" on the line saying somebody pinned something. Each anchored to
 * whatever was clicked, so the same panel appeared in the header from one and
 * halfway down the conversation from the other. Reported as wanting it at the
 * top of the chat rather than wherever the line happened to be.
 *
 * Measured as the two positions matching, rather than as "it is near the
 * top": near is a judgement and matching is a fact, and the fault was
 * precisely that they did not match.
 */
const { signIn, typeAndSend } = require('../lib.cjs')

module.exports = {
  name: 'pins-panel',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1800)

    await typeAndSend(js, 'worth keeping')
    check('there is a message to pin',
      await until('the message', `[...document.querySelectorAll('.msg')].some((m) => m.textContent.includes('worth keeping'))`))

    // Pin it through the menu, the way a person would.
    await js(`(() => {
      const row = [...document.querySelectorAll('.msg')].find((m) => m.textContent.includes('worth keeping'))
      const r = row.getBoundingClientRect()
      const x = r.left + 120, y = r.top + r.height / 2
      document.elementFromPoint(x, y).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      return 1 })()`)
    await wait(700)
    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')].find((x) => /^pin$/i.test(x.textContent.trim()))
      if (b) b.click(); return 1 })()`)

    check('a line appears saying so',
      await until('the pin notice',
        `[...document.querySelectorAll('.sys-row')].some((r) => r.textContent.includes('pinned a message'))`))

    const shut = () => js(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      return 1 })()`)

    const where = () => js(`(() => {
      const p = document.querySelector('.pinbox')
      if (!p) return null
      const r = p.getBoundingClientRect()
      return { top: Math.round(r.top), left: Math.round(r.left), onScreen: r.top >= 0 && r.bottom <= window.innerHeight + 1 }
    })()`)

    /* Real clicks at real points: a panel that opens under something else is
       exactly the kind of fault this is about. */
    const press = (selector, text) => js(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((n) => ${text === null ? 'true' : `n.textContent.includes(${JSON.stringify(text)})`})
      if (!el) return { found: false }
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2, y = r.top + r.height / 2
      const hit = document.elementFromPoint(x, y)
      if (!hit || !(hit === el || el.contains(hit))) return { found: true, covered: true, by: hit && hit.className }
      ;(hit.closest('button') || el).click()
      return { found: true, covered: false } })()`)

    /* Found by its label in script rather than in the selector: an attribute
       selector carrying quotes through two layers of string is a way to fail
       that says nothing about the app. */
    const pressIcon = () => js(`(() => { try {
      const el = [...document.querySelectorAll('.chd .icb')]
        .find((n) => n.getAttribute('aria-label') === 'Pinned messages')
      if (!el) return { found: false, saw: [...document.querySelectorAll('.chd .icb')].map((n) => n.getAttribute('aria-label')) }
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2, y = r.top + r.height / 2
      const hit = document.elementFromPoint(x, y)
      if (!hit || !(hit === el || el.contains(hit))) return { found: true, covered: true, by: hit && hit.className }
      /* The hit has to land inside the control, which is what is being
         proved; what gets clicked is the control. An icon button is a
         button wrapped round an svg, and an svg has no click of its own. */
      ;(hit.closest('button') || el).click()
      return { found: true, covered: false }
    } catch (e) { return { found: true, threw: String(e && e.message || e) } } })()`)

    const byIcon = await pressIcon()
    check('the pin icon in the header can be pressed', byIcon.found && !byIcon.covered, byIcon)
    await wait(700)
    const fromIcon = await where()
    check('it opens the pinned messages', fromIcon !== null, fromIcon)
    check('and they are on screen', fromIcon && fromIcon.onScreen === true, fromIcon)

    await shut()
    await wait(500)
    check('and it closes again', (await where()) === null)

    const byLine = await press('.sys-link', 'See pins')
    check('See pins on the line can be pressed', byLine.found && !byLine.covered, byLine)
    await wait(700)
    const fromLine = await where()
    check('that opens the pinned messages too', fromLine !== null, fromLine)

    /*
     * The whole point. Same panel, same place - not "somewhere near the top",
     * which a panel anchored to a line near the top would also satisfy.
     */
    check('in exactly the same place as the icon opens them',
      fromLine && fromIcon && fromLine.top === fromIcon.top && fromLine.left === fromIcon.left,
      { fromIcon, fromLine })
  },
}
