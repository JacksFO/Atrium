/**
 * A notice about the app must not move the app.
 *
 * The strip these live in used to take height of its own, so the reload bar,
 * the offer of the desktop build and anything that went wrong all pushed the
 * whole app down by however tall they were and pulled it back up when they
 * went - reported as the panels jumping about.
 *
 * Measured rather than reasoned about: where the panels start with a notice
 * on screen and without one, and whether the notice is the thing under the
 * pointer where it is drawn. A bar that overlays and cannot be pressed is a
 * different bug wearing the same fix.
 */
const { signIn } = require('../lib.cjs')
module.exports = {
  name: 'notice-overlays', width: 1400, height: 900,
  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('set up', setup.ok === true, setup.why)
    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    const before = await js(`Math.round(document.querySelector('.sidepane').getBoundingClientRect().top)`)
    /* A notice, put in the way the app puts one there. */
    await js(`(() => {
      const bars = document.querySelector('.bars')
      const n = document.createElement('div')
      n.className = 'updbar'; n.style.height = '56px'; n.id = 'probe'
      n.textContent = 'a notice'
      bars.appendChild(n)
      return 1 })()`)
    await wait(400)
    const after = await js(`(() => {
      const n = document.getElementById('probe')
      const r = n.getBoundingClientRect()
      const side = document.querySelector('.sidepane').getBoundingClientRect()
      return {
        panelTop: Math.round(side.top),
        noticeTop: Math.round(r.top), noticeH: Math.round(r.height),
        /* Drawn over the panel rather than beside it. */
        overlaps: r.bottom > side.top,
        onTop: (() => {
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return !!(at && (at === n || n.contains(at)))
        })(),
      } })()`)
    console.log('      before: ' + before + '  after: ' + JSON.stringify(after))
    check('the panels do not move when a notice appears', after.panelTop === before,
      { before, after: after.panelTop })
    check('and the notice is drawn over them', after.overlaps === true, after)
    check('and it is the thing you touch there', after.onTop === true, after)
  },
}
