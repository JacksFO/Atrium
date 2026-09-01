/**
 * The top of a channel is marked even once somebody has spoken in it.
 *
 * Reported: "in the first chat in my server and my friends server the 'this is
 * the start' part is not shown but any other channels that are made have it."
 *
 * Which was never about the first channel. The heading appeared only when
 * there were no messages at all, so it vanished the instant anybody posted -
 * and the channels that still had it were simply the ones nobody had used yet.
 * #general is the one channel guaranteed to have been used, in every server,
 * which is why it looked like a rule about the first one.
 *
 * The check that matters is the precondition. "The heading is on screen" is
 * true of an empty channel for the old reason as well as the new one, so a
 * spec that forgets to prove messages actually arrived would have passed
 * against the bug it exists to catch.
 */
const { signIn, sayAs } = require('../lib.cjs')

module.exports = {
  name: 'channel-start',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)

    /* Empty to begin with, which is the case that always worked. */
    const empty = await js(`(() => ({
      intro: !!document.querySelector('.intro'),
      messages: document.querySelectorAll('.msg').length,
    }))()`)
    check('an untouched channel says it is the beginning', empty.intro === true, empty)
    check('and there is genuinely nothing in it yet', empty.messages === 0, empty)

    /* Now somebody speaks, the way the friend in the report had. */
    const said = await sayAs(js, setup.friends.baileyyy.token, 'hello')
    check('a friend can say something', said.ok === true, said)

    await win.loadURL(base + '/')
    await until('the message', `document.querySelectorAll('.msg').length > 0`, 15000)
    await wait(1200)

    const after = await js(`(() => {
      const intro = document.querySelector('.intro')
      const msgs = [...document.querySelectorAll('.stream .msg')]
      const first = msgs[0]
      return {
        messages: msgs.length,
        intro: !!intro,
        heading: intro ? (intro.querySelector('h2') || {}).textContent : null,
        /* Above the oldest message, not merely somewhere on the page. */
        aboveTheFirst: !!(intro && first
          && (intro.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)),
      }
    })()`)
    console.log('      ' + JSON.stringify(after))

    /*
     * This one first and on its own. Everything below is true of an empty
     * channel too, so without it the whole spec passes against the bug.
     */
    check('the channel really does have a message in it now', after.messages > 0, after)
    check('the beginning is still marked', after.intro === true, after)
    check('and it sits above the oldest message', after.aboveTheFirst === true, after)
    check('and names the channel', /Welcome to #/.test(after.heading || ''), after.heading)
    /*
     * And a conversation is not a channel. Showing this above real history
     * rather than only in an empty room turned "Welcome to #baileyyy" from
     * something nobody ever saw into something seen every time a DM is
     * opened - so it has to name a person, with an @, like the header does.
     */
    await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
    await until('the conversation list', `document.querySelectorAll('.chan').length > 0`, 12000)
    await js(`(() => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /baileyyy/i.test(r.textContent))
      if (row) row.click()
      return 1 })()`)
    await wait(1500)

    const dm = await js(`(() => {
      const intro = document.querySelector('.intro')
      if (!intro) return { intro: false }
      return {
        intro: true,
        glyph: (intro.querySelector('.hg') || {}).textContent,
        heading: (intro.querySelector('h2') || {}).textContent,
        body: (intro.querySelector('p') || {}).textContent,
      }
    })()`)
    console.log('      ' + JSON.stringify(dm))
    check('a conversation marks its beginning too', dm.intro === true, dm)
    /* The person's own picture where a channel has a hash - which says
       whose conversation this is rather than that it is one. What matters
       is that it is not being introduced as a channel. */
    check('with their picture rather than a hash', dm.glyph !== '#', dm)
    check('and names the person, not a channel',
      /baileyyy/i.test(dm.heading || '') && !/#/.test(dm.heading || ''), dm.heading)
    check('and calls it a conversation', /conversation/.test(dm.body || ''), dm.body)
  },
}
