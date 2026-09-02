/**
 * Following the conversation, and letting go of it.
 *
 * Reported as clunky. The rule is "follow a new message if the reader is
 * within 120 pixels of the end", and 120 pixels is one or two messages - so
 * nudging up to re-read the message before last still counts as being at the
 * end, and the next thing anybody says drags the reader back down off the
 * thing they went up to look at.
 *
 * What this pins is the difference between the two ways of being near the
 * bottom: sitting at it, which should follow, and having deliberately gone up
 * from it, which should not - however small the distance turns out to be.
 *
 * Scrolled by moving scrollTop rather than by turning a wheel, because that
 * is what every input the app has to cope with ends up doing: a wheel, a
 * finger, Page Up, and a hand on the scrollbar all arrive as the same event.
 */
const { signIn, sayAs } = require('../lib.cjs')

const openChannel = (n) => `(() => {
  const list = document.querySelectorAll('.chan')
  const el = list[${n}] || list[0]
  if (el) el.click()
  return list.length
})()`

/** Where the list is, in the two numbers that matter. */
const WHERE = `(() => {
  const s = document.querySelector('.stream')
  return {
    top: Math.round(s.scrollTop),
    fromEnd: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight),
  }
})()`

/** Say a lot down one socket, so a channel can be made scrollable quickly. */
async function sayManyAs(js, token, howMany) {
  return await js(`(async () => {
    return await new Promise((resolve) => {
      const s = new WebSocket('ws://' + location.host + '/gateway')
      s.onopen = () => s.send(JSON.stringify({ t: 'hello', token: ${JSON.stringify(token)} }))
      s.onmessage = (e) => {
        const m = JSON.parse(e.data)
        if (m.t === 'ping') return s.send(JSON.stringify({ t: 'pong' }))
        if (m.t !== 'ready') return
        const ch = (m.channels || []).find((c) => c.kind === 'text')
        if (!ch) { s.close(); return resolve({ sent: 0, why: 'no text channel' }) }
        for (let i = 0; i < ${howMany}; i++) {
          s.send(JSON.stringify({ t: 'send', channelId: ch.id,
            body: 'filling the channel, number ' + (i + 1),
            nonce: 'fill-' + i + '-' + Math.random().toString(36).slice(2) }))
        }
        setTimeout(() => { s.close(); resolve({ sent: ${howMany} }) }, 2500)
      }
      setTimeout(() => resolve({ sent: 0, why: 'never ready' }), 12000)
    }) })()`)
}

