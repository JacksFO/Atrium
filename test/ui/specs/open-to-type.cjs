/**
 * Opening a conversation leaves the cursor in the message box.
 *
 * Asked for: "when i click a DM on the left side, it should auto put me into
 * the chat box so I can start typing without having to click it myself."
 *
 * Built for every channel rather than only for DMs - what is wanted is that
 * opening somewhere to talk leaves you ready to talk, and doing that for half
 * the list would read as the other half being broken - so both are checked.
 *
 * The three things it must NOT do are the reason this exists as a spec rather
 * than a line of code somebody trusts. Focus is the one piece of state a user
 * can also be holding: taking it is helpful exactly when they had not put it
 * anywhere themselves, and rude every other time.
 */
const { signIn } = require('../lib.cjs')

const WHERE = `(() => {
  const el = document.activeElement
  return {
    tag: el ? el.tagName : null,
    cls: el && el.className ? String(el.className) : '',
    isComposer: el === document.querySelector('.cmp textarea'),
  }
})()`

module.exports = {
  name: 'open-to-type',
  width: 1280,
  height: 860,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1500)

    // ---- a DM, which is what was asked for ----
    await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
    await until('the conversation list', `document.querySelectorAll('.chan').length > 0`, 12000)
    await js(`(() => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /baileyyy/i.test(r.textContent))
      if (row) row.click()
      return 1 })()`)
    await wait(1400)

    const inDm = await js(WHERE)
    console.log('      after opening a DM: ' + JSON.stringify(inDm))
    check('opening a conversation puts the cursor in the message box',
      inDm.isComposer === true, inDm)

    /* And it can actually be typed into from there, without a click. */
    const typed = await js(`(async () => {
      const box = document.activeElement
      if (!box || box.tagName !== 'TEXTAREA') return { ok: false, why: 'not in a text box' }
      box.focus()
      document.execCommand('insertText', false, 'straight in')
      await new Promise((r) => setTimeout(r, 250))
      return { ok: true, value: box.value } })()`)
    check('and typing lands in it', /straight in/.test(typed.value || ''), typed)

    // ---- and an ordinary channel, for the same reason ----
    await js(`(() => {
      const pip = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')][0]
      if (pip) pip.click()
      return 1 })()`)
    await wait(1200)
    await js(`(() => {
      const rows = [...document.querySelectorAll('.chan')]
      if (rows[1]) rows[1].click()
      return 1 })()`)
    await wait(1200)

    const inChannel = await js(WHERE)
    console.log('      after a channel:    ' + JSON.stringify(inChannel))
    check('a channel does the same', inChannel.isComposer === true, inChannel)

    /*
     * ---- but it does not take focus somebody is already using ----
     *
     * The search box proper, opened the way a person opens it. The first
     * version of this focused `.head-search`, which is the button that opens
     * the panel rather than anything you can type into - so it was asking
     * whether a click steals focus from a button, which it should, and the
     * check failed for being wrong rather than for finding anything.
     */
    await js(`(() => {
      const b = document.querySelector('[aria-label="Search"]')
      if (b) b.click()
      return 1 })()`)
    await until('the search box', `!!document.querySelector('.searchp input')`, 8000)
    await js(`(() => {
      const s = document.querySelector('.searchp input')
      s.focus()
      document.execCommand('insertText', false, 'half a wor')
      return 1 })()`)
    await wait(400)
    const before = await js(WHERE)
    console.log('      typing into search:  ' + JSON.stringify(before))
    check('the search box is a text box and can be typed into',
      before.tag === 'INPUT' && before.isComposer === false, before)

    await js(`(() => {
      const rows = [...document.querySelectorAll('.chan')]
      if (rows[0]) rows[0].click()
      return 1 })()`)
    await wait(1200)
    const after = await js(WHERE)
    console.log('      searching, then switching: ' + JSON.stringify(after))
    check('switching channels does not empty the search box of focus mid-word',
      after.isComposer === false, after)

    // ---- and not on a phone, where it would raise the keyboard ----
    win.setContentSize(390, 844)
    await wait(900)
    await win.loadURL(base + '/')
    await until('the phone layout',
      `window.matchMedia('(max-width: 820px)').matches && document.querySelector('.navtog')`, 15000)
    await wait(1500)
    /* Blur whatever the reload left focused, so this measures the click. */
    await js(`(() => { if (document.activeElement) document.activeElement.blur(); return 1 })()`)
    await js(`(() => { document.querySelector('.navtog').click(); return 1 })()`)
    await wait(900)
    await js(`(() => {
      const rows = [...document.querySelectorAll('.chan')]
      if (rows[1]) rows[1].click()
      return 1 })()`)
    await wait(1400)

    const onPhone = await js(WHERE)
    console.log('      on a phone:         ' + JSON.stringify(onPhone))
    /*
     * A keyboard sliding up over the messages you just opened the channel to
     * read, every time you tap one, is worse than a tap on the message box.
     */
    check('a phone is left alone, so the keyboard stays down',
      onPhone.isComposer === false, onPhone)
  },
}
