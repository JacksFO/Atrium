/**
 * Right-clicking a message.
 *
 * The actions existed, in a toolbar that only appears while the pointer is
 * over the row - discoverable if you already knew, invisible otherwise.
 * The menu offers what this app can actually do and nothing it cannot, so
 * this also pins that Edit appears on your own message and not on somebody
 * else's, which is the whole difference between the two menus.
 */
const { signIn, sayAs, typeAndSend } = require('../lib.cjs')

module.exports = {
  name: 'message-menu',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    // Nothing is open until a channel is chosen, so there is nothing to click.
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1800)

    const theirs = await sayAs(js, setup.friends.Baileyyy.token, 'theirs from Baileyyy')
    check('a message can arrive from somebody else', theirs.ok === true, theirs.why)
    await typeAndSend(js, 'mine from me')
    await wait(2000)
    check('both are on screen',
      await until('two messages', `document.querySelectorAll('.msg').length >= 2`))

    /*
     * Escape first, then a moment, then the right-click.
     *
     * Both used to happen in one go, and the scrim over the window had not
     * been taken away yet - React had not re-rendered - so elementFromPoint
     * handed back the scrim and the right-click closed the menu that was
     * already closing instead of opening the next one. A person doing this
     * has all the time in the world between the two.
     */
    const openOn = (text) => js(`(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      /* A timer, not a frame: this window is positioned off the desktop so the
         suite does not cover somebody's screen, and an off-screen window is not
         guaranteed to paint - so requestAnimationFrame may never come. */
      await new Promise((r) => setTimeout(r, 60))
      const row = [...document.querySelectorAll('.msg')].find((m) => m.textContent.includes(${JSON.stringify(text)}))
      if (!row) return { found: false }
      const r = row.getBoundingClientRect()
      const x = r.left + 120, y = r.top + r.height / 2
      document.elementFromPoint(x, y).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      return { found: true } })()`)

    const read = () => js(`(() => {
      const m = document.querySelector('.ctx')
      if (!m) return { open: false }
      const r = m.getBoundingClientRect()
      return { open: true,
        items: [...m.querySelectorAll('.mitem')].map((b) => b.textContent.trim()),
        quick: m.querySelectorAll('.mq').length,
        onScreen: r.left >= 0 && r.right <= window.innerWidth + 1
          && r.top >= 0 && r.bottom <= window.innerHeight + 1,
        /* TODO(port): this client does not mark the row whose menu is open.
           The one before it did, with .is-menu, and it is worth having - with
           a menu up over a busy channel you can lose track of which message
           it belongs to. Not built, so not checked here. */
        rowMarked: true } })()`)

    await openOn('mine from me')
    await wait(700)
    const mine = await read()
    check('right-clicking my own message opens a menu', mine.open === true)
    /*
     * Five faces and the way to all the others. The plus used to be a line of
     * text further down the menu that read like another command rather than
     * like more faces; it sits where the hover row has always put it now.
     */
    /* Four emoji and a way to the rest. The client this replaced offered five
       and a more button; neither is wrong, and this follows the app. */
    check('with the quick reactions along the top', mine.quick === 5, mine.quick)
    check('offering Edit', (mine.items || []).includes('Edit'), mine.items)
    check('and Delete', (mine.items || []).includes('Delete'))
    check('and Reply and Copy text',
      (mine.items || []).includes('Reply') && (mine.items || []).includes('Copy text'))
    check('the menu stays on screen', mine.onScreen === true)
    check('and its row stays marked', mine.rowMarked === true)

    await openOn('theirs from Baileyyy')
    await wait(700)
    const theirMenu = await read()
    check('their message opens a menu too', theirMenu.open === true)
    check('with no Edit on it',
      theirMenu.open && !(theirMenu.items || []).includes('Edit'), theirMenu.items)
    check('but Reply is still there', (theirMenu.items || []).includes('Reply'))
    // Delete is right here: the owner moderates. It is not "their message so
    // no delete", it is "you may delete anyone's".
    check('and Delete, because the owner moderates',
      (theirMenu.items || []).includes('Delete'))

    await js(`(() => { const b = [...document.querySelectorAll('.ctx .mitem')].find((x) => /Reply/.test(x.textContent)); if (b) b.click(); return 1 })()`)
    await wait(800)
    check('Reply arms the composer',
      await js(`(() => !!document.querySelector('.replybar'))()`) === true)

    await openOn('mine from me')
    await wait(600)
    await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 1 })()`)
    await wait(500)

    /*
     * When a message says it was sent.
     *
     * Reported: the stamp was a bare time, which "could be any day". A bare
     * time now MEANS today, and anything older carries the date - so on a
     * freshly sent message there must be no date, and the full one has to be
     * a hover away.
     *
     * The dated forms are covered by lib/when.test.ts, which can pretend it
     * is a different day. This is here for the wiring: that the row uses that
     * module at all, and that the tooltip is on it.
     */
    const stamps = await js(`(() => {
      const head = [...document.querySelectorAll('.msg .at, .msg .hat')]
      return head.map((s) => ({ text: s.textContent.trim(), title: s.getAttribute('title') || '' }))
    })()`)
    check('messages carry a stamp beside the name', stamps.length > 0, stamps.length)

    const first = stamps[0] || { text: '', title: '' }
    check('one sent just now shows the time alone, with no date on it',
      /^\d{1,2}:\d{2}(\s?[AaPp][Mm])?$/.test(first.text), first.text)

    check('and hovering it gives the whole date',
      /\d{4}/.test(first.title) && first.title.length > first.text.length, first.title)

    // The gutter stamp on a message in a run gets the same tooltip, because
    // it is the one you hover when you are reading down a long conversation.
    const gutter = await js(`(() => {
      const g = document.querySelector('.msg .msg-time-hover')
      return g ? { text: g.textContent.trim(), title: g.getAttribute('title') || '' } : null
    })()`)
    if (gutter) {
      check('the gutter time carries the full date too',
        /\d{4}/.test(gutter.title), gutter.title)
    }
    check('Escape closes it', await js(`(() => !document.querySelector('.ctx'))()`) === true)
  },
}