module.exports = {
  name: 'stick-to-bottom',
  width: 1300,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)
    const friend = setup.friends && setup.friends.Baileyyy
    check('there is somebody else to speak', !!(friend && friend.token), setup.friends)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(openChannel(0))
    await wait(1200)

    const filled = await sayManyAs(js, friend.token, 40)
    check('the channel can be filled', filled.sent === 40, filled)
    await wait(2500)

    const room = await js(`(() => {
      const s = document.querySelector('.stream')
      return { over: Math.round(s.scrollHeight - s.clientHeight) }
    })()`)
    check('the conversation is long enough to scroll', room.over > 400, room)

    // --- sitting at the end: it should follow -----------------------------
    await js(`(() => { const s = document.querySelector('.stream'); s.scrollTop = s.scrollHeight })()`)
    await wait(700)
    const atEnd = await js(WHERE)
    check('and we are at the end to start with', atEnd.fromEnd <= 8, atEnd)

    const said1 = await sayAs(js, friend.token, 'while you were at the end')
    check('somebody can speak', said1.ok === true, said1.why ?? said1)
    await wait(1400)
    const followed = await js(WHERE)
    console.log('      atEnd:   ' + JSON.stringify({ atEnd, followed }))
    check('it follows a new message when you are at the end',
      followed.fromEnd <= 8, followed)

    // --- nudged up one message: it should NOT follow ----------------------
    /*
     * The one that was reported. Sixty pixels is about one message - close
     * enough that the old rule called it "at the end", far enough that
     * somebody plainly went up there on purpose.
     */
    const nudged = await js(`(() => {
      const s = document.querySelector('.stream')
      s.scrollTop = s.scrollTop - 60
      return { top: Math.round(s.scrollTop),
        fromEnd: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight) }
    })()`)
    await wait(600)
    check('a small scroll up leaves us just off the end',
      nudged.fromEnd > 40 && nudged.fromEnd < 120, nudged)

    const before = await js(WHERE)
    const said2 = await sayAs(js, friend.token, 'while you were reading back a little')
    check('somebody can speak again', said2.ok === true, said2.why ?? said2)
    await wait(1400)
    const after = await js(WHERE)
    console.log('      nudged:  ' + JSON.stringify({ before, after }))
    check('a message does not drag you down from a deliberate scroll',
      Math.abs(after.top - before.top) <= 4, { before, after })

    // --- a long way up: it should certainly not follow --------------------
    await js(`(() => { const s = document.querySelector('.stream'); s.scrollTop = s.scrollTop - 400 })()`)
    await wait(600)
    const upBefore = await js(WHERE)
    const said3 = await sayAs(js, friend.token, 'while you were reading back a lot')
    check('somebody can speak a third time', said3.ok === true, said3.why ?? said3)
    await wait(1400)
    const upAfter = await js(WHERE)
    console.log('      far up:  ' + JSON.stringify({ upBefore, upAfter }))
    check('and certainly not from a long way up',
      Math.abs(upAfter.top - upBefore.top) <= 4, { upBefore, upAfter })

    // --- and there is a way back ------------------------------------------
    /*
     * Letting go leaves somebody with no way to the end but scrolling, and in
     * a channel with a few thousand messages loaded that is a long drag with
     * nothing on screen saying how far. So a button appears while they are
     * away, says what has arrived since, and puts them back.
     */
    const jump = await js(`(() => {
      const b = document.querySelector('.jumpdown-go')
      if (!b) return { there: false }
      const box = b.getBoundingClientRect()
      const s = document.querySelector('.stream').getBoundingClientRect()
      return {
        there: true,
        text: (b.textContent || '').replace(/\\s+/g, ' ').trim(),
        /* Over the conversation and near the bottom of it, which is where
           somebody's eye already is. */
        insideTheList: Math.round(box.bottom) <= Math.round(s.bottom) + 2,
        nearTheBottom: (s.bottom - box.bottom) < 60,
      }
    })()`)
    console.log('      jump:    ' + JSON.stringify(jump))
    check('a way back appears once you have let go', jump.there === true, jump)
    check('and says what arrived while you were up there',
      /2 new messages/.test(jump.text || ''), jump)
    check('and sits over the end of the conversation',
      jump.insideTheList === true && jump.nearTheBottom === true, jump)

    /* Pressed properly - a handler that only works when called is a control
       that does not work. */
    const hit = await js(`(() => {
      const b = document.querySelector('.jumpdown-go')
      const box = b.getBoundingClientRect()
      const at = document.elementFromPoint(
        Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2))
      const mine = !!(at && (at === b || b.contains(at)))
      if (mine) at.click()
      return { mine, tag: at ? at.className || at.tagName : null }
    })()`)
    check('the button is the thing under the pointer', hit.mine === true, hit)
    await wait(900)

    const landed = await js(WHERE)
    console.log('      landed:  ' + JSON.stringify(landed))
    check('and pressing it puts you at the newest message',
      landed.fromEnd <= 8, landed)
    check('and the way back goes once you are there',
      (await js(`!document.querySelector('.jumpdown-go')`)) === true)

    // --- and back at the end, it follows again ----------------------------
    /*
     * Letting go has to be temporary, or the conversation stops following for
     * the rest of the session and that is a worse fault than the one this is
     * about.
     */
    await js(`(() => { const s = document.querySelector('.stream'); s.scrollTop = s.scrollHeight })()`)
    await wait(800)
    const returned = await js(WHERE)
    check('we can get back to the end', returned.fromEnd <= 8, returned)

    const said4 = await sayAs(js, friend.token, 'and now you are back at the end')
    check('somebody can speak a fourth time', said4.ok === true, said4.why ?? said4)
    await wait(1400)
    const again = await js(WHERE)
    console.log('      back:    ' + JSON.stringify(again))
    check('it follows again once you are back at the end',
      again.fromEnd <= 8, again)
  },
}
