/**
 * Arranging the columns, measured rather than asserted.
 *
 * The unit tests know the order module is right and that the overlay calls
 * the right things. What neither of them can see is whether the panels
 * actually move: every one of those would pass on an app where the custom
 * properties are written and the grid ignores them, which is exactly the
 * shape this feature would fail in.
 *
 * So this asks the browser where each panel is on screen, moves one, and asks
 * again. And then reloads, because "it respects your layout over updates" is
 * the requirement, and a layout that is right until the page reloads is not
 * one that survives an update.
 */
const { signIn } = require('../lib.cjs')

/** Where each column actually is, left to right. */
const WHERE = `(() => {
  const at = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: Math.round(r.left), width: Math.round(r.width),
      top: Math.round(r.top), height: Math.round(r.height) }
  }
  const panes = {
    servers: at('.pane.rail'),
    channels: at('.pane.sidepane'),
    conversation: at('.pane.chatpane'),
    members: at('.pane.mempane'),
  }
  const seen = Object.entries(panes).filter(([, v]) => v)
  seen.sort((a, b) => a[1].left - b[1].left)
  return { order: seen.map(([k]) => k), panes,
    stored: JSON.parse(localStorage.getItem('atrium.settings') || '{}').panelOrder || null }
})()`

module.exports = {
  name: 'arrange-panels',
  /* Wide enough that all four are columns - below 1250 the member list is not
     one, and arranging is deliberately not offered. */
  width: 1500,
  height: 950,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    /*
     * Start from no arrangement at all.
     *
     * The whole point of this feature is that an arrangement outlives the
     * page, so the browser profile carries the last run's - including the
     * deliberately odd one planted at the end of it. Without this the first
     * check reads whatever the previous run left and fails describing a
     * layout nobody chose in this run.
     */
    await js(`(() => {
      const key = 'atrium.settings'
      const s = JSON.parse(localStorage.getItem(key) || '{}')
      delete s.panelOrder
      localStorage.setItem(key, JSON.stringify(s))
      return true
    })()`)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1800)

    // ---- as it comes ----
    /*
     * Four columns means four columns: side by side, same top, same height.
     *
     * This checked only which order they ran in from the left, and passed
     * while the layout was in pieces - the member list on its own row at the
     * bottom, the servers up beside the notices. Left alone says nothing
     * about whether they are a row of columns at all.
     */
    const abreast = (w) => {
      const seen = Object.values(w.panes).filter(Boolean)
      const top = seen[0].top
      const height = seen[0].height
      return seen.every((p) => Math.abs(p.top - top) <= 2 && Math.abs(p.height - height) <= 2)
    }

    const before = await js(WHERE)
    check('all four columns are on screen', before.order.length === 4, before.order)
    check('and they are side by side, not scattered', abreast(before), before.panes)
    check('and they start in the usual order',
      before.order.join(' ') === 'servers channels conversation members', before.order)

    // ---- arranging is reachable from Appearance ----
    const opened = await js(`(async () => {
      const me = document.querySelector('.meid')
      if (!me) return { why: 'no me bar' }
      me.click()
      await new Promise((r) => setTimeout(r, 500))
      const items = [...document.querySelectorAll('button, [role="menuitem"]')]
      const s = items.find((b) => /settings/i.test(b.textContent || ''))
      if (!s) return { why: 'no settings in the menu' }
      s.click()
      await new Promise((r) => setTimeout(r, 700))
      const nav = [...document.querySelectorAll('.snav button, .snav a')]
      const app = nav.find((b) => /appearance/i.test(b.textContent || ''))
      if (!app) return { why: 'no appearance pane' }
      app.click()
      await new Promise((r) => setTimeout(r, 500))
      const arrange = [...document.querySelectorAll('button')]
        .find((b) => (b.textContent || '').trim() === 'Arrange')
      if (!arrange) return { why: 'no Arrange button in Appearance' }
      arrange.click()
      await new Promise((r) => setTimeout(r, 700))
      return { ok: true, overlay: !!document.querySelector('.arrange') }
    })()`)
    check('Appearance offers arranging', opened.ok === true, opened.why)
    check('and it opens over the app', opened.overlay === true)

    /*
     * The app is still there to look at, and not to use.
     *
     * Visible is the whole point - you are arranging the thing itself, so you
     * can see what is in each column while you move it. Clickable is not: the
     * outlines have to take the pointer or there is nothing to drag, and a
     * click that half-lands in the app while arranging is worse than one that
     * does not land at all.
     */
    const through = await js(`(() => {
      const chan = document.querySelector('.chan')
      if (!chan) return { seen: false }
      const r = chan.getBoundingClientRect()
      const on = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      const box = chan.getBoundingClientRect()
      return { seen: true,
        overlayOnTop: !!(on && on.closest('.arrange')),
        /* Still drawn, and still where it was. */
        visible: box.width > 0 && box.height > 0 }
    })()`)
    check('the app is still there underneath', through.seen === true)
    check('and still drawn where it was', through.visible === true)
    check('with the outlines taking the pointer, so a panel can be dragged',
      through.overlayOnTop === true)

    // ---- move the member list to the far left ----
    const moved = await js(`(async () => {
      for (let i = 0; i < 3; i++) {
        const b = document.querySelector('[aria-label="Move Members left"]')
        if (!b || b.disabled) break
        b.click()
        await new Promise((r) => setTimeout(r, 260))
      }
      const done = [...document.querySelectorAll('.arrbar button')]
        .find((b) => (b.textContent || '').trim() === 'Done')
      if (done) done.click()
      await new Promise((r) => setTimeout(r, 500))
      return { closed: !document.querySelector('.arrange') }
    })()`)
    check('Done closes the overlay', moved.closed === true)

    const after = await js(WHERE)
    check('the member list really moved to the left',
      after.order[0] === 'members', after.order)
    check('and everything else slid along, in order',
      after.order.join(' ') === 'members servers channels conversation', after.order)

    /* The width has to travel with the panel. Moving the members to the left
       and leaving its width behind would put the rail in a 254px column. */
    check('and each column kept its own width',
      Math.abs(after.panes.members.width - before.panes.members.width) <= 2
      && Math.abs(after.panes.servers.width - before.panes.servers.width) <= 2,
      { members: [before.panes.members.width, after.panes.members.width],
        servers: [before.panes.servers.width, after.panes.servers.width] })

    check('and they are still side by side afterwards', abreast(after), after.panes)
    check('and it was written down', Array.isArray(after.stored), after.stored)

    // ---- and it is still there after a reload ----
    await win.loadURL(base + '/')
    await until('the channel list again', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    const reloaded = await js(WHERE)
    check('the arrangement survives a reload',
      reloaded.order.join(' ') === 'members servers channels conversation', reloaded.order)
    check('and the layout is still a row of columns', abreast(reloaded), reloaded.panes)

    /*
     * And an arrangement written by a version that knew different columns.
     *
     * This is the update case, and the one that cannot be checked any other
     * way: a stored order naming a panel this build has never heard of, and
     * missing one it has.
     */
    const older = await js(`(() => {
      const key = 'atrium.settings'
      const s = JSON.parse(localStorage.getItem(key) || '{}')
      s.panelOrder = ['threads', 'members', 'conversation']
      localStorage.setItem(key, JSON.stringify(s))
      return true
    })()`)
    check('a stranger arrangement can be planted', older === true)

    await win.loadURL(base + '/')
    await until('the channel list once more', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    const recovered = await js(WHERE)
    check('a column it has never heard of is ignored',
      !recovered.order.includes('threads'), recovered.order)
    check('and the ones it does know are all still drawn',
      recovered.order.length === 4, recovered.order)
    check('keeping the part of the arrangement that still means something',
      recovered.order.join(' ') === 'members conversation servers channels',
      recovered.order)
  },
}
