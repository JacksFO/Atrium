/**
 * Nothing important sits where the screen is not rectangular.
 *
 * Reported from a phone, saved to the home screen: "settings cogwheel is
 * fucked and bottom is a bit weird cause of the curved edges on phone", "also
 * could use the top more when it's saved to homescreen as a webapp", and
 * "phone curve is more aggressive than on the screenshot, but the text there
 * almost touches the edges".
 *
 * All of it came from one omission. env(safe-area-inset-*) is how a page finds
 * out where the notch, the rounded corners and the home indicator are, and it
 * reports zero until the viewport says viewport-fit=cover - which this did not
 * say. So the layout had no way of knowing the screen was not a rectangle, and
 * put the bar with the settings cog flush into the bottom corner.
 *
 * A desktop browser has no notch and never will, so the insets are stood in
 * for: the layout reads --safe-* rather than env() directly, and this hands it
 * an iPhone's numbers. That is a test of the rules, not of Safari - what it
 * cannot prove is that iOS reports these values, only that the layout does the
 * right thing when something does.
 */
const { signIn } = require('../lib.cjs')

/* An iPhone in portrait: a tall notch and the home indicator, sides square. */
const PORTRAIT = { t: 59, r: 0, b: 34, l: 0 }
/* And on its side, where the corners take the ends instead. */
const LANDSCAPE = { t: 0, r: 48, b: 21, l: 48 }

const pretend = (i) => `(() => {
  const r = document.documentElement.style
  r.setProperty('--safe-t', '${i.t}px')
  r.setProperty('--safe-r', '${i.r}px')
  r.setProperty('--safe-b', '${i.b}px')
  r.setProperty('--safe-l', '${i.l}px')
  return 1 })()`

const MEASURE = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom),
             left: Math.round(r.left), right: Math.round(r.right) }
  }
  return {
    height: window.innerHeight,
    width: window.innerWidth,
    topbarShown: !!document.querySelector('.topbar')
      && getComputedStyle(document.querySelector('.topbar')).display !== 'none',
    head: box('.chatpane .chd'),
    headName: box('.chatpane .chd .tt'),
    hint: box('.mebar'),
    composer: box('.cmp'),
    self: box('.mebar'),
    app: box('.shell'),
    standalone: window.matchMedia('(display-mode: standalone)').matches,
    spaceName: box('.sidepane .nm, .sidepane .chd .tt'),
    cog: box('.mebar .icb'),
    sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
  }
})()`

module.exports = {
  name: 'phone-safe-area',
  width: 390,
  height: 844,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1500)

    /* Nothing pretended yet: a rectangular screen must be untouched by all
       of this, or every desktop and Android user pays for an iPhone's notch. */
    const square = await js(MEASURE)
    console.log('      square screen: ' + JSON.stringify(square))
    /*
     * This client sets the app on a small margin, so the header starts a
     * few pixels down rather than at pixel zero - a deliberate look, and
     * not what this spec is about. What it is about is that the margin
     * does not GROW once there is a notch, which is checked below against
     * this measurement. So all that is needed here is a header near the
     * top rather than pushed down the screen by a band of nothing.
     */
    check('on a square screen the header starts at the top',
      square.head.top >= 0 && square.head.top < 20, square.head)
    check('and the strip that duplicated the header is gone on a phone',
      square.topbarShown === false, square)

    // ---- portrait, with a notch and a home indicator ----
    await js(pretend(PORTRAIT))
    await wait(500)
    const tall = await js(MEASURE)
    console.log('      with a notch:  ' + JSON.stringify(tall))

    /*
     * The top is used rather than avoided: the header's own background still
     * begins at the very top of the screen, and only its text is pushed below
     * the notch. A band of nothing above the app was the complaint.
     */
    check('the header still reaches the top of the screen',
      tall.head.top - PORTRAIT.t === square.head.top,
      { withNotch: tall.head.top, without: square.head.top, notch: PORTRAIT.t })
    check('but its name sits below the notch',
      tall.headName.top >= PORTRAIT.t, { name: tall.headName, notch: PORTRAIT.t })

    /* And the bottom, which is where the cog was. */
    check('the lowest text clears the home indicator',
      tall.hint.bottom <= tall.height - PORTRAIT.b,
      { lowest: tall.hint.bottom, clearOf: tall.height - PORTRAIT.b })
    check('and so does the message box',
      tall.composer.bottom <= tall.height - PORTRAIT.b,
      { composer: tall.composer.bottom, clearOf: tall.height - PORTRAIT.b })
    check('nothing is pushed off the side', tall.sideways === false, tall)

    /*
     * And it still reaches the bottom.
     *
     * The first version of the insets left a band of dead space down there:
     * viewport-fit=cover moved the page up to the physical top of the screen
     * and a standalone window then reported 100dvh as the screen minus that
     * inset, so the app stopped one status bar short.
     *
     * What this can check is the general property - that the app fills the
     * window whatever the insets are. What it cannot check is the case that
     * actually broke, because display-mode here is "${tall.standalone ? 'standalone' : 'browser'}"
     * and the rule for it only applies to a home-screen app. That one needs a
     * phone.
     */
    check('the app fills the window from top to bottom',
      tall.app.top === 0 && Math.abs(tall.app.bottom - tall.height) <= 1,
      { app: tall.app, window: tall.height, standalone: tall.standalone })

    // ---- and the drawer's bottom bar, where the cog actually lives ----
    await js(`(() => {
      const b = document.querySelector('.chatpane .chd button')
      if (b) b.click()
      return 1 })()`)
    await wait(900)
    const open = await js(MEASURE)
    console.log('      drawer open:   ' + JSON.stringify(open))
    if (open.cog) {
      check('the settings cog clears the home indicator',
        open.cog.bottom <= open.height - PORTRAIT.b,
        { cog: open.cog.bottom, clearOf: open.height - PORTRAIT.b })
      check('and is not in the rounded corner',
        open.cog.right <= open.width - PORTRAIT.r,
        { cog: open.cog.right, clearOf: open.width - PORTRAIT.r })
      /*
       * The drawer's own header, asked separately. It takes its inset from a
       * different rule to the chat's, and the chat's turned out to be undone
       * by a padding shorthand further down the same block - so "the other one
       * is written the same way" is not evidence about this one.
       */
      check('the server name sits below the notch too',
        open.spaceName.top >= PORTRAIT.t,
        { name: open.spaceName, notch: PORTRAIT.t })
    } else {
      check('the drawer opens so the cog can be measured', false, open)
    }

    // ---- sideways, where the corners take the ends ----
    await js(pretend(LANDSCAPE))
    await wait(500)
    const wide = await js(MEASURE)
    console.log('      on its side:   ' + JSON.stringify(wide))
    check('the message box clears the left corner',
      wide.composer.left >= LANDSCAPE.l,
      { composer: wide.composer.left, corner: LANDSCAPE.l })
    check('and the right one',
      wide.composer.right <= wide.width - LANDSCAPE.r,
      { composer: wide.composer.right, corner: wide.width - LANDSCAPE.r })
  },
}
