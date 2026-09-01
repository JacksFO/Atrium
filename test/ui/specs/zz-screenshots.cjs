/**
 * Photograph the app, so it can be looked at rather than reasoned about.
 *
 * Not a test in the usual sense: it asserts only that each screen rendered
 * something, and its real output is a folder of PNGs. Everything else here
 * measures - this is the one that lets somebody see a heading sitting on top
 * of a button, which no measurement was written to catch because nobody knew
 * to look for it.
 *
 * Named zz- so it runs last: it resizes the window a great deal and leaves
 * the app in whatever state the final shot needed.
 */
const { signIn, sayAs } = require('../lib.cjs')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SHOTS = process.env.UI_SHOTS || join(require('node:os').tmpdir(), 'atrium-shots')

/** The sizes that actually matter here, and why each one is on the list. */
const SIZES = [
  { name: 'phone', w: 390, h: 844 },     // the layout that had to be rebuilt
  { name: 'narrow', w: 820, h: 900 },    // the breakpoint the drawers appear at
  { name: 'laptop', w: 1280, h: 800 },   // what most people are on
  { name: 'wide', w: 1920, h: 1080 },    // where columns stop growing
]

module.exports = {
  name: 'zz-screenshots',
  width: 1280,
  height: 800,

  async run({ js, until, wait, win, check, base }) {
    mkdirSync(SHOTS, { recursive: true })

    const shoot = async (label) => {
      const image = await win.webContents.capturePage()
      const file = join(SHOTS, `${label}.png`)
      writeFileSync(file, image.toPNG())
      return file
    }

    const resize = async (w, h) => {
      win.setContentSize(w, h)
      // Two frames plus the drawer transitions, which are 220ms.
      await wait(700)
    }

    await win.loadURL(base + '/')
    /* Waited for rather than assumed drawn: the shot is taken 700ms after the
       page is asked for, and on a cold start the app has not decided which of
       the two screens it is yet. */
    await until('the sign-in screen', `!!document.querySelector('.gate, form')`)
    await shoot('01-login')
    check('the sign-in screen draws', await js(
      `!!document.querySelector('.gate, input[type="password"], form')`), 'no form')

    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy', 'Nipeno'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)

    // Something to look at: a few messages, one long, one with markdown.
    await sayAs(js, setup.friends.baileyyy.token, 'Morning all')
    await sayAs(js, setup.me.token, 'Look at **this** and `code` and https://example.com')
    await sayAs(js, setup.friends.Nipeno.token,
      'A deliberately long line to see how the bubble wraps when somebody writes a paragraph '
      + 'rather than a sentence, which is most of the time in practice.')
    await wait(1200)

    for (const size of SIZES) {
      await resize(size.w, size.h)
      await shoot(`02-chat-${size.name}`)
    }

    await resize(1280, 800)

    // The panel this week's work added, at the size somebody would use it.
    const opened = await js(`(() => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /general/.test(r.textContent || ''))
      if (!row) return false
      const r = row.getBoundingClientRect()
      const el = document.elementFromPoint(r.left + 30, r.top + r.height / 2)
      if (!el) return false
      el.dispatchEvent(new MouseEvent('contextmenu',
        { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + r.height / 2 }))
      return true })()`)
    check('a channel can be right-clicked', opened === true)
    await until('the menu', `!!document.querySelector('.ctx')`)
    await shoot('03-channel-menu')

    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')]
        .find((x) => /^Permissions$/.test(x.textContent.trim()))
      if (b) b.click()
      return 1 })()`)
    const panel = await until('the permissions panel',
      `document.querySelector('.modal.wide')?.dataset.loaded === '1'`)
    check('the permissions panel opens', panel === true)
    await shoot('04-permissions')

    await resize(390, 844)
    await shoot('05-permissions-phone')
    await resize(1280, 800)

    await js(`(() => {
      const b = [...document.querySelectorAll('.modal.wide .btn')].find((x) => /Done/.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await wait(500)

    // Settings, which is the densest screen in the app.
    await js(`(() => {
      const cog = document.querySelector('.self-gear, [title*="ettings"], .rail-settings')
      if (cog) cog.click()
      return 1 })()`)
    await wait(900)
    const inSettings = await js(`!!document.querySelector('.settings')`)
    check('settings opens', inSettings === true)
    if (inSettings) {
      await shoot('06-settings')
      for (const pane of ['appearance', 'roles', 'members', 'channels']) {
        const went = await js(`(() => {
          const b = [...document.querySelectorAll('.settings nav button, .snav button')]
            .find((x) => new RegExp(${JSON.stringify(pane)}, 'i').test(x.textContent || ''))
          if (!b) return false
          b.click(); return true })()`)
        if (!went) continue
        await wait(700)
        await shoot(`07-settings-${pane}`)
      }
    }

    /*
     * And the light theme, which half the measurements never see.
     *
     * Set through the app's own control rather than by writing the attribute,
     * so what is photographed is what somebody would actually get.
     */
    await js(`(() => {
      document.documentElement.setAttribute('data-theme', 'light')
      return 1 })()`)
    await wait(600)
    await shoot('08-settings-light')

    await js(`(() => {
      const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      document.dispatchEvent(esc)
      return 1 })()`)
    await wait(700)
    await shoot('09-chat-light')

    await js(`document.documentElement.removeAttribute('data-theme')`)
    await wait(400)

    console.log(`      shots written to ${SHOTS}`)
  },
}
