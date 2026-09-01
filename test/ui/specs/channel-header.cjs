/**
 * The bar across the top, and the icons in the channel header.
 *
 * Pinning had a complete server API - list, pin, unpin, permission-checked -
 * and nothing had ever called any of it, so it was a feature that existed
 * only in the database. Muting was the opposite: a flag in localStorage, so
 * silencing a channel on a phone left the desktop shouting.
 *
 * Both are the sort of thing that looks finished from the outside, which is
 * why this drives them end to end rather than checking the buttons exist.
 */
const { signIn, sayAs } = require('../lib.cjs')

module.exports = {
  name: 'channel-header',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1800)

    // ---- the bar across the top ----
    const bar = await js(`(() => {
      const el = document.querySelector('.topbar')
      if (!el) return { exists: false }
      const r = el.getBoundingClientRect()
      /*
       * The room the app has, not the window.
       *
       * The client this replaced ran edge to edge; this one sets the whole
       * app on a small margin, so a bar that reached the window's edges
       * would be reaching past the app it belongs to. What the check is
       * about is that the bar spans everything - every column, corner to
       * corner - which is the shell's content box.
       */
      const shell = document.querySelector('.shell')
      const cs = getComputedStyle(shell)
      const box = shell.getBoundingClientRect()
      const app = {
        width: box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        top: box.top + parseFloat(cs.paddingTop),
      }
      const chat = document.querySelector('.chatpane').getBoundingClientRect()
      return { exists: true,
        top: Math.round(r.top - app.top), h: Math.round(r.height),
        w: Math.round(r.width), appW: Math.round(app.width),
        text: el.textContent.replace(/\\s+/g, ' ').trim(),
        icon: !!el.querySelector('.tbi'),
        // Everything else has to start below it, not behind it.
        chatStartsBelow: chat.top >= r.bottom - 1 } })()`)
    check('there is a bar across the top', bar.exists === true)
    check('it spans the whole window', Math.abs(bar.w - bar.appW) <= 1, { bar: bar.w, app: bar.appW })
    check('it starts at the very top of the app', bar.top === 0, bar.top)
    /* The name the setup actually used, not a literal. It used to be
       a fixed name because an install came with a server of its own; nobody
       is given a server now, so the harness makes one and says what it
       called it. */
    check('it names the server',
      (bar.text || '').includes(setup.spaceName), { bar: bar.text, want: setup.spaceName })
    check('with its icon', bar.icon === true)
    check('and the app starts below it', bar.chatStartsBelow === true)

    // ---- pinned messages ----
    await sayAs(js, setup.friends.Baileyyy.token, 'worth keeping')
    await wait(2200)
    check('there is a message to pin',
      await until('a message', `document.querySelectorAll('.msg').length > 0`))

    const pinBtn = await js(`(() => {
      const b = document.querySelector('[aria-label="Pinned messages"]')
      if (!b) return { exists: false }
      const r = b.getBoundingClientRect()
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { exists: true, hittable: !!(at && (at === b || b.contains(at))) } })()`)
    check('there is a pinned-messages button', pinBtn.exists === true)
    check('and a finger lands on it', pinBtn.hittable === true)

    await js(`(() => { document.querySelector('[aria-label="Pinned messages"]').click(); return 1 })()`)
    await wait(1200)
    const empty = await js(`(() => {
      const p = document.querySelector('.pinbox')
      return p ? { open: true, text: p.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80) }
               : { open: false } })()`)
    check('the panel opens', empty.open === true)
    check('and says nothing is pinned yet', /Nothing is pinned/i.test(empty.text || ''), empty.text)

    await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 1 })()`)
    await wait(500)

    // Pin it from the message's own menu, which is where somebody would.
    await js(`(() => {
      const row = [...document.querySelectorAll('.msg')].find((m) => m.textContent.includes('worth keeping'))
      const r = row.getBoundingClientRect()
      const x = r.left + 120, y = r.top + r.height / 2
      document.elementFromPoint(x, y).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      return 1 })()`)
    // Waited for rather than slept through: a fixed sleep passed alone
    // and failed inside the full suite, which is a test guessing rather
    // than an app misbehaving.
    await until('the message menu', `!!document.querySelector('.ctx')`)
    const menuItems = await js(`(() => [...document.querySelectorAll('.ctx .mitem')].map((b) => b.textContent.trim()))()`)
    check('the message menu offers Pin',
      (menuItems || []).some((t) => /^Pin$/i.test(t)), menuItems)

    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')].find((x) => /^Pin$/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await wait(2000)

    await js(`(() => { document.querySelector('[aria-label="Pinned messages"]').click(); return 1 })()`)
    await wait(1500)
    const pinned = await js(`(() => {
      const p = document.querySelector('.pinbox')
      if (!p) return { open: false }
      return { open: true,
        rows: p.querySelectorAll('.pinc').length,
        text: p.textContent.replace(/\\s+/g, ' ').trim(),
        /* Icons, so what they are is in the title rather than in text -
           which is also the only thing a mouse ever tells you about them. */
        acts: [...p.querySelectorAll('.pinc button')]
          .map((b) => (b.title || b.getAttribute('aria-label') || '').trim()) } })()`)
    check('the pinned message is listed', pinned.rows === 1, pinned.rows)
    check('with what it said', /worth keeping/.test(pinned.text || ''), (pinned.text || '').slice(0, 60))
    /*
     * Where it opens.
     *
     * It was position:absolute with nothing saying where, drawn through a
     * portal onto the body - so it appeared in the corner of the page rather
     * than under the button it came from. On screen and beside that button
     * is the whole of the fix.
     */
    const placed = await js(`(() => {
      const p = document.querySelector('.pinbox').getBoundingClientRect()
      const b = document.querySelector('[aria-label="Pinned messages"]').getBoundingClientRect()
      return {
        onScreen: p.top >= 0 && p.left >= 0
          && p.right <= window.innerWidth + 1 && p.bottom <= window.innerHeight + 1,
        left: Math.round(p.left), top: Math.round(p.top),
        /* Near the button rather than in the far corner. */
        nearTheButton: Math.abs(p.top - b.top) < 400 && p.left > window.innerWidth / 3,
      } })()`)
    console.log('      where it opened: ' + JSON.stringify(placed))
    check('the panel opens on screen', placed.onScreen === true, placed)
    check('and beside the button it came from', placed.nearTheButton === true, placed)

    check('and a way to reach it or take it down',
      (pinned.acts || []).some((a) => /jump/i.test(a))
        && (pinned.acts || []).some((a) => /unpin/i.test(a)), pinned.acts)

    /*
     * Unpinning takes the row away now.
     *
     * The panel is fetched once when it opens and follows nothing after
     * that, which is right for a pin somebody else removes - but it left the
     * one you had just taken down sitting there until the panel was closed
     * and opened again.
     */
    const unpinned = await js(`(async () => {
      const row = document.querySelector('.pinbox .pinc')
      if (!row) return { ok: false, why: 'no row' }
      const x = [...row.querySelectorAll('button')]
        .find((b) => /unpin/i.test(b.title || b.getAttribute('aria-label') || ''))
      if (!x) return { ok: false, why: 'no unpin button' }
      x.click()
      await new Promise((r) => setTimeout(r, 700))
      return { ok: true, rows: document.querySelectorAll('.pinbox .pinc').length } })()`)
    console.log('      after unpinning: ' + JSON.stringify(unpinned))
    check('unpinning takes the row away without reopening it',
      unpinned.ok === true && unpinned.rows === 0, unpinned)

    await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 1 })()`)
    await wait(500)

    // ---- the bell ----
    const bellBtn = await js(`(() => {
      const b = document.querySelector('[aria-label="Notification settings"]')
      if (!b) return { exists: false }
      const r = b.getBoundingClientRect()
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { exists: true, hittable: !!(at && (at === b || b.contains(at))) } })()`)
    check('there is a notification button', bellBtn.exists === true)
    check('and a finger lands on it', bellBtn.hittable === true)

    await js(`(() => { document.querySelector('[aria-label="Notification settings"]').click(); return 1 })()`)
    await wait(1000)
    const bell = await js(`(() => {
      const m = document.querySelector('.ctx')
      return m ? { open: true, items: [...m.querySelectorAll('.mitem')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()) }
               : { open: false } })()`)
    check('the bell menu opens', bell.open === true)
    check('offering a mute', (bell.items || []).some((t) => /Mute channel/.test(t)), bell.items)
    check('and the four levels',
      ['Use my default', 'All messages', 'Only @mentions', 'Nothing']
        .every((want) => (bell.items || []).some((t) => t.includes(want))), bell.items)

    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')].find((x) => /Mute channel/.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await wait(700)
    const durations = await js(`(() => [...document.querySelectorAll('.ctx .mitem')].map((b) => b.textContent.trim()))()`)
    check('the mute submenu lists the durations',
      ['For 15 minutes', 'For 1 hour', 'For 3 hours', 'For 8 hours', 'For 24 hours', 'Until I turn it back on']
        .every((want) => (durations || []).includes(want)), durations)

    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')].find((x) => x.textContent.trim() === 'For 1 hour')
      if (b) b.click()
      return 1 })()`)
    await wait(2000)

    /*
     * The point of all of it: the mute is on the account, not this browser.
     * Reloading throws away every scrap of local state, so if it survives a
     * reload it came back from the server in ready.
     */
    await win.loadURL(base + '/')
    await until('the app again', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1800)

    const afterReload = await js(`(() => {
      const b = document.querySelector('[aria-label="Notification settings"]')
      return { off: b ? b.classList.contains('is-off') : null } })()`)
    check('the mute survives a reload, so it is on the account',
      afterReload.off === true, afterReload)

    await js(`(() => { document.querySelector('[aria-label="Notification settings"]').click(); return 1 })()`)
    await wait(1000)
    const muted = await js(`(() => {
      const m = document.querySelector('.ctx')
      return m ? { text: m.textContent.replace(/\\s+/g, ' ').trim() } : { text: '' } })()`)
    check('and it offers to unmute, saying how long is left',
      /Unmute channel/.test(muted.text) && /another/.test(muted.text), muted.text.slice(0, 90))
  },
}
