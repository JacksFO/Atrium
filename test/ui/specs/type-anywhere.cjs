/**
 * Start typing with the box unfocused and the letters go into it.
 *
 * Asked for: "on discord when you tab into the app but aren't already in the
 * text box if you just start typing it will start typing in the chat box for
 * you so you dont have to click it first".
 *
 * The unit test next to the code can only check the shape of the guard - that
 * it looks at defaultPrevented, at the modifiers, at what already has focus.
 * It cannot check the one thing the feature is: that the character is not
 * lost. Focus is moved during keydown precisely so the browser delivers the
 * keystroke itself, and whether that actually happens is a fact about a
 * browser, not about the source.
 *
 * So the keys here are real key presses through Electron rather than
 * dispatched events. A dispatched keydown types nothing - it only tells the
 * page a key went down - so a test that dispatched one and then found the box
 * empty would be measuring its own stub.
 *
 * The three things it must NOT do are half of why this exists. Listening to
 * every key in the window is helpful exactly when nobody had put focus
 * anywhere, and rude every other time.
 */
const { signIn, MESSAGE_BOX } = require('../lib.cjs')

const press = (win, key, modifiers = []) => {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
  win.webContents.sendInputEvent({ type: 'char', keyCode: key, modifiers })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
}

/** What has focus, and what is in the box. */
const STATE = `(() => {
  const box = ${MESSAGE_BOX}
  const el = document.activeElement
  return {
    onComposer: !!box && el === box,
    value: box ? box.value : null,
    tag: el ? el.tagName : null,
    cls: el && el.className ? String(el.className) : '',
  }
})()`

module.exports = {
  name: 'type-anywhere',
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
    await wait(1500)
    check('there is a message box', await until('the box', `!!${MESSAGE_BOX}`))

    /*
     * The window has to actually hold the keyboard, or a real key press goes
     * nowhere and every check below passes for the wrong reason.
     */
    win.show()
    win.focus()
    await wait(400)

    // --- the thing itself -------------------------------------------------
    /* Opening a channel already puts the cursor in the box, so it is taken
       away again first: this is about the state somebody is in after they
       have clicked a name, scrolled the list, or come back to the window. */
    await js(`(() => { ${MESSAGE_BOX}.blur(); document.body.focus(); return 1 })()`)
    await wait(300)
    const before = await js(STATE)
    check('the box does not have focus to start with',
      before.onComposer === false, before)
    check('and is empty', (before.value || '') === '', before)

    press(win, 'h')
    await wait(400)
    press(win, 'i')
    await wait(400)
    const after = await js(STATE)
    check('typing picks the box up', after.onComposer === true, after)
    check('and the letters are in it, not lost',
      (after.value || '') === 'hi', after)

    // --- and what it must not take ----------------------------------------
    /*
     * The search box is somewhere somebody is deliberately writing. Taking a
     * letter out of it would be worse than never having done any of this.
     */
    /* Opened rather than looked for: it is not on screen until somebody asks
       for it, and a check that skips itself when the thing is absent is a
       check that passes for the wrong reason. */
    await js(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => x.getAttribute('aria-label') === 'Search')
      if (b) b.click()
      return 1
    })()`)
    await wait(900)
    const searched = await js(`(() => {
      const s = document.querySelector('.searchp input')
      if (!s) return { there: false }
      s.focus()
      return { there: true, focused: document.activeElement === s }
    })()`)
    check('the search box opens and takes focus',
      searched.there === true && searched.focused === true, searched)

    press(win, 'z')
    await wait(500)
    const kept = await js(`(() => {
      const s = document.querySelector('.searchp input')
      const box = ${MESSAGE_BOX}
      return {
        stillThere: !!s && document.activeElement === s,
        search: s ? s.value : null,
        composer: box ? box.value : null,
      }
    })()`)
    check('and typing in it is left alone', kept.stillThere === true, kept)
    check('and the letter went there, not to the message box',
      kept.search === 'z', kept)
    check('and the message box is untouched', kept.composer === 'hi', kept)

    /* Put it away again, or the shortcut check below runs with a panel open
       and would pass because of that rather than because of the modifier. */
    await js(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => x.getAttribute('aria-label') === 'Search')
      if (b) b.click()
      return 1
    })()`)
    await wait(700)

    // --- and not into a box hidden behind something else -------------------
    /*
     * The composer stays mounted while settings is open - the whole window
     * is drawn over it - so a listener that only asked "is anything taking
     * typing" would put characters into a box nobody can see. Found by
     * audit, not by using it, which is exactly the kind of thing a class
     * list of overlays misses.
     */
    const opened = await js(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => /settings/i.test(x.getAttribute('aria-label') || ''))
      if (b) b.click()
      return !!b
    })()`)
    await wait(1200)
    const inSettings = await js(`(() => ({
      open: !!document.querySelector('.setwin'),
      composerStillThere: !!${MESSAGE_BOX},
    }))()`)
    check('settings opens, with the message box still mounted behind it',
      opened === true && inSettings.open === true && inSettings.composerStillThere === true,
      inSettings)

    await js(`(() => { const a = document.activeElement; if (a && a.blur) a.blur(); document.body.focus(); return 1 })()`)
    await wait(300)
    press(win, 'q')
    await wait(500)
    const behind = await js(`(() => ({
      composer: ${MESSAGE_BOX} ? ${MESSAGE_BOX}.value : null,
      onComposer: document.activeElement === ${MESSAGE_BOX},
    }))()`)
    check('typing over settings does not reach the box behind it',
      behind.composer === 'hi' && behind.onComposer === false, behind)

    /* Put settings away again. */
    await js(`(() => {
      const x = document.querySelector('.setwin .sx')
      if (x) x.click()
      return 1
    })()`)
    await wait(900)

    // --- and a shortcut is still a shortcut --------------------------------
    /*
     * Ctrl and a letter is somebody asking for something, not writing. If
     * this took it, every shortcut in the app would put a stray character in
     * the message box on its way past.
     */
    await js(`(() => { ${MESSAGE_BOX}.blur(); document.body.focus(); return 1 })()`)
    await wait(300)
    press(win, 'k', ['control'])
    await wait(400)
    const afterShortcut = await js(STATE)
    check('a shortcut does not type into the box',
      (afterShortcut.value || '') === 'hi', afterShortcut)
  },
}
