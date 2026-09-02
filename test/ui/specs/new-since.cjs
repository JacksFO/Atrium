/**
 * The bar that says what arrived while you were away.
 *
 * Asked for, with a screenshot: "16 new messages since 10:06 ... Mark as
 * Read". The list already draws a line where somebody came in, and that is
 * the right thing once they are looking at the place it marks - but it is
 * inside the list, so a channel with a lot of new messages opens at the end
 * of them with the line off screen and nothing saying it is there.
 *
 * A browser test because the parts worth checking cannot be seen from the
 * source. That it sits between the header and the messages rather than over
 * either of them: a strip that overlapped would cover something somebody is
 * reading. And that Mark as read actually makes it go - the count comes from
 * the server, so a bar that only hid itself would be back on the next frame.
 *
 * The unread is made the way it happens: somebody else speaks, over the
 * gateway, while this window is looking somewhere else. A message this
 * window sent, or one that arrived while it was watching, is read by the
 * time it lands and there would be nothing to announce.
 */
const { signIn, sayAs } = require('../lib.cjs')

/**
 * Say a lot, down one socket.
 *
 * sayAs opens and closes a connection per message, which is about a second
 * each - thirty of those is half a minute of waiting. The bar is about a
 * channel somebody cannot see the top of, so it needs that many.
 */
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
        let n = 0
        for (let i = 0; i < ${howMany}; i++) {
          s.send(JSON.stringify({ t: 'send', channelId: ch.id,
            body: 'missed number ' + (i + 1),
            nonce: 'many-' + i + '-' + Math.random().toString(36).slice(2) }))
          n++
        }
        setTimeout(() => { s.close(); resolve({ sent: n, channelId: ch.id }) }, 2500)
      }
      setTimeout(() => resolve({ sent: 0, why: 'the socket never became ready' }), 12000)
    }) })()`)
}

const BAR = `document.querySelector('.newsince')`

const LOOK = `(() => {
  const bar = ${BAR}
  const head = document.querySelector('.chd')
  const stream = document.querySelector('.stream')
  if (!bar) return { there: false, head: !!head, stream: !!stream }
  const b = bar.getBoundingClientRect()
  const h = head.getBoundingClientRect()
  const s = stream.getBoundingClientRect()
  return {
    there: true,
    text: (bar.textContent || '').replace(/\\s+/g, ' ').trim(),
    /* Touching both, overlapping neither. */
    belowHeader: Math.round(b.top) >= Math.round(h.bottom) - 1,
    aboveMessages: Math.round(b.bottom) <= Math.round(s.top) + 1,
    spansTheColumn: Math.abs(Math.round(b.width) - Math.round(s.width)) <= 2,
    buttons: bar.querySelectorAll('button').length,
  }
})()`

/** Open the first channel in the list, or the second one. */
const openChannel = (n) => `(() => {
  const list = document.querySelectorAll('.chan')
  const el = list[${n}] || list[0]
  if (el) el.click()
  return list.length
})()`

module.exports = {
  name: 'new-since',
  width: 1300,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)

    /*
     * Nothing unread yet, which is the precondition.
     *
     * If the bar were always drawn, every check below would pass without the
     * feature existing at all.
     */
    await js(openChannel(0))
    await wait(1200)
    const before = await js(LOOK)
    console.log('      before: ' + JSON.stringify(before))
    /* The conversation is on screen, asserted rather than assumed. Without
       this, a run where the app never loaded reports "no bar" as a pass -
       which is how a broken sign-up read as the feature behaving. */
    check('the conversation is on screen at all',
      before.head === true && before.stream === true, before)
    check('with nothing unread there is no bar', before.there === false, before)

    /* Look away, so what arrives next is genuinely missed. */
    const count = await js(openChannel(1))
    await wait(900)

    /* Keyed by name rather than a list - signIn hands back what it made,
       under the names it was asked for. */
    const friend = setup.friends && setup.friends.Baileyyy
    check('there is somebody else to speak', !!(friend && friend.token), setup.friends)
    const said = await sayAs(js, friend.token, 'while you were out')
    check('and they said something in the channel', said.ok === true, said.why ?? said)
    await wait(900)

    /* Back to where it was said, opened fresh - which is what somebody
       arriving after being away actually does. */
    await js(openChannel(0))
    await wait(1500)

    const shown = await js(LOOK)
    console.log('      after:  ' + JSON.stringify(shown))
    check('the bar appears once something was missed', shown.there === true, shown)
    check('and says how many, and since when',
      /new message/.test(shown.text || '') && / since /.test(shown.text || ''), shown.text)
    check('and offers a way back and a way to clear it',
      shown.buttons === 2, shown)

    // --- and it is where it should be ------------------------------------
    check('it sits under the header', shown.belowHeader === true, shown)
    check('and above the messages, covering neither', shown.aboveMessages === true, shown)
    check('and spans the conversation', shown.spansTheColumn === true, shown)

    // --- and Mark as read really clears it --------------------------------
    /*
     * Pressed, not called. The count comes back from the server, so a bar
     * that only hid itself locally would be back on the next frame - which
     * is why this waits well past one.
     */
    const pressed = await js(`(() => {
      const b = ${BAR} && ${BAR}.querySelector('.newsince-read')
      if (!b) return false
      b.click()
      return true
    })()`)
    check('Mark as read can be pressed', pressed === true)
    await wait(2000)

    const after = await js(LOOK)
    console.log('      cleared: ' + JSON.stringify(after))
    check('and the bar goes, and stays gone', after.there === false, after)

    check('the channel list was long enough for this to mean anything',
      typeof count === 'number' && count > 1, count)

    // --- and the time is when they were last here ------------------------
    /*
     * Not the time they opened it.
     *
     * Opening a channel while the window is watched marks it read, and the
     * server answers with the moment it did so - so a bar reading that as it
     * draws settles on "since <now>" a second after it appears and says
     * nothing at all. The two are the same clock unless the message is left
     * to age, which is why this waits for the minute to turn rather than
     * asserting on a message that is seconds old.
     */
    await js(openChannel(1))
    await wait(900)
    const aged = await sayAs(js, friend.token, 'this one is left to get old')
    check('a message can be left to age', aged.ok === true, aged.why ?? aged)

    const postedIn = await js(`new Date().getMinutes()`)
    const turned = await until('the clock to turn over',
      `new Date().getMinutes() !== ${postedIn}`, 70000)
    check('the minute turned, so then and now read differently', turned === true)

    await js(openChannel(0))
    await wait(1800)

    const timed = await js(`(() => {
      const bar = ${BAR}
      if (!bar) return { there: false }
      const now = new Date().toLocaleTimeString(undefined,
        { hour: '2-digit', minute: '2-digit' })
      return {
        there: true,
        text: (bar.textContent || '').replace(/\\s+/g, ' ').trim(),
        now,
      }
    })()`)
    console.log('      timed:    ' + JSON.stringify(timed))
    check('the bar is up for the aged message', timed.there === true, timed)
    check('and says a time', / since /.test(timed.text || ''), timed)
    check('and it is not the moment the channel was opened',
      !String(timed.text).includes(timed.now), timed)

    /* Pressed, so the next block starts from nothing again. */
    await js(`(() => {
      const b = ${BAR} && ${BAR}.querySelector('.newsince-read')
      if (b) b.click()
      return true
    })()`)
    await wait(1500)

    // --- and scrolling does not shake it off, or shove the list about -----
    /*
     * A channel somebody cannot see the top of, which is the case the bar
     * exists for: enough missed that the line is off screen.
     *
     * What this pins is that the bar survives being scrolled through - up to
     * where the missed messages start and back down again - and that the list
     * does not jump while that happens. The bar takes its height from the
     * message list, so anything that made it come and go mid-scroll would
     * move every message under the reader's eyes.
     *
     * Not that reaching the end clears it. The message list means to do that,
     * one line further down the same handler - and measured, it does not:
     * the clear is guarded by "more than a second since the channel opened",
     * and at every scroll that reads as 22-346ms, so it never fires. That
     * guard, the ref behind it and the clear are all older than this bar and
     * belong to the line in the list, which has never cleared that way
     * either. Asserting the intent here would be asserting a thing the app
     * does not do; Mark as read is the way out, and it is tested above.
     */
    await js(openChannel(1))
    await wait(900)
    const many = await sayManyAs(js, friend.token, 30)
    check('a channel full of missed messages can be made',
      many.sent === 30, many)
    await wait(1200)
    await js(openChannel(0))
    await wait(1800)

    /* Scrollable, or nothing below is a scroll and it all passes limply. */
    const room = await js(`(() => {
      const s = document.querySelector('.stream')
      return { over: Math.round(s.scrollHeight - s.clientHeight), bar: !!${BAR} }
    })()`)
    check('the conversation is long enough to scroll', room.over > 200, room)
    check('and the bar is up before any of this', room.bar === true, room)

    /* Up to where the line is, then back down - a scroll somebody made,
       rather than the one the app does putting the list where it belongs. */
    await js(`document.querySelector('.stream').scrollTop = 0`)
    await wait(700)
    const midway = await js(`(() => ({ bar: !!${BAR} }))()`)
    check('and it survives being scrolled away from', midway.bar === true, midway)

    await js(`(() => {
      const s = document.querySelector('.stream')
      s.scrollTop = s.scrollHeight
    })()`)
    await wait(900)

    const ended = await js(`(() => {
      const s = document.querySelector('.stream')
      return {
        barGone: !${BAR},
        fromEnd: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight),
      }
    })()`)
    console.log('      scrolled: ' + JSON.stringify({ room, ended }))
    check('and it is still there after scrolling back to the end',
      ended.barGone === false, ended)
    check('and the end is still the end afterwards', ended.fromEnd <= 8, ended)

    // --- and it fits a narrow window --------------------------------------
    /*
     * The strip carries a sentence and a button on one row. On a phone there
     * is not much row, and the sentence is the part that can give way - so it
     * is the one that must not push the button off the edge.
     */
    await js(openChannel(1))
    await wait(700)
    const said3 = await sayAs(js, friend.token, 'and one more')
    check('a third one can be missed', said3.ok === true, said3.why ?? said3)
    await wait(900)
    win.setContentSize(420, 820)
    await wait(700)
    await js(openChannel(0))
    await wait(1800)

    const narrow = await js(`(() => {
      const bar = ${BAR}
      if (!bar) return { there: false }
      const b = bar.getBoundingClientRect()
      const read = bar.querySelector('.newsince-read').getBoundingClientRect()
      const go = bar.querySelector('.newsince-go').getBoundingClientRect()
      return {
        there: true,
        insideOnTheRight: Math.round(read.right) <= Math.round(b.right) + 1,
        insideOnTheLeft: Math.round(read.left) >= Math.round(b.left),
        /* Beside it, not on top of it - two rounded strips can both be
           inside the bar and still overlap each other. */
        clearOfTheSentence: Math.round(read.left) >= Math.round(go.right) - 1,
        oneRow: Math.round(b.height) <= 40,
        text: (bar.textContent || '').replace(/\\s+/g, ' ').trim(),
      }
    })()`)
    console.log('      narrow:   ' + JSON.stringify(narrow))
    check('it is still there on a narrow window', narrow.there === true, narrow)
    check('and Mark as read has not been pushed off the edge',
      narrow.insideOnTheRight === true && narrow.insideOnTheLeft === true, narrow)
    check('and does not sit on top of the sentence',
      narrow.clearOfTheSentence === true, narrow)
    check('and it is still one row rather than two',
      narrow.oneRow === true, narrow)
  },
}
