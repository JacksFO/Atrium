/**
 * What the app actually calls things, asked of the running app.
 *
 * Not a test - a survey, and the reason it exists is that reading class names
 * out of the source gets them wrong. A className written as a ternary, or
 * built from a variable, is invisible to a grep, so a static scan reported
 * .msg as missing from a client that renders it on every message.
 *
 * This walks the real app through a few states and writes down every class it
 * finds. That is the ground truth a spec should be written against.
 *
 * Named zz- so it runs last, and it checks nothing.
 */
const { signIn, sayAs } = require('../lib.cjs')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const CLASSES = `(() => {
  const out = new Set()
  for (const el of document.querySelectorAll('*')) {
    for (const c of el.classList) out.add(c)
  }
  return [...out].sort()
})()`

module.exports = {
  name: 'zz-classes',
  width: 1500,
  height: 950,

  async run({ js, until, wait, win, check, base }) {
    const found = new Set()
    const note = async (where) => {
      const list = await js(CLASSES)
      if (Array.isArray(list)) for (const c of list) found.add(c)
      return Array.isArray(list) ? list.length : 0
    }

    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(1200)
    await note('home')

    /* A channel, with a message in it. */
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1200)
    await sayAs(js, setup.friends.Baileyyy.token, 'a message to look at')
    await until('a message', `document.querySelectorAll('.msg').length > 0`)
    await wait(800)
    await note('a channel')

    /* The menu on a message. */
    await js(`(() => {
      const m = document.querySelector('.msg')
      if (m) m.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))
      return 1 })()`)
    await wait(700)
    await note('a message menu')
    await js(`(() => { document.body.click(); return 1 })()`)

    /* Settings. */
    await js(`(async () => {
      const me = document.querySelector('.meid')
      if (me) me.click()
      await new Promise((r) => setTimeout(r, 400))
      const s = [...document.querySelectorAll('button')].find((b) => /settings/i.test(b.textContent || ''))
      if (s) s.click()
      return 1 })()`)
    await wait(1200)
    await note('settings')

    const all = [...found].sort()
    const out = join(__dirname, '..', 'classes.json')
    writeFileSync(out, JSON.stringify(all, null, 1))
    check(`wrote ${all.length} class names the app really renders`, all.length > 100, all.length)
  },
}
