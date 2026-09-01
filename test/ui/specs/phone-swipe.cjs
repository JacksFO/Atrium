/**
 * Opening the drawers with a thumb.
 *
 * Swipe right for the channel list, swipe left for the member list. The
 * unit tests cover the decision - was that a swipe or a scroll - and this
 * covers the half they cannot reach: that a real touch on a real page moves
 * the real panel, and that dragging down the message list still scrolls it
 * instead of throwing a drawer open.
 */
const { signIn } = require('../lib.cjs')

/** A touch, as a finger makes it: down, a few moves, up. */
/**
 * A drag across the screen, as pointer events.
 *
 * Touch events were what this fired, and the app does not listen for them -
 * nothing does any more. A finger on a real screen produces pointer events,
 * a mouse produces pointer events, and a pen produces pointer events; touch
 * events are the older, touch-only spelling that a browser sends alongside
 * them for pages written before pointers existed. So a spec firing only
 * those was asking a question no listener in the app was waiting for, and
 * reported that swiping does nothing.
 */
function swipe({ fromX, fromY, dx, dy = 0, steps = 6 }) {
  return `(() => {
    const target = document.elementFromPoint(${fromX}, ${fromY}) || document.body
    const fire = (type, x, y) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: y, screenX: x, screenY: y }))

    fire('pointerdown', ${fromX}, ${fromY})
    for (let i = 1; i <= ${steps}; i++) {
      fire('pointermove', ${fromX} + (${dx} * i / ${steps}), ${fromY} + (${dy} * i / ${steps}))
    }
    fire('pointerup', ${fromX} + ${dx}, ${fromY} + ${dy})
    return { on: target.className || target.tagName } })()`
}

const state = `(() => {
  const app = document.querySelector('.shell')
  /* Which drawer is out is one attribute with the name of it in, rather
     than a class per drawer. */
  const slid = app.getAttribute('data-slid') || ''
  return { nav: slid === 'nav', members: slid === 'members' } })()`

module.exports = {
  name: 'phone-swipe',
  width: 390,
  height: 844,

  async run({ js, until, wait, settled, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    check('the app loads', await until('the channel list', `document.querySelectorAll('.chan').length > 0`))
    await wait(1800)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1500)

    const shut = await js(state)
    check('both panels start closed', shut.nav === false && shut.members === false, shut)

    // ---- right, for the channel list ----
    await js(swipe({ fromX: 150, fromY: 420, dx: 140 }))
    await settled('.channels')
    await settled('.members')
    let now = await js(state)
    check('swiping right opens the channel list', now.nav === true, now)
    check('and not the member list too', now.members === false)

    // ---- left again, which should put it back ----
    await js(swipe({ fromX: 260, fromY: 420, dx: -140 }))
    await settled('.channels')
    await settled('.members')
    now = await js(state)
    check('swiping back closes it', now.nav === false, now)
    check('rather than opening the other one', now.members === false)

    // ---- left, for the member list ----
    await js(swipe({ fromX: 260, fromY: 420, dx: -140 }))
    await settled('.channels')
    await settled('.members')
    now = await js(state)
    check('swiping left opens the member list', now.members === true, now)

    const panel = await js(`(() => {
      const el = document.querySelector('.mempane')
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left), right: Math.round(r.right),
        w: Math.round(r.width), vw: window.innerWidth } })()`)
    check('and it is actually on screen',
      panel.w > 0 && panel.right <= panel.vw + 1 && panel.x < panel.vw, panel)

    await js(swipe({ fromX: 150, fromY: 420, dx: 140 }))
    await settled('.channels')
    await settled('.members')
    now = await js(state)
    check('swiping right closes it again', now.members === false, now)

    // ---- the one that must not happen ----
    await js(swipe({ fromX: 200, fromY: 300, dx: 70, dy: 320 }))
    await settled('.channels')
    await settled('.members')
    now = await js(state)
    check('dragging down the conversation opens nothing',
      now.nav === false && now.members === false, now)

    // A short flick is a tap that wandered, not a swipe.
    await js(swipe({ fromX: 200, fromY: 420, dx: 30 }))
    await settled('.channels')
    await settled('.members')
    now = await js(state)
    check('and neither does a short flick', now.nav === false && now.members === false, now)
  },
}
