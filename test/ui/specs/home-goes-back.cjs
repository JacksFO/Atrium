/**
 * The home button goes back to where you were, not to the last conversation.
 *
 * Asked for: "when I click the homepage button it always takes me back to the
 * last DM I had open, I just want it to go back to whatever page I was on in
 * the homepage, whether that was a DM or was just the homepage itself or
 * friends or whatever".
 *
 * It remembered one thing - the last conversation - so the friends list and
 * the greeting were both thrown away. Somebody reading their friends list,
 * clicking into a server and coming back was put into a conversation they may
 * have closed an hour before.
 *
 * The conversation case already worked and is checked here too, because the
 * fix is only a fix if it did not trade one of the three for another.
 */
const { signIn } = require('../lib.cjs')

/* Which of the three the conversations side is showing. Read from the nav's
   own "on" mark and from what is drawn, rather than from anything this test
   sets, so it says what somebody would see. */
const WHERE = `(() => {
  const on = [...document.querySelectorAll('.nrow.on .nm')].map((n) => n.textContent.trim())
  const open = document.querySelector('.chd .tt')
  return {
    nav: on[0] || null,
    heading: open ? open.textContent.trim() : null,
  } })()`

const RAIL_HOME = `document.querySelector('.pane.rail .rl[aria-label="Conversations"]')`

const clickNav = (name) => `(() => {
  const b = [...document.querySelectorAll('.nrow')]
    .find((x) => (x.querySelector('.nm') || {}).textContent === ${JSON.stringify(name)})
  if (!b) return { ok: false, saw: [...document.querySelectorAll('.nrow .nm')].map((n) => n.textContent) }
  b.click()
  return { ok: true } })()`

module.exports = {
  name: 'home-goes-back',
  width: 1300,
  height: 860,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1500)

    /* Onto the conversations side, and then the friends list. */
    await js(`(() => { const b = ${RAIL_HOME}; if (b) b.click(); return 1 })()`)
    await until('the conversations nav', `!!document.querySelector('.nrow')`, 10000)
    await wait(800)

    const toFriends = await js(clickNav('Friends'))
    check('friends can be opened', toFriends.ok === true, toFriends)
    await wait(1200)
    const onFriends = await js(WHERE)
    console.log('      left on: ' + JSON.stringify(onFriends))
    check('and that is where we are', onFriends.nav === 'Friends', onFriends)

    /* Away to a server, which is the click that used to lose it. */
    await js(`(() => {
      const rail = [...document.querySelectorAll('.pane.rail .rl')]
        .find((r) => !/Conversations/i.test(r.getAttribute('aria-label') || '')
          && !r.classList.contains('rlnew') && !r.classList.contains('rlread'))
      if (rail) rail.click()
      return 1 })()`)
    await until('a server', `document.querySelectorAll('.chan').length > 0`, 10000)
    await wait(1200)

    /* And back. */
    await js(`(() => { const b = ${RAIL_HOME}; if (b) b.click(); return 1 })()`)
    await until('the conversations nav again', `!!document.querySelector('.nrow')`, 10000)
    await wait(1500)

    const backAgain = await js(WHERE)
    console.log('      came back to: ' + JSON.stringify(backAgain))
    check('it comes back to the friends list, not a conversation',
      backAgain.nav === 'Friends', backAgain)

    /* --- and a conversation is still remembered, which already worked --- */
    console.log('  --- and the case that already worked ---')

    const opened = await js(`(() => {
      const row = document.querySelector('.chats .chat, .chatlist .chat, .nrow + .sect ~ button')
      if (row) { row.click(); return { ok: true, said: row.textContent.trim().slice(0, 40) } }
      /* Whatever the conversation rows are called here, they are the buttons
         under the nav that are not the two pages. */
      const any = [...document.querySelectorAll('button')]
        .find((b) => b.querySelector('.av') && !b.classList.contains('rl'))
      if (!any) return { ok: false }
      any.click()
      return { ok: true, said: any.textContent.trim().slice(0, 40) } })()`)
    console.log('      opened: ' + JSON.stringify(opened))
    check('a conversation can be opened', opened.ok === true, opened)
    await wait(1500)

    const inDm = await js(WHERE)
    check('and the nav no longer marks a page', inDm.nav === null, inDm)

    await js(`(() => {
      const rail = [...document.querySelectorAll('.pane.rail .rl')]
        .find((r) => !/Conversations/i.test(r.getAttribute('aria-label') || '')
          && !r.classList.contains('rlnew') && !r.classList.contains('rlread'))
      if (rail) rail.click()
      return 1 })()`)
    await until('the server again', `document.querySelectorAll('.chan').length > 0`, 10000)
    await wait(1200)
    await js(`(() => { const b = ${RAIL_HOME}; if (b) b.click(); return 1 })()`)
    await wait(1800)

    const backToDm = await js(WHERE)
    console.log('      came back to: ' + JSON.stringify(backToDm))
    check('and a conversation is come back to as well', backToDm.nav === null, backToDm)
  },
}
