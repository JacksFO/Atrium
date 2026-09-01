/**
 * Editing a message starts where you would start typing, and can be got out of.
 *
 * Three things reported together:
 *   "when I click edit message it auto goes to the front of the message [not]
 *    to the end of the message to edit it. the type cursor that is."
 *   "when I right click and edit message then I go somewhere else it stays
 *    like its in the edit message mode"
 *   "if i click out of the edit mesaage mode then press ESC to close it, it
 *    doesnt close it"
 *
 * The last two are one fault. Escape was handled on the text box, so once
 * anything else had focus nothing was listening, and the only way out of the
 * box was to click back into the thing you were trying to leave.
 */
const { signIn, typeAndSend, SET_VALUE } = require('../lib.cjs')

const STATE = `(() => {
  const box = document.querySelector('.msgedit textarea')
  return {
    open: !!box,
    focused: box === document.activeElement,
    value: box ? box.value : null,
    caret: box ? box.selectionStart : null,
    end: box ? box.value.length : null,
  }
})()`

const openEditor = `(async () => {
  const row = [...document.querySelectorAll('.msg')].find((m) => /the original words/.test(m.textContent))
  if (!row) return { ok: false, why: 'no message' }
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))
  await new Promise((r) => setTimeout(r, 500))
  const item = [...document.querySelectorAll('.ctx .mitem')].find((x) => /^Edit/.test(x.textContent))
  if (!item) return { ok: false, why: 'no Edit in the menu' }
  item.click()
  return { ok: true } })()`

module.exports = {
  name: 'edit-message',
  width: 1280,
  height: 860,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1500)

    await typeAndSend(js, 'the original words')
    await until('the message', `[...document.querySelectorAll('.msg')].some((m) => /the original words/.test(m.textContent))`, 12000)
    await wait(800)

    // ---- the cursor starts where you would type ----
    const opened = await js(openEditor)
    check('the editor opens', opened.ok === true, opened)
    await wait(700)

    const start = await js(STATE)
    console.log('      on opening: ' + JSON.stringify(start))
    check('the box is open and focused', start.open && start.focused, start)
    check('holding the message', start.value === 'the original words', start)
    /* The report: it was landing at nought, the wrong end of a sentence
       somebody has opened in order to add to. */
    check('with the cursor at the end, not the front',
      start.caret === start.end && start.end > 0, start)

    // ---- Escape works after focus has gone elsewhere ----
    await js(`(() => { const c = document.querySelector('.cmp textarea'); if (c) c.focus(); return 1 })()`)
    await wait(400)
    const away = await js(STATE)
    console.log('      focus moved: ' + JSON.stringify(away))
    /*
     * The precondition. If clicking away had already closed the box there
     * would be nothing left for Escape to fail to close, and the check below
     * would pass without testing anything.
     */
    check('the box is still open with focus elsewhere', away.open === true, away)
    check('and no longer has the cursor', away.focused === false, away)

    await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1 })()`)
    await wait(600)
    const afterEsc = await js(STATE)
    console.log('      after Escape: ' + JSON.stringify(afterEsc))
    check('Escape closes it from wherever you are', afterEsc.open === false, afterEsc)

    // ---- an untouched box gets out of the way when you click away ----
    const again = await js(openEditor)
    check('it can be opened again', again.ok === true, again)
    await wait(700)
    check('and is open', (await js(STATE)).open === true)

    await js(`(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      return 1 })()`)
    await wait(600)
    const clickedAway = await js(STATE)
    console.log('      clicked away untouched: ' + JSON.stringify(clickedAway))
    check('clicking away from a box you have not typed in closes it',
      clickedAway.open === false, clickedAway)

    // ---- but one you have typed in waits for you ----
    await js(openEditor)
    await wait(700)
    await js(`(() => {
      const b = document.querySelector('.msgedit textarea')
      b.focus()
      ;(${SET_VALUE})(b, 'the original words and more')
      return 1 })()`)
    await wait(400)
    await js(`(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      return 1 })()`)
    await wait(600)
    const kept = await js(STATE)
    console.log('      clicked away mid-edit:  ' + JSON.stringify(kept))
    /*
     * Losing a correction somebody is halfway through is worse than a box
     * that waits, so this one stays - and Escape is how it goes.
     */
    check('a half-written edit is not thrown away by a click elsewhere',
      kept.open === true && /and more/.test(kept.value || ''), kept)
  },
}
