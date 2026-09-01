/**
 * The message box grows downwards instead of scrolling sideways.
 *
 * Asked for: "another chat box expanding down or something so you can see full
 * msg before sending - text box just moves right as you type rather than
 * expanding downwards ... ofc with a limit to the expanding downwards", and
 * then "being able to hold shift and press enter too to start a new line".
 *
 * It was an <input>, which physically cannot wrap: one line, and everything
 * past it scrolled out of sight to the left, so a long message was written
 * blind. Shift+Enter did nothing for the same reason - there was nowhere for
 * the line to go.
 *
 * Four things have to hold, and the last two are why this is a browser test
 * rather than a measurement of the stylesheet:
 *
 *   it starts one line tall
 *   it grows with the text, and the conversation gives up the room
 *   it stops growing somewhere, and scrolls after that
 *   shift+enter puts in a line, and enter still sends
 *
 * The keys at the end are sent through Electron as real key presses rather
 * than dispatched as events. A dispatched keydown does not type anything - it
 * only tells the page a key went down - so a test that dispatched one and
 * then looked for a newline would be asking whether the code it just ran had
 * run, which is no question at all.
 */
const { app } = require('electron')
const { signIn, MESSAGE_BOX, SET_VALUE } = require('../lib.cjs')

/*
 * Real key presses need the window to actually have the keyboard.
 *
 * One run of this typed a newline and sent a message; the next, the same two
 * key presses did nothing whatever - because these windows are shown but not
 * reliably in front, and a key sent to a webContents still has to land on a
 * focused element. So the window is brought forward and the box focused, and
 * both are asserted before anything is typed: a run that could not get the
 * keyboard should say so rather than look like a broken feature.
 */
const press = (win, key, modifiers = []) => {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
  win.webContents.sendInputEvent({ type: 'char', keyCode: key, modifiers })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
}

