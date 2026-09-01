/**
 * How long the channel list takes to appear after switching server.
 *
 * Reported from real use: reorder the channels in one server, look at
 * another, and its channels are missing for about five seconds. Everything
 * needed to draw them is already in the client - the gateway sends every
 * channel this account can reach, and switching server is a filter over what
 * is already there - so five seconds is not a fetch. Something is waiting.
 *
 * Measured rather than reasoned about: the number is the whole point, and
 * "it feels slow" and "it is blank" are different faults with different
 * causes. Timed with setTimeout and not requestAnimationFrame, which barely
 * fires in a window that is not drawing and once reported forty-five seconds
 * for something that took eight milliseconds.
 */
const { signIn } = require('../lib.cjs')

const SWITCH_AND_TIME = (i) => `(async () => {
  const tick = () => new Promise((r) => setTimeout(r, 16))
  const pips = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]
  if (!pips[${i}]) return { ok: false, why: 'no server at ' + ${i} }

  const before = document.querySelectorAll('.chan').length
  const started = performance.now()
  pips[${i}].click()

  /* How long until anything is listed at all. */
  let blankFor = null
  let sawBlank = false
  for (let n = 0; n < 600; n++) {
    const count = document.querySelectorAll('.chan').length
    if (count === 0) sawBlank = true
    if (count > 0 && (sawBlank || n > 2)) { blankFor = performance.now() - started; break }
    await tick()
  }
  return {
    ok: true,
    before,
    after: document.querySelectorAll('.chan').length,
    /*
     * Named, not counted. A count greater than zero was the first version of
     * this and it passed while one whole group was empty - the fault it was
     * written to find had a full Voice group above an empty Text one, which
     * counts as "some channels" and is not.
     */
    names: [...document.querySelectorAll('.chan')].map((n) => n.textContent.trim()),
    /*
     * A heading and the rows under it.
     *
     * The heading is a sibling of its channels rather than a box around
     * them, so "how many are in this group" is "how many rows follow it
     * before the next heading" - counting inside the heading answered nought
     * every time, which would have called an empty group a full one.
     */
    groups: [...document.querySelectorAll('.sidepane .sect')].map((g) => {
      let n = 0
      for (let e = g.nextElementSibling; e; e = e.nextElementSibling) {
        if (e.classList.contains('sect')) break
        /* A voice room is a card rather than a row, and is still a channel
           in its group - counting only rows called an occupied Voice
           heading empty. */
        n += (e.classList.contains('chan') || e.classList.contains('vcard'))
          ? 1 : e.querySelectorAll('.chan, .vcard').length
      }
      return { name: (g.textContent || '').trim(), channels: n }
    }),
    sawBlank,
    ms: blankFor === null ? -1 : Math.round(blankFor),
  } })()`

const REORDER = `(() => {
  const wraps = [...document.querySelectorAll('.chan[draggable="true"], .sect[draggable="true"]')]
  if (wraps.length < 2) return { ok: false, why: 'not enough channels to reorder' }
  const dt = new DataTransfer()
  const fire = (el, type) => el.dispatchEvent(
    new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  fire(wraps[0], 'dragstart')
  fire(wraps[1], 'dragover')
  fire(wraps[1], 'drop')
  fire(wraps[0], 'dragend')
  return { ok: true } })()`

module.exports = {
  name: 'zz-switch-speed',
  width: 1280,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    const token = setup.me?.token ?? ''
    await js(`(async () => {
      const r = await (await fetch('/api/spaces', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ${JSON.stringify(token)} },
        body: JSON.stringify({ name: 'Other' }) })).json()
      return { ok: !!r.space } })()`)

    await win.loadURL(base + '/')
    await until('both servers', `document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)').length >= 2`, 20000)
    await wait(2500)

    console.log('  --- switching, with nothing changed ---')

    const cold = await js(SWITCH_AND_TIME(1))
    console.log('      to the second: ' + JSON.stringify(cold))
    check('the second server lists its channels', cold.after > 0, cold)

    await wait(1500)
    const back = await js(SWITCH_AND_TIME(0))
    console.log('      back to the first: ' + JSON.stringify(back))
    check('and the first still lists its own', back.after > 0, back)

    console.log('  --- and again, straight after reordering ---')

    /*
     * The reported sequence exactly: rearrange the channels here, then look
     * at the other server. Everything needed to draw it is already loaded, so
     * a wait here is the interface holding something back rather than the
     * network being slow.
     */
    const moved = await js(REORDER)
    check('the channels can be reordered', moved.ok === true, moved)
    await wait(1200)

    const after = await js(SWITCH_AND_TIME(1))
    console.log('      after a reorder: ' + JSON.stringify(after))
    check('the other server still lists its channels', after.after > 0, after)
    /*
     * And no group left standing with nothing under it. That is the shape the
     * reported fault had: Voice full, Text empty, because only the text
     * channels had been dragged in the other server.
     */
    const empties = (after.groups || []).filter((g) => g.channels === 0).map((g) => g.name)
    check('and no heading is left empty by the reorder', empties.length === 0,
      { groups: after.groups })
    /*
     * A number, not a feeling. Anything past a couple of hundred milliseconds
     * on a click somebody made deliberately reads as the app having lost the
     * list rather than as it being busy.
     */
    check('and does it without a visible gap', after.ms >= 0 && after.ms < 400,
      { ms: after.ms, sawBlank: after.sawBlank })
    check('the list is never empty in between', after.sawBlank === false, after)
  },
}
