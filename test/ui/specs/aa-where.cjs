/**
 * Everything where.cjs claims to know the name of, checked against the app.
 *
 * The map is the foundation the other specs stand on: if an entry stops
 * matching, every spec using it fails in a way that looks like the feature
 * broke. This is the one place that says which it was.
 *
 * Named aa- so it runs first. A run where this fails and everything else
 * fails too is one bug, not thirty.
 */
const { signIn, sayAs } = require('../lib.cjs')
const W = require('../where.cjs')

/** How many things a selector matches, right now. */
const count = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`

module.exports = {
  name: 'aa-where',
  width: 1500,
  height: 950,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(1200)

    /* ---- what is there before anything is opened ---- */
    const onHome = ['APP', 'RAIL', 'RAIL_BUTTON', 'RAIL_HOME', 'RAIL_NEW',
      'SIDEBAR', 'CHANNEL', 'ME', 'TOPBAR']
    for (const key of onHome) {
      const n = await js(count(W[key]))
      check(`${key} matches something (${W[key]})`, typeof n === 'number' && n > 0, n)
    }

    /* ---- a channel, with a message in it ---- */
    await js(`(() => { const c = document.querySelector(${JSON.stringify(W.CHANNEL)}); if (c) c.click(); return 1 })()`)
    await wait(1000)
    await sayAs(js, setup.friends.Baileyyy.token, 'something to look at')
    await until('a message', `document.querySelectorAll(${JSON.stringify(W.MESSAGE)}).length > 0`)
    await wait(600)

    const inChannel = ['CHAT', 'STREAM', 'MESSAGE', 'MESSAGE_BODY', 'MESSAGE_NAME',
      'CHANNEL_HEAD', 'COMPOSER', 'COMPOSER_BOX', 'CHANNEL_ON', 'MEMBERS', 'MEMBER']
    for (const key of inChannel) {
      const n = await js(count(W[key]))
      check(`${key} matches something (${W[key]})`, typeof n === 'number' && n > 0, n)
    }

    /* The channel list has a heading over its groups in a server. */
    const groups = await js(count(W.CHANNEL_GROUP))
    check(`CHANNEL_GROUP matches something (${W.CHANNEL_GROUP})`, groups > 0, groups)

    /* ---- the menu on a message ---- */
    await js(`(() => {
      const m = document.querySelector(${JSON.stringify(W.MESSAGE)})
      if (m) m.dispatchEvent(new MouseEvent('contextmenu',
        { bubbles: true, clientX: 400, clientY: 400 }))
      return 1 })()`)
    await wait(600)
    for (const key of ['MENU', 'MENU_ITEM', 'MENU_SCRIM']) {
      const n = await js(count(W[key]))
      check(`${key} matches something (${W[key]})`, typeof n === 'number' && n > 0, n)
    }
    await js(`(() => { const s = document.querySelector(${JSON.stringify(W.MENU_SCRIM)}); if (s) s.click(); return 1 })()`)
    await wait(400)

    /* ---- settings ---- */
    await js(`(async () => {
      const me = document.querySelector(${JSON.stringify(W.ME)})
      if (me) me.click()
      await new Promise((r) => setTimeout(r, 400))
      const s = [...document.querySelectorAll('button')]
        .find((b) => /settings/i.test(b.textContent || ''))
      if (s) s.click()
      return 1 })()`)
    await wait(1200)
    for (const key of ['SETTINGS', 'SETTINGS_NAV', 'SETTINGS_ITEM', 'SETTINGS_TITLE',
      'SETTINGS_CLOSE']) {
      const n = await js(count(W[key]))
      check(`${key} matches something (${W[key]})`, typeof n === 'number' && n > 0, n)
    }

    /*
     * And every name in the map was checked by something above.
     *
     * Without this, an entry could be added to where.cjs and never looked at
     * again - which is the same silence the whole map exists to end.
     */
    const checked = new Set([...onHome, ...inChannel, 'CHANNEL_GROUP', 'MENU',
      'MENU_ITEM', 'MENU_SCRIM', 'SETTINGS', 'SETTINGS_NAV', 'SETTINGS_ITEM',
      'SETTINGS_TITLE', 'SETTINGS_CLOSE'])
    /* These need a state this spec does not reach; they are covered by the
       specs about those things instead. */
    const elsewhere = new Set(['RAIL_PIP', 'RAIL_READ_ALL', 'RAIL_DIVIDER',
      'MESSAGE_TOOLS', 'COMPOSER_SEND', 'MEMBERS_TOGGLE', 'MENU_QUICK', 'PROFILE',
      'MODAL',
      /* The settings window is its own screen and settings-search walks it:
         the search box, its results, the pane that scrolls, the third column
         and the backdrop are all reached there rather than from the app. */
      'SETTINGS_SCRIM', 'SETTINGS_PANE', 'SETTINGS_FIND', 'SETTINGS_HIT',
      'SETTINGS_ASIDE',
      /* And these two name the older server-settings window, which is being
         folded into the one above - live-updates is what still opens it. */
      'SERVER_SETTINGS_CLOSE', 'SERVER_SETTINGS_PANE'])
    const forgotten = Object.keys(W).filter((k) => !checked.has(k) && !elsewhere.has(k))
    check('every name in the map is either checked here or named as covered elsewhere',
      forgotten.length === 0, forgotten)
  },
}
