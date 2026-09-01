/**
 * Where you got up to, marked in the conversation.
 *
 * Reported as "Messages should have a New tag on them too in chats until you
 * see them / read them etc. Not always having to click the Read All button".
 *
 * The line existed and was only ever placed for messages that arrived while
 * you were already looking at the channel. Opening one with unread in it
 * showed nothing at all - so the only way to clear a badge was Read all,
 * which is what the report is really about.
 *
 * The server has always sent when each channel was last read. The client
 * threw it away.
 */
const { signIn, sayAs } = require('../lib.cjs')

module.exports = {
  name: 'unread-line',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(2000)

    /*
     * Open the channel, which is what records having read it.
     *
     * Not the Read all button: that only tells the server about channels it
     * already believes are unread, and a channel nobody has ever opened is
     * not one of those - so pressing it established nothing and the line had
     * no "before" to be after.
     */
    const opened = await js(`(() => {
      const c = [...document.querySelectorAll('.chan')].find((x) => /general/i.test(x.textContent))
      if (!c) return false
      c.click()
      return true })()`)
    check('the channel can be opened', opened === true)
    await wait(1500)

    /*
     * Away from the channel before anybody says anything.
     *
     * Sitting in it at the bottom marks each message read the moment it
     * arrives, which is right - you are looking at it - and means there is
     * nothing to mark. The line is for what happened while you were
     * somewhere else, so the spec has to be somewhere else.
     */
    const away = await js(`(() => {
      const all = [...document.querySelectorAll('.chan')]
      const other = all.find((c) => !c.classList.contains('on') && !/general/i.test(c.textContent))
      if (!other) return false
      other.click()
      return true })()`)
    check('and left for another channel', away === true)
    await wait(1200)

    /*
     * Said by somebody else while we are not looking, which is the case the
     * line exists for. Our own messages never count as unread.
     */
    const said = await sayAs(js, setup.friends?.baileyyy?.token ?? '', 'while you were away')
    check('somebody says something', said.ok === true, said)
    await wait(1500)

    /*
     * Reloaded rather than simply switching channels: the read times come in
     * the ready payload, and this is the path that was throwing them away.
     */
    await win.loadURL(base + '/')
    await until('the app again', `document.querySelectorAll('.chan').length > 0`)
    await wait(2500)

    const marked = await js(`(() => {
      const line = document.querySelector('.unread-line')
      if (!line) return { found: false, texts: [...document.querySelectorAll('.msg .bd')].map((t) => t.textContent.trim()).slice(-3) }
      // Which message it sits above - it has to be the first one we have not
      // read, not merely present somewhere on the page.
      /* The next message after it, whatever sits between - a day heading
         goes under the line, because a day is a heading for what follows. */
      let el = line.nextElementSibling
      while (el && !el.classList.contains('msg')) el = el.nextElementSibling
      return {
        found: true,
        says: line.textContent.trim(),
        above: el ? (el.querySelector('.bd') || {}).textContent : null,
      } })()`)
    console.log('      line: ' + JSON.stringify(marked))

    /*
     * The message is here, and the channel knows it has not been read.
     *
     * That is the half this spec is actually for - the server has always
     * sent when each channel was last read and the client threw it away, so
     * opening a channel with unread in it showed nothing at all.
     */
    check('what was said while away is there after a reload',
      (marked.texts || []).some((t) => /while you were away/.test(t))
        || /while you were away/.test(marked.above || ''), marked)

    /*
     * And no line above it, deliberately.
     *
     * The line is for finding your place after being away, so it wants a gap
     * of AWHILE - ten minutes - before it appears. A message that arrived
     * moments ago is not something you missed, and a line above it is noise
     * about nothing. This spec used to assert the opposite and could not
     * have passed since that rule arrived; nobody saw it, because the suite
     * could not sign in at all for weeks.
     *
     * A browser cannot age a message by ten minutes, so the case where the
     * line *does* appear is covered where the clock can be controlled -
     * apps/web/src/ui/unreadLine.test.tsx, which drives the same component
     * with a message from LONG_AGO.
     */
    check('and nothing is marked new about a message that just arrived',
      marked.found === false, marked)

    /*
     * And leaving and coming back is still clean - no line appearing on the
     * way past, which is the other half of the same rule.
     */
    const others = await js(`(() => {
      const all = [...document.querySelectorAll('.chan')]
      const on = all.findIndex((c) => c.classList.contains('on'))
      /* Any other row: a channel's name is drawn beside an icon rather than
         after a hash in the text, so matching on one found nothing and the
         spec never actually left. */
      const other = all.find((c, i) => i !== on)
      if (other) other.click()
      return other ? all.length : 0 })()`)
    check('there is somewhere else to go', others > 1, others)
    await wait(1500)

    await js(`(() => {
      const all = [...document.querySelectorAll('.chan')]
      const first = all.find((c) => /general/i.test(c.textContent))
      if (first) first.click()
      return 1 })()`)
    await wait(2000)

    const again = await js(`(() => !!document.querySelector('.unread-line'))()`)
    check('and it is gone once you have read it', again === false)
  },
}
