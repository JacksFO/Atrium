/**
 * Runs one spec in a real window.
 *
 * Launched once per spec by run.mjs, which passes the spec's path and the
 * server to talk to. There is no claim code any more - the harness signs its
 * first account up like anybody else.
 */
const { app, BrowserWindow } = require('electron')
const { pageOf, results } = require('./lib.cjs')

const SPEC = process.env.UI_SPEC
const BASE = process.env.UI_BASE

/*
 * Windows must not decide the window is hidden.
 *
 * The window is put off the side of the screen so a run does not take over
 * the machine, and Windows then reports it as occluded - at which point
 * Chromium stops compositing it altogether. Everything that needs a frame
 * stops with it: a CSS transition reports itself as running with a current
 * time of zero, for ever. The visible symptom is a drawer that never slides
 * in, so a spec that opens the channel list on a phone finds it still off
 * the screen and reports that the drawer does not open - a bug that is not
 * in the app at all.
 *
 * Occlusion detection is what to turn off rather than the throttling around
 * it: the window genuinely is not covered by anything, Windows simply
 * cannot see it. Everything else about the run stays as it was.
 */
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

/**
 * Both halves of "is anybody looking at this", answered from one switch.
 *
 * The app asks two questions - is the page visible, and does it have the
 * keyboard - and in this harness neither can be arranged. The window is
 * unfocusable so a run cannot take the keyboard off whoever is at the
 * machine, and occlusion detection is off so that animations run at all,
 * which also means hiding the window no longer makes the page report itself
 * hidden. Left alone, every spec ran against a client that believed nobody
 * was looking, and everything that only happens while somebody is never
 * happened once.
 *
 * So both are answered from one flag, and the flag follows the window: a
 * spec calling win.hide() puts the app in the background exactly as it
 * expects, and showing it again brings it back.
 */
const WATCHING = `(() => {
  if (!window.__uiWatchingSet) {
    window.__uiWatching = true
    Object.defineProperty(document, 'hasFocus',
      { value: () => window.__uiWatching, configurable: true })
    Object.defineProperty(document, 'visibilityState',
      { get: () => (window.__uiWatching ? 'visible' : 'hidden'), configurable: true })
    window.__uiWatchingSet = true
  }
  return 1 })()`

/** Say the window went away, or came back, the way a page hears it. */
const SAY_WATCHING = (on) => `(() => {
  window.__uiWatching = ${on ? 'true' : 'false'}
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event(${on ? "'focus'" : "'blur'"}))
  return 1 })()`

app.on('window-all-closed', () => {})
// A spec that hangs must not hang the whole run.
const bomb = setTimeout(() => {
  console.log('      FAIL the spec timed out')
  process.exit(1)
}, 180000)

process.on('uncaughtException', (e) => {
  console.log('      FAIL ' + e.message)
  process.exit(1)
})

app.whenReady().then(async () => {
  const spec = require(SPEC)

  /*
   * show: true, and not by accident.
   *
   * Chromium throttles a hidden window, so CSS transitions never advance in
   * one: a drawer reports itself open while its transform still reads the
   * closed value. That produced a confident, entirely wrong bug report once.
   * These windows are visible and unthrottled so the layout is the real one.
   */
  const win = new BrowserWindow({
    show: true,
    /*
     * Shown, and not in front of whoever is at the machine.
     *
     * The window has to be a real, unthrottled, visible window - see above -
     * but it does not have to be on the desktop somebody is using. A suite
     * that opens thirty windows over what you are doing, each sitting there
     * for a minute, is one nobody runs.
     *
     * Off to the left rather than minimised or hidden: both of those are the
     * throttling this is avoiding. backgroundThrottling is already off, and
     * `focusable: false` keeps it from stealing the keyboard on the way past.
     *
     * ATRIUM_UI_ONSCREEN=1 puts it back where it can be watched, for when
     * a spec is being written and the point is to see what it does.
     */
    ...(process.env.ATRIUM_UI_ONSCREEN ? {} : { x: -4000, y: 0, focusable: false }),
    /*
     * The size of the page, not the size of the window around it.
     *
     * Without this the frame is included, so a spec asking for a 390px phone
     * got a 374px page - and every measurement in every phone spec was taken
     * against a viewport fifteen pixels narrower than the one it named.
     * Things reported as hanging off the right edge were partly this.
     */
    useContentSize: true,
    width: spec.width ?? 1400,
    height: spec.height ?? 900,
    webPreferences: {
      partition: 'persist:ui-' + spec.name.replace(/[^a-z0-9]/gi, ''),
      backgroundThrottling: false,
    },
  })

  /*
   * No animations in a test.
   *
   * The drawers slide for 220ms, and whether that transition ever finishes
   * turns out to depend on whether Chromium considers the window worth
   * rendering - which after several specs have run it sometimes does not. So
   * the suite spent the day reporting drawers at their closed position and I
   * spent it calling that contention.
   *
   * The app already has a reduced-motion setting, honoured by the same
   * stylesheet the drawers use, so this is the app's own switch rather than
   * something invented for the tests: transitions resolve immediately and
   * there is no moving thing left to race.
   */
  win.webContents.on('dom-ready', () => {
    void win.webContents.executeJavaScript(
      `document.documentElement.setAttribute('data-motion', 'reduced')`
    ).catch(() => {})
    /*
     * And the page believes it has the keyboard.
     *
     * The window is marked unfocusable so a run cannot take the keyboard off
     * whoever is using the machine, and it sits off the side of the screen -
     * so document.hasFocus() is false for the whole of every run, for
     * reasons that are entirely about this harness and nothing to do with
     * the app. The app asks that question to decide whether anybody is
     * looking, which is how it knows to stop animating pictures nobody can
     * see, so every spec ran against a client that believed it was in the
     * background and everything that only happens while somebody is watching
     * never happened once.
     *
     * Answered rather than arranged, because it cannot be arranged: focusing
     * the contents does not make an unfocusable window focused, and making
     * it focusable would take the keyboard off whoever is at the machine.
     *
     * Only this one question. The other half of "is anybody looking" is
     * visibilityState, which is real here and is what a spec uses to look
     * away - win.hide() genuinely hides the window - so a spec can still
     * put the app in the background and watch it stop.
     */
    win.webContents.focus()
    void win.webContents.executeJavaScript(WATCHING).catch(() => {})
  })

  /* The window going away and coming back, said to the page - it cannot
     hear it for itself here, for the reasons above. */
  win.on('hide', () => {
    void win.webContents.executeJavaScript(SAY_WATCHING(false)).catch(() => {})
  })
  win.on('show', () => {
    void win.webContents.executeJavaScript(SAY_WATCHING(true)).catch(() => {})
  })

  const page = pageOf(win)
  const r = results()

  try {
    await spec.run({ ...page, win, check: r.check, base: BASE })
  } catch (e) {
    console.log('      FAIL threw: ' + (e && e.message ? e.message : String(e)))
    clearTimeout(bomb)
    app.exit(1)
    return
  }

  clearTimeout(bomb)
  if (r.failures.length) {
    console.log(`      ${r.failures.length} failed`)
    app.exit(1)
  } else {
    app.exit(0)
  }
})
