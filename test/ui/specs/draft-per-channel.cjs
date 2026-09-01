/**
 * A half-written message stays where it was written.
 *
 * Reported: "if i start typing a message then dont send it and then go to
 * another chat the message I was half finished typing will carry over to the
 * other chat" - so something meant for one person sat in the box in somebody
 * else's server, one Enter away from going to the wrong place.
 *
 * Clearing the box on the way out fixes exactly that and introduces its
 * opposite, so each channel keeps its own instead. Both halves are checked,
 * because only testing that the box empties would pass a change that threw
 * the message away.
 *
 * And the reply, which followed the same way the words did and matters more:
 * a reply aimed at a message in one channel, sent into another, is wrong
 * rather than surprising, and nothing on screen says so.
 */
const { signIn, sayAs, SET_VALUE, MESSAGE_BOX } = require('../lib.cjs')

const BOX = `document.querySelector('.cmp textarea')`
const READ = `(() => ({
  text: ${BOX} ? ${BOX}.value : null,
  replying: !!document.querySelector('.replybar'),
  channel: ([...document.querySelectorAll('.tbn')].pop() || {}).textContent,
}))()`

const type = (what) => `(() => {
  const box = ${BOX}
  box.focus()
  /* The semicolon matters: a line starting with ( after a call is parsed as
     calling what that call returned, and focus() returns undefined. */
  ;(${SET_VALUE})(box, ${JSON.stringify(what)})
  return box.value })()`

module.exports = {
  name: 'draft-per-channel',
  width: 1280,
  height: 860,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1500)

    const goHome = `(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`
    const openDm = `(() => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /baileyyy/i.test(r.textContent))
      if (row) row.click()
      return 1 })()`
    const goSpace = `(() => {
      const pip = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')][0]
      if (pip) pip.click()
      return 1 })()`
    const openChannel = (n) => `(() => {
      const rows = [...document.querySelectorAll('.chan')]
      if (rows[${n}]) rows[${n}].click()
      return 1 })()`

    // ---- something typed into a conversation ----
    await js(goHome)
    await until('the conversation list', `document.querySelectorAll('.chan').length > 0`, 12000)
    await js(openDm)
    await wait(1200)
    await js(type('meant for you only'))
    await wait(400)
    const inDm = await js(READ)
    console.log('      typed in the DM: ' + JSON.stringify(inDm))
    check('it is in the box where it was typed', inDm.text === 'meant for you only', inDm)

    // ---- and then a server channel ----
    await js(goSpace)
    await wait(1400)
    const arrived = await js(READ)
    console.log('      after switching: ' + JSON.stringify(arrived))
    check('it does not follow you into a server', arrived.text === '', arrived)

    await js(type('meant for the server'))
    await wait(400)

    // ---- back again: the first one is still there ----
    await js(goHome)
    await until('the conversation list', `document.querySelectorAll('.chan').length > 0`, 12000)
    await js(openDm)
    await wait(1400)
    const backInDm = await js(READ)
    console.log('      back in the DM:  ' + JSON.stringify(backInDm))
    /* The half that clearing-on-exit would have failed. */
    check('and going back finds what you were writing',
      backInDm.text === 'meant for you only', backInDm)

    await js(goSpace)
    await wait(1400)
    const backInSpace = await js(READ)
    console.log('      back in server:  ' + JSON.stringify(backInSpace))
    check('each one kept its own', backInSpace.text === 'meant for the server', backInSpace)

    // ---- a reply is aimed at a message, so it stays with it ----
    await js(`(() => { const b = ${BOX}; b.focus(); (${SET_VALUE})(b, ''); return 1 })()`)
    const said = await sayAs(js, setup.friends.baileyyy.token, 'something to answer')
    check('there is a message to reply to', said.ok === true, said)
    await until('the message', `document.querySelectorAll('.msg').length > 0`, 12000)
    await wait(900)

    await js(`(() => {
      const row = [...document.querySelectorAll('.msg')]
        .find((m) => /something to answer/.test(m.textContent))
      if (row) row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))
      return 1 })()`)
    await wait(700)
    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')].find((x) => /Reply/.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await wait(700)

    const armed = await js(READ)
    console.log('      reply armed:     ' + JSON.stringify(armed))
    check('the composer is armed to reply', armed.replying === true, armed)

    await js(goHome)
    await until('the conversation list', `document.querySelectorAll('.chan').length > 0`, 12000)
    await js(openDm)
    await wait(1400)
    const elsewhere = await js(READ)
    console.log('      then elsewhere:  ' + JSON.stringify(elsewhere))
    /*
     * The one that is wrong rather than surprising: sending here would have
     * carried a reply to a message that is not in this conversation.
     */
    check('the reply does not follow you into another conversation',
      elsewhere.replying === false, elsewhere)
    check('and that conversation still has its own words',
      elsewhere.text === 'meant for you only', elsewhere)

    await js(goSpace)
    await wait(1400)
    const returned = await js(READ)
    console.log('      and back again:  ' + JSON.stringify(returned))
    check('while the reply is waiting where it was aimed',
      returned.replying === true, returned)
  },
}
