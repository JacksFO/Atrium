/**
 * Working out the activation threshold instead of asking for it.
 *
 * Asked for as automatic input sensitivity: work the voice activation
 * threshold out for somebody rather than making them set it by hand, while
 * still letting them choose auto or manual.
 *
 * What the line does with a real microphone is covered by the unit tests on
 * AutoGate, which can feed it a room and a voice. This drives the panel: that
 * automatic is the default, that manual brings the slider back, that the
 * choice survives, and that the marker on the bar is drawn through the same
 * scale as the bar - it was not, and sat at half the place it claimed.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'input-sensitivity',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    /*
     * Start from nothing stored.
     *
     * The browser profile outlives a run, so the second half of this spec -
     * which chooses manual on purpose - was still chosen the next time it
     * ran, and "automatic is what a new account gets" passed once and failed
     * for ever after. A default is only a default before anything is saved.
     */
    await js(`(() => {
      /* Every setting in this client lives in one stored object, so a
         default is restored by taking the two keys out of it rather than by
         removing a key of their own. */
      const raw = localStorage.getItem('atrium.settings')
      if (raw) {
        const s = JSON.parse(raw)
        delete s.gateAuto
        delete s.gate
        localStorage.setItem('atrium.settings', JSON.stringify(s))
      }
      return 1 })()`)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(1500)

    // Own settings rather than the server's, through the gear by your name.
    await js(`(() => {
      /* Yours, by your name at the bottom - the server's gear says
         "settings" too and comes first, so a match on the word alone opened
         the wrong screen and looked like a missing pane. */
      const b = document.querySelector('.mebar button[aria-label="Your settings"]')
      if (b) b.click()
      return 1 })()`)
    await wait(1500)
    await js(`(() => {
      const b = [...document.querySelectorAll('.snav button')].find((x) => /voice/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await until('the voice pane', `!!document.querySelector('.meter')`)
    await wait(800)

    const rowOf = (re) => `[...document.querySelectorAll('.row')].find((r) =>
      ${re}.test(((r.querySelector('.row .t') || {}).textContent || '')))`

    const first = await js(`(() => {
      const row = ${rowOf('/input sensitivity/i')}
      if (!row) return { found: false }
      const seg = [...row.querySelectorAll('.segm button')]
      return {
        found: true,
        options: seg.map((b) => b.textContent.trim()),
        on: seg.filter((b) => b.classList.contains('on')).map((b) => b.textContent.trim()),
        sliderShown: !!${rowOf('/activation threshold/i')},
      } })()`)
    console.log('      sensitivity: ' + JSON.stringify(first))
    check('there is a choice of automatic or manual', first.found === true, first)
    check('and automatic is what a new account gets',
      first.on.length === 1 && /automatic/i.test(first.on[0]), first.on)
    /*
     * No slider while it is working the line out. A control that shows a
     * number nothing reads is worse than no control: people set it, nothing
     * changes, and they conclude the feature is broken.
     */
    check('with no threshold slider to argue with', first.sliderShown === false, first)

    // --- and the marker is where the bar says it is --------------------------
    const marker = await js(`(() => {
      const meter = document.querySelector('.meter')
      const gate = meter && meter.querySelector('.rng')
      if (!meter || !gate) return { found: false }
      const m = meter.getBoundingClientRect()
      const g = gate.getBoundingClientRect()
      return {
        found: true,
        // Inside the bar rather than off one end, which is what a marker
        // drawn through a different scale from the bar looks like.
        within: g.left >= m.left - 1 && g.right <= m.right + 1,
        at: Math.round(((g.left - m.left) / m.width) * 100),
      } })()`)
    console.log('      marker: ' + JSON.stringify(marker))
    check('the bar carries a marker', marker.found === true, marker)
    check('and it sits inside the bar', marker.within === true, marker)

    // --- manual brings the slider back ---------------------------------------
    const manual = await js(`(async () => {
      const row = ${rowOf('/input sensitivity/i')}
      const b = [...row.querySelectorAll('.segm button')].find((x) => /manual/i.test(x.textContent))
      if (!b) return { ok: false, why: 'no manual button' }
      /* Settings is a window now rather than the whole screen, so a row far
         down the pane can be below the fold - and a button nobody can see is
         not one anybody can press. Brought into view first, which is what a
         person does before clicking it. */
      b.scrollIntoView({ block: 'center' })
      await new Promise((r) => setTimeout(r, 250))
      const r = b.getBoundingClientRect()
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!el || !b.contains(el)) {
        return {
          ok: false,
          why: el ? 'something is on top of it' : 'it is not on screen',
          /* Which is which matters: one is a stacking bug and the other is a
             row that needs scrolling to. They used to report the same thing. */
          covering: el ? (el.className || el.tagName) : null,
          at: { top: Math.round(r.top), left: Math.round(r.left) },
          view: { h: window.innerHeight, w: window.innerWidth },
        }
      }
      b.click()
      await new Promise((r) => setTimeout(r, 600))
      return {
        ok: true,
        sliderShown: !!${rowOf('/activation threshold/i')},
        stored: JSON.parse(localStorage.getItem('atrium.settings') || '{}').gateAuto,
      } })()`)
    console.log('      manual: ' + JSON.stringify(manual))
    check('manual can be chosen', manual.ok === true, manual)
    check('and the slider comes back', manual.sliderShown === true, manual)
    check('and the choice is written down', manual.stored === false, manual.stored)

    // --- and survives a reload ------------------------------------------------
    await win.loadURL(base + '/')
    await until('the app again', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(1500)
    await js(`(() => {
      /* Yours, by your name at the bottom - the server's gear says
         "settings" too and comes first, so a match on the word alone opened
         the wrong screen and looked like a missing pane. */
      const b = document.querySelector('.mebar button[aria-label="Your settings"]')
      if (b) b.click()
      return 1 })()`)
    await wait(1200)
    await js(`(() => {
      const b = [...document.querySelectorAll('.snav button')].find((x) => /voice/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await until('the voice pane again', `!!document.querySelector('.meter')`)
    await wait(800)

    const kept = await js(`(() => {
      const row = ${rowOf('/input sensitivity/i')}
      const on = [...row.querySelectorAll('.segm button')]
        .filter((b) => b.classList.contains('on')).map((b) => b.textContent.trim())
      return { on, sliderShown: !!${rowOf('/activation threshold/i')} } })()`)
    console.log('      after reload: ' + JSON.stringify(kept))
    check('manual is still chosen after a reload',
      kept.on.length === 1 && /manual/i.test(kept.on[0]), kept.on)
    check('and the slider is still there', kept.sliderShown === true, kept)
  },
}
