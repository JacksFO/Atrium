/**
 * How long clicking a mention actually takes, and what it costs.
 *
 * Reported from real use: opening somebody's profile from an @ in chat is
 * laggy, and the member column on the right sometimes is too. Both are
 * measured here rather than reasoned about - the whole point is to find out
 * which part is slow before changing anything.
 *
 * Three numbers matter: how long the click takes to produce a card, how many
 * message rows exist while it happens, and whether the work scales with the
 * conversation. A card that costs the same with ten messages and with four
 * hundred is a card that is slow on its own; one that grows with the messages
 * is the message list being rebuilt underneath it.
 */
const { signIn, sayAs } = require('../lib.cjs')

/*
 * Polled with setTimeout, never requestAnimationFrame.
 *
 * rAF barely fires in an Electron window that is not drawing, so a first
 * attempt at this reported forty-five seconds to open a card - the frames
 * were the slow part, not the app. Measuring the wrong clock is worse than
 * not measuring.
 *
 * `blocked` is the honest number for "did it feel laggy": how long the main
 * thread was busy and unable to answer a zero-delay timer.
 */
const CLICK_MENTION = `(async () => {
  const pill = [...document.querySelectorAll('button.mention')].pop()
  if (!pill) return { ok: false, why: 'no mention on screen' }
  const tick = () => new Promise((r) => setTimeout(r, 0))

  const before = performance.now()
  pill.click()
  const sync = Math.round(performance.now() - before)

  let waited = 0
  for (let i = 0; i < 600; i++) {
    if (document.querySelector('.pcard')) break
    const t = performance.now()
    await tick()
    waited += performance.now() - t
  }
  return document.querySelector('.pcard')
    ? { ok: true, sync, ms: Math.round(performance.now() - before), blocked: Math.round(waited) }
    : { ok: false, why: 'the card never appeared' }
})()`

const CLOSE = `(() => {
  const shut = [...document.querySelectorAll('.pcard button')]
    .find((b) => /close/i.test(b.textContent || b.title || ''))
  if (shut) shut.click(); else document.body.click()
  return 1 })()`

const COUNTS = `(() => ({
  messages: document.querySelectorAll('.msg').length,
  mentions: document.querySelectorAll('button.mention').length,
  members: document.querySelectorAll('.mempane .mem').length,
}))()`

module.exports = {
  name: 'zz-profile-cost',
  width: 1280,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)
    const mate = setup.friends?.Baileyyy

    /* A handful of messages first, so there is a cheap case to compare with. */
    for (let i = 0; i < 8; i++) await sayAs(js, mate.token, `early ${i} @JacksFO`)

    await win.loadURL(base + '/')
    await until('the messages', `document.querySelectorAll('button.mention').length > 0`, 15000)
    await wait(1500)

    const small = await js(COUNTS)
    const firstClick = await js(CLICK_MENTION)
    console.log('      few messages:  ' + JSON.stringify({ ...small, ...firstClick }))
    check('the card opens at all', firstClick.ok === true, firstClick)
    await js(CLOSE)
    await wait(400)

    /* Now a real conversation's worth. */
    for (let i = 0; i < 60; i++) await sayAs(js, mate.token, `filler ${i} @JacksFO`)

    await win.loadURL(base + '/')
    await until('the longer history', `document.querySelectorAll('.msg').length > 40`, 20000)
    await wait(2500)

    const big = await js(COUNTS)
    const timings = []
    for (let i = 0; i < 3; i++) {
      const t = await js(CLICK_MENTION)
      timings.push(t.ms ?? -1)
      await js(CLOSE)
      await wait(500)
    }
    console.log('      many messages: ' + JSON.stringify({ ...big, timings }))

    const best = Math.min(...timings.filter((t) => t >= 0))
    check('the card still opens', timings.every((t) => t >= 0), timings)
    /*
     * A number rather than a feeling. Anything past a couple of hundred
     * milliseconds reads as a stall on a click somebody made deliberately.
     */
    check('and opens without a visible stall', best < 200, { best, timings, messages: big.messages })
    check('the cost did not grow with the conversation',
      best < Math.max(120, (firstClick.ms ?? 0) * 4),
      { few: firstClick.ms, many: best, messages: `${small.messages} -> ${big.messages}` })
  },
}