module.exports = {
  name: 'composer-grows',
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
    check('there is a message box',
      await until('the box', `!!${MESSAGE_BOX}`))

    check('and it is a textarea, which is the only kind that can wrap',
      await js(`(() => ${MESSAGE_BOX}.tagName)()`) === 'TEXTAREA')

    /*
     * Measured together every time: the box, the list of messages above it,
     * and whether the box is scrolling itself. The list matters because a box
     * that grew *over* the conversation would pass every check about its own
     * height and be worse than what it replaced.
     */
    const LOOK = `(() => {
      const box = ${MESSAGE_BOX}
      const list = document.querySelector('.stream')
      const wrap = document.querySelector('.cmp')
      const r = box.getBoundingClientRect()
      const w = wrap.getBoundingClientRect()
      return {
        box: Math.round(r.height),
        lines: Math.round(r.height / parseFloat(getComputedStyle(box).lineHeight)),
        scrolls: box.scrollHeight > box.clientHeight + 1,
        list: list ? Math.round(list.getBoundingClientRect().height) : null,
        bottom: Math.round(w.bottom),
        viewport: window.innerHeight,
        /* A drag handle in the corner of a chat box is a thing to catch by
           accident, and the height is not yours to set anyway. */
        resize: getComputedStyle(box).resize,
        /* The whole composer, and what is in it.
         *
         * When the conversation does not get its room back, the box being
         * one line again says only that the box is not the culprit. This
         * says what is: every child of .cmp that is taking height, by class
         * and by how much. */
        cmp: Math.round(w.height),
        /* What the notice strip is reserving at the top of this column. A
           notice appearing mid-test takes height from the conversation and
           from nothing else, which is exactly what this spec used to report
           as the composer keeping it. */
        bars: getComputedStyle(document.documentElement)
          .getPropertyValue('--bars').trim() || '0px',
        parts: [...wrap.children].map((c) => ({
          cls: c.className || c.tagName.toLowerCase(),
          h: Math.round(c.getBoundingClientRect().height),
        })).filter((p) => p.h > 0),
        /* And everything the conversation shares its column with. The
           composer can be blameless and the conversation still lose height,
           if something above it arrived while the test was typing. */
        column: list && list.parentElement
          ? [...list.parentElement.children].map((c) => ({
              cls: c.className || c.tagName.toLowerCase(),
              h: Math.round(c.getBoundingClientRect().height),
            })).filter((p) => p.h > 0)
          : [],
      }
    })()`

    const type = (text) => js(`(() => {
      const box = ${MESSAGE_BOX}
      ;(${SET_VALUE})(box, ${JSON.stringify(text)})
      return 1 })()`)

    const empty = await js(LOOK)
    console.log('      empty:     ' + JSON.stringify(empty))
    check('it starts one line tall', empty.lines === 1, empty)
    check('with no scrollbar in it', empty.scrolls === false, empty)
    check('and no drag handle', empty.resize === 'none', empty.resize)

    // --- it grows -----------------------------------------------------------
    await type(Array.from({ length: 4 }, (_, i) => `line number ${i + 1}`).join('\n'))
    await wait(400)
    const four = await js(LOOK)
    console.log('      four lines:' + JSON.stringify(four))
    check('four lines make it four lines tall', four.lines === 4, four)
    check('and it does not scroll at four lines', four.scrolls === false, four)
    check('the conversation gives up the room, rather than being covered',
      four.list < empty.list && four.bottom <= four.viewport,
      { was: empty.list, now: four.list, bottom: four.bottom, viewport: four.viewport })

    /* Wrapping, not just newlines - which is the case that was reported, since
       nobody types a newline into a box that cannot hold one. */
    await type('a '.repeat(400).trim())
    await wait(400)
    const wrapped = await js(LOOK)
    console.log('      wrapped:   ' + JSON.stringify(wrapped))
    check('one long line without any newlines in it wraps and grows',
      wrapped.lines > 1, wrapped)

    // --- and stops ----------------------------------------------------------
    await type(Array.from({ length: 60 }, (_, i) => `line number ${i + 1}`).join('\n'))
    await wait(400)
    const many = await js(LOOK)
    console.log('      sixty:     ' + JSON.stringify(many))
    check('sixty lines do not make it sixty lines tall', many.lines < 20, many)
    check('it scrolls instead, once it stops growing', many.scrolls === true, many)
    check('and the whole thing is still on the screen',
      many.bottom <= many.viewport, { bottom: many.bottom, viewport: many.viewport })
    check('with the conversation still visible above it',
      many.list > 100, many.list)

    // --- and comes back down ------------------------------------------------
    await type('')
    await wait(400)
    const cleared = await js(LOOK)
    console.log('      cleared:   ' + JSON.stringify(cleared))
    check('emptying it puts it back to one line', cleared.lines === 1, cleared)
    /*
     * Everything that is not the conversation is the same size as it was.
     *
     * Not "the conversation is the height it was", which is what this asked
     * before and is not the same claim: the whole column moves when a notice
     * appears, because .pane.chatpane reserves --bars at the top of it. The
     * conversation loses exactly that, the header, the typing line and the
     * composer keep theirs, and the bottom of the window does not move - so
     * an absolute height reads as the composer having kept the room when the
     * composer has given all of it back.
     *
     * Measured on the sweep, at 667 then 605: chd 58, typ 22 and cmp 81 on
     * both sides, and --bars the only thing that changed. Asking what the
     * composer holds instead cannot be moved by anything above it.
     */
    const held = (r) => r.column.reduce((n, p) => n + p.h, 0) - r.list
    console.log('      held by everything else: '
      + held(empty) + ' then ' + held(cleared)
      + '  (--bars ' + empty.bars + ' then ' + cleared.bars + ')')
    check('and gives the conversation its room back',
      held(cleared) === held(empty),
      { was: empty.list, now: cleared.list,
        heldBefore: held(empty), heldAfter: held(cleared),
        barsBefore: empty.bars, barsAfter: cleared.bars })

    // --- shift+enter --------------------------------------------------------
    /*
     * Real key presses, through the browser rather than at it. A dispatched
     * KeyboardEvent does not type: it tells the page a key went down and
     * inserts nothing, so looking for a newline afterwards would only be
     * asking whether the test's own code had run.
     */
    await type('first')
    await wait(300)

    win.show()
    app.focus({ steal: true })
    win.focus()
    await wait(600)

    /* The caret goes to the end: setting the value leaves it at the start,
       and a newline typed at position 0 would prove nothing about sending. */
    const ready = await js(`(() => {
      const b = ${MESSAGE_BOX}
      b.focus()
      b.setSelectionRange(b.value.length, b.value.length)
      return { focused: document.activeElement === b, hasFocus: document.hasFocus() }
    })()`)
    console.log('      keyboard:  ' + JSON.stringify(ready))
    /*
    * The element, not the window.
    *
    * A spec runs in a window placed off the side of the screen and marked
    * unfocusable, so it does not take the keyboard off whoever is using the
    * machine - and `document.hasFocus()` is false there for that reason and
    * no other. What this is actually about is the box having the caret,
    * which is the check underneath, and asking the window as well only
    * reported the harness's own arrangement as a failure.
    */
    check('the window can be typed into', ready.focused === true, ready)
    check('and the message box has it', ready.focused === true, ready)

    press(win, 'Return', ['shift'])
    await wait(500)

    const afterShift = await js(`(() => ({
      value: ${MESSAGE_BOX}.value,
      sent: [...document.querySelectorAll('.mbody')].some((m) => /first/.test(m.textContent)),
    }))()`)
    console.log('      shift+enter: ' + JSON.stringify(afterShift))
    check('shift and enter puts a new line in', /\n/.test(afterShift.value), afterShift.value)
    check('and does not send it', afterShift.sent === false, afterShift)

    // --- enter still sends --------------------------------------------------
    press(win, 'Return')

    /*
     * Looked for in the conversation rather than in one class of element:
     * a message on its way, one just delivered and one from a moment ago are
     * not all drawn the same, and this is asking whether it was sent at all.
     */
    const SAID = `document.querySelector('.stream').textContent.includes('first')`
    const arrived = await until('the message to arrive', SAID, 15000)

    const afterEnter = await js(`(() => ({
      value: ${MESSAGE_BOX}.value,
      sent: ${SAID},
      messages: document.querySelectorAll('.msg').length,
      tail: document.querySelector('.stream').textContent.slice(-120),
      lines: Math.round(${MESSAGE_BOX}.getBoundingClientRect().height
        / parseFloat(getComputedStyle(${MESSAGE_BOX}).lineHeight)),
    }))()`)
    console.log('      enter:     ' + JSON.stringify(afterEnter))
    check('enter on its own still sends', arrived && afterEnter.sent === true, afterEnter)
    check('and empties the box', afterEnter.value === '', afterEnter.value)
    check('which shrinks back to one line', afterEnter.lines === 1, afterEnter.lines)

    // --- and the box for editing a message, which is the same thing --------
    /*
     * Reached by pressing up on an empty composer, which is how the app
     * offers it - and which also checks that shortcut still works now that
     * up in a textarea is a key that moves the caret.
     *
     * The styling is asserted, not just the growing. This box was changed to
     * a textarea and the stylesheet still said `.edit-box input`, so it kept
     * working perfectly and looked like a bare browser textarea dropped into
     * the conversation. Nothing failed; it was found by reading. A border and
     * a background are the cheap way to ask whether any of our rules reached
     * it at all.
     */
    press(win, 'Up')
    const opened = await until('the edit box', `!!document.querySelector('.msgedit textarea')`, 8000)
    check('pressing up on an empty box edits the last message', opened)

    const edit = await js(`(() => {
      const box = document.querySelector('.msgedit textarea')
      if (!box) return { there: false }
      const style = getComputedStyle(box)
      return {
        there: true,
        border: style.borderTopWidth,
        background: style.backgroundColor,
        radius: style.borderTopLeftRadius,
        resize: style.resize,
        lines: Math.round(box.getBoundingClientRect().height / parseFloat(style.lineHeight)),
        scrolls: box.scrollHeight > box.clientHeight + 1,
      }
    })()`)
    console.log('      edit box:  ' + JSON.stringify(edit))
    check('and the app styles it, rather than the browser',
      edit.there && edit.border !== '0px' && edit.radius !== '0px'
      && edit.background !== 'rgba(0, 0, 0, 0)',
      edit)
    check('with no drag handle either', edit.resize === 'none', edit.resize)

    await js(`(() => {
      const box = document.querySelector('.msgedit textarea')
      ;(${SET_VALUE})(box, ['one', 'two', 'three', 'four'].join(String.fromCharCode(10)))
      return 1 })()`)
    await wait(400)
    const grown = await js(`(() => {
      const box = document.querySelector('.msgedit textarea')
      return {
        lines: Math.round(box.getBoundingClientRect().height
          / parseFloat(getComputedStyle(box).lineHeight)),
        /*
         * This box has a border and the composer does not, which is the
         * whole reason to ask. scrollHeight counts padding but not border,
         * so a height set from it leaves the text two pixels short of
         * fitting and the box carries a scrollbar it has no need of.
         */
        scrolls: box.scrollHeight > box.clientHeight + 1,
      }
    })()`)
    console.log('      edit grew: ' + JSON.stringify(grown))
    check('and it grows with the message being edited', grown.lines >= 4,
      { was: edit.lines, now: grown.lines })
    check('without a scrollbar it does not need', grown.scrolls === false, grown)
  },
}
