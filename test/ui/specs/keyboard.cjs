/**
 * Getting about without the mouse.
 *
 * The app handled Escape, Enter, Tab, the arrows and the composer's own
 * formatting keys, and nothing else - so every move between channels and
 * servers cost a hunt through two lists. These are the ones people already
 * have in their fingers from elsewhere.
 *
 * A browser test because a keyboard shortcut is a claim about what the window
 * does when a key is pressed, and the window is the only thing that can
 * answer. What it cannot show is a key the browser swallows before the page
 * sees it at all, and there is nothing on this list that it does.
 */
const { signIn } = require('../lib.cjs')

/**
 * A key, the way the app hears one.
 *
 * Dispatched at the body rather than at the window, because that is the path
 * a real key takes: from whatever has focus, up through the document, and
 * only then to the window. Sent at the window it arrives at window listeners
 * and nowhere else - so anything listening on the document, which is where
 * every dialog here listens for Escape, never hears it.
 */
const press = (key, mods = {}) => `(() => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', {
    key: ${JSON.stringify(key)},
    ctrlKey: ${!!mods.ctrl}, altKey: ${!!mods.alt}, shiftKey: ${!!mods.shift},
    bubbles: true, cancelable: true,
  }))
  return true
})()`

/**
 * Which channel is open, by the name in the conversation's own header.
 *
 * The conversation pane, not the first `.chd` on the page - the server rail
 * has one too, and it holds the server's name. Reading that instead reports
 * the same answer whatever channel is open, which is a check that cannot
 * fail wearing the clothes of one that passes.
 */
const OPEN = `(() => {
  const tt = document.querySelector('.chatpane .chd .tt')
  if (!tt) return null
  /* The # or @ in front is a sigil rather than part of the name. */
  const sigil = tt.querySelector('.k')
  const all = (tt.textContent || '').trim()
  return sigil ? all.slice((sigil.textContent || '').length).trim() : all
})()`

module.exports = {
  name: 'keyboard',
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

    const started = await js(OPEN)
    check('a channel is open to begin with', !!started, started)

    // --- the quick switcher ------------------------------------------------
    await js(press('k', { ctrl: true }))
    await wait(600)
    const opened = await js(`(() => {
      const box = document.querySelector('.switcher-q')
      return {
        there: !!box,
        /* It has to take the keyboard, or somebody types into whatever was
           focused before and the dialog sits there doing nothing. */
        focused: !!box && document.activeElement === box,
      }
    })()`)
    console.log('      ctrl+k:  ' + JSON.stringify(opened))
    check('ctrl+k opens the switcher', opened.there === true, opened)
    check('and it takes the keyboard', opened.focused === true, opened)

    /* It opens on where you have been, which after one channel is that one. */
    const before = await js(`(() => ({
      rows: document.querySelectorAll('.switcher-row').length,
      first: (document.querySelector('.switcher-name') || {}).textContent || null,
    }))()`)
    console.log('      recent:  ' + JSON.stringify(before))
    check('and opens on where you have been', before.rows > 0, before)

    /* Typing narrows it. The second channel is the one to find. */
    const names = await js(`(() => [...document.querySelectorAll('.chan .nm')].map((n) => n.textContent.trim()))()`)
    check('there are two channels to move between', names.length >= 2, names)
    const other = names.find((n) => n !== started) ?? names[1]

    await js(`(() => {
      const box = document.querySelector('.switcher-q')
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(box, ${JSON.stringify(String(other).slice(0, 3))})
      box.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await wait(500)
    const typed = await js(`(() => ({
      first: (document.querySelector('.switcher-name') || {}).textContent || null,
    }))()`)
    console.log('      typed:   ' + JSON.stringify({ looking: other, got: typed.first }))
    check('typing puts the right one first', typed.first === other, { other, typed })

    /* And Enter goes there. */
    await js(`(() => {
      const box = document.querySelector('.switcher-q')
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      return true
    })()`)
    await wait(1200)
    const wentTo = await js(OPEN)
    console.log('      went to: ' + JSON.stringify(wentTo))
    check('and enter goes there', wentTo === other, { wentTo, other })
    check('and the switcher closes behind it',
      (await js(`!document.querySelector('.switcher-q')`)) === true)

    // --- moving a channel at a time ---------------------------------------
    await js(press('ArrowUp', { alt: true }))
    await wait(900)
    const moved = await js(OPEN)
    console.log('      alt+up:  ' + JSON.stringify(moved))
    check('alt+up moves to another channel', moved !== wentTo, { moved, wentTo })

    await js(press('ArrowDown', { alt: true }))
    await wait(900)
    check('and alt+down comes back', (await js(OPEN)) === wentTo, await js(OPEN))

    // --- and the two the sheet claims that nothing else here proves --------
    /*
     * The sheet is only worth having if everything on it works, and these two
     * were listed and untested - which is the same fault as listing a
     * shortcut that was never bound, arrived at from the other direction.
     */
    await js(press('f', { ctrl: true }))
    await wait(700)
    const searching = await js(`!!document.querySelector('.searchp input')`)
    check('ctrl+f opens search', searching === true, searching)
    await js(press('f', { ctrl: true }))
    await wait(500)

    /* And a server by number. With one server this can only prove that the
       key is taken and lands somewhere sensible rather than doing nothing. */
    const servers = await js(`document.querySelectorAll('.rail button, .srv').length`)
    await js(press('1', { ctrl: true }))
    await wait(800)
    const afterOne = await js(OPEN)
    check('ctrl+1 keeps a conversation open rather than emptying the app',
      typeof afterOne === 'string' && afterOne.length > 0, { servers, afterOne })

    // --- the sheet ---------------------------------------------------------
    await js(press('/', { ctrl: true }))
    await wait(600)
    const sheet = await js(`(() => {
      const keys = document.querySelector('.keys')
      if (!keys) return { there: false }
      const text = (keys.textContent || '').replace(/\\s+/g, ' ')
      return {
        there: true,
        /* Every shortcut this test has just proved should be in the list, or
           the list is not what it claims to be. */
        saysSwitcher: /Go to a channel/i.test(text),
        saysChannels: /channel (above|below)/i.test(text),
        saysItself: /This list/i.test(text),
      }
    })()`)
    console.log('      sheet:   ' + JSON.stringify(sheet))
    check('ctrl+/ opens the shortcut list', sheet.there === true, sheet)
    check('and it lists the ones that work',
      sheet.saysSwitcher && sheet.saysChannels && sheet.saysItself, sheet)

    await js(press('Escape'))
    await wait(500)
    check('and escape closes it',
      (await js(`!document.querySelector('.keys')`)) === true)

    // --- and not while somebody is writing ---------------------------------
    /*
     * The one that would be felt every day if it were wrong. Alt and the
     * arrows in a message box is a person moving the caret, not a person
     * moving channels.
     */
    const stayed = await js(`(() => {
      const box = document.querySelector('.cmp textarea, .composer textarea')
      if (!box) return { typed: false }
      box.focus()
      box.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true,
      }))
      return { typed: true }
    })()`)
    await wait(700)
    check('the message box could be focused', stayed.typed === true, stayed)
    check('and alt+up in it does not change channel',
      (await js(OPEN)) === wentTo, { now: await js(OPEN), wentTo })
  },
}
