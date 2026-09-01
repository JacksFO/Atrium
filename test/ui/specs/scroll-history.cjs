/**
 * Scrolling up reaches what was said before.
 *
 * Reported as messages from a few days ago no longer being in a conversation.
 * They were: on the disk, undeleted, served by a route that has paginated
 * since it was written. The app never asked for them.
 *
 * The scroll handler was built with an empty dependency list, which does not
 * mean "nothing this reads changes" - it means the function is the one made
 * on the very first render and keeps every value from that moment for ever.
 * On the first render no channel is open, so the loadOlder it captured
 * returned at `if (!active)` every single time. Anything past the first
 * sixty messages was unreachable.
 *
 * Sixty is the page size, so this needs more than sixty messages to show
 * anything at all - which is why it was never noticed in a test.
 */
const { signIn } = require('../lib.cjs')

const PAGE = 60
const TOTAL = 150

module.exports = {
  name: 'scroll-history',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    /*
     * Enough to need three pages, sent down one socket rather than one each -
     * a hundred and fifty round trips would take longer than the spec.
     */
    const filled = await js(`(async () => {
      return await new Promise((resolve) => {
        const s = new WebSocket('ws://' + location.host + '/gateway')
        s.onopen = () => s.send(JSON.stringify({
          t: 'hello', token: localStorage.getItem('atrium.token') }))
        s.onmessage = (e) => {
          const m = JSON.parse(e.data)
          if (m.t === 'ping') return s.send(JSON.stringify({ t: 'pong' }))
          if (m.t !== 'ready') return
          const ch = (m.channels || []).find((c) => c.kind === 'text')
          if (!ch) { s.close(); return resolve({ ok: false, why: 'no text channel' }) }
          for (let i = 1; i <= ${TOTAL}; i++) {
            s.send(JSON.stringify({ t: 'send', channelId: ch.id,
              body: 'message number ' + i,
              nonce: 'fill-' + i + '-' + Math.random().toString(36).slice(2) }))
          }
          setTimeout(() => { s.close(); resolve({ ok: true, channelId: ch.id }) }, 4000)
        }
        setTimeout(() => resolve({ ok: false, why: 'socket never became ready' }), 12000)
      }) })()`)
    check('a conversation with real history can be made', filled.ok === true, filled)

    // Asserted on the server, so a display fault below cannot be mistaken for
    // the messages never having existed.
    const stored = await js(`(async () => {
      const t = localStorage.getItem('atrium.token')
      const r = await (await fetch('/api/channels/${'${filled.channelId}'}/messages',
        { headers: { authorization: 'Bearer ' + t } })).json()
      return (r.messages || []).length })()`.replace('${filled.channelId}', filled.channelId))
    check('the server hands back a full page', stored >= PAGE, stored)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(2500)

    const count = `document.querySelectorAll('.stream .msg').length`
    const first = await js(`(() => ({
      shown: ${count},
      top: (document.querySelector('.stream .mbody') || {}).textContent || '',
      scrollTop: document.querySelector('.stream').scrollTop,
    }))()`)
    console.log('      on opening: ' + JSON.stringify(first))
    check('it opens with a page of messages, not all of them',
      first.shown > 0 && first.shown < TOTAL, first.shown)

    /*
     * The oldest message is the one that was missing. Number one is at the
     * very top of the conversation, three pages up.
     */
    const hasOldest = () => js(`(() => [...document.querySelectorAll('.stream .mbody')]
      .some((n) => /message number 1\\b/.test(n.textContent)))()`)
    check('and the very first message is not among them',
      (await hasOldest()) === false)

    // --- scroll up, repeatedly, the way somebody reading back would --------
    /*
     * Scrolled to the top, and told so.
     *
     * This drove a real mouse wheel for a while, which is the truest
     * simulation and turned out to be the least reliable thing in the suite:
     * sendInputEvent goes to the focused window, Windows will not always
     * grant focus to a background one, and the spec then reported the app
     * broken three separate times when it was not. Focusing first fixed it
     * once and not again.
     *
     * So the position is set, and the event that a change of position would
     * have raised is raised. Both halves are honest: the container really is
     * at the top, which is the state the handler reads, and scroll does not
     * bubble so React listens for it on the element itself. What is being
     * tested is whether reaching the top fetches the page before - not
     * whether Chromium can scroll, which is not ours to prove.
     *
     * Nudged away from the top first, because setting a position it already
     * holds changes nothing and raises nothing.
     */
    const toTop = async () => {
      await js(`(() => {
        const el = document.querySelector('.stream')
        if (!el) return 0
        if (el.scrollTop === 0) el.scrollTop = 120
        el.scrollTop = 0
        el.dispatchEvent(new Event('scroll'))
        return el.scrollTop })()`)
    }

    for (let attempt = 0; attempt < 6 && !(await hasOldest()); attempt++) {
      const had = await js(`(() => document.querySelectorAll('.stream .mbody').length)()`)
      const tall = await js(`(() => document.querySelector('.stream').scrollHeight)()`)
      await toTop()
      /*
       * Waited for rather than slept through. A page arriving is a thing that
       * can be watched for, and a fixed pause is how a spec comes to depend
       * on how busy the machine is.
       */
      const grew = await until('a page of older messages',
        `document.querySelectorAll('.stream .mbody').length > ${had}`, 5000)
      const now = await js(`(() => ({
        msgs: document.querySelectorAll('.stream .mbody').length,
        height: document.querySelector('.stream').scrollHeight }))()`)
      console.log(`      up ${attempt}: ${had} messages in ${tall}px -> ${now.msgs} in ${now.height}px`)
      /*
       * The evidence, either way. Without the fix this line reads the same
       * numbers eight times over: the height never changes, because nothing
       * is ever fetched.
       */
      if (!grew) break
    }

    const after = await js(`(() => ({
      shown: ${count},
      oldest: [...document.querySelectorAll('.stream .mbody')]
        .map((n) => n.textContent).find((t) => /message number \\d+/.test(t)) || '',
    }))()`)
    console.log('      after scrolling up: ' + JSON.stringify(after))
    check('scrolling up loads what came before', after.shown > first.shown,
      { before: first.shown, after: after.shown })
    check('and reaches the very first thing said', (await hasOldest()) === true, after.oldest)
  },
}
