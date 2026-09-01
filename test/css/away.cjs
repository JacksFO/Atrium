/**
 * Nothing moves in a window nobody is looking at.
 *
 * Reported with a GIF avatar: it carried on playing while the app sat on a
 * second monitor. That one is an <img> and needs React, but everything else
 * that moves is a CSS animation and stops from the stylesheet - and the rule
 * that stops it is one selector that either reaches everything or reaches
 * nothing, which is not a thing to take on trust.
 *
 * Driven rather than read: a paused animation and a running one have exactly
 * the same computed style, so what is asked here is the animation's own
 * playState, and then whether the transform actually stays put across a
 * frame. A rule that named the right property but missed the elements would
 * pass the first check and fail the second.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
const css = ['apps/web/src/app.css']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')

const tokens = `:root{--glass:#181c22;--glass-2:#1b2027;--glass-solid:#181c22;--blur:blur(8px);
  --line:#2b3138;--line-soft:#22262c;--raise:#20252c;--raise-2:#272d35;--text:#e7ecf2;
  --text-dim:#9aa6b2;--text-faint:#6b7683;--blue:#4b8cff;--cyan:#37d5e8;--blue-ink:#04121f;
  --red:#e5484d;--cyan-line:#2c8f9c;--edge-hi:none;--shadow-pop:none;--radius:12px;
  --radius-s:8px;--radius-l:16px;--font-display:sans-serif;--font-mono:monospace;--dim:#8b949e}
  body{margin:0;background:#111}`

/*
 * One of each kind of moving thing the app has: a scrolling track title, a
 * spinner, a shimmering name, the typing dots and the ring round a ringing
 * call. All of them, because the rule is meant to be blanket, and one that
 * only caught the thing it was written against is the failure worth catching.
 */
const page = `<!doctype html><meta charset="utf-8"><title>away</title>
<style>${tokens}\n${css}</style>
<div class="act-name marq-box" id="title">
  <span class="marq is-running" style="--marq-shift:400px;--marq-gap:44px;--marq-time:13s">
    <span class="marq-copy">A Very Long Track Title Indeed</span>
    <span class="marq-copy" aria-hidden="true">A Very Long Track Title Indeed</span>
  </span>
</div>
<div class="spin" id="spin"></div>
<span class="fx-shimmer" id="shimmer">Somebody</span>
<span class="dots"><i></i><i></i><i></i></span>
<span class="call-halo"><b>call</b></span>`

/** The x of a computed transform, which is the only part that moves here. */
const translateOf = (matrix) => Number(String(matrix).split(',')[4] ?? 0)

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: -4000, y: 0, focusable: false, useContentSize: true, width: 900, height: 600 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
  await new Promise((r) => setTimeout(r, 300))

  const m = await win.webContents.executeJavaScript(`(async () => {
    const moving = () => document.getAnimations().filter(
      (a) => a.effect && a.effect.target && a.effect.target.isConnected)
    const states = () => moving().map((a) => a.playState).sort()

    const marq = document.querySelector('#title .marq')
    // Wound to the middle of its travel, so a paused one has a transform
    // worth comparing rather than sitting at nothing.
    const scrolling = marq.getAnimations()[0]
    scrolling.currentTime = scrolling.effect.getTiming().duration * 0.5
    const shift = () => getComputedStyle(marq).transform

    /*
     * Whether anything can be seen to move in this window at all.
     *
     * An animation only advances while the compositor is drawing the window.
     * Run on its own this spec has the screen and everything moves; run as
     * one of fifteen, behind the others, nothing advances - and then "it
     * stopped when asked" is true of a window where nothing was moving in the
     * first place, which is a check that passes for the wrong reason.
     *
     * So it is established first, and the movement checks below only run when
     * the answer is yes. A run that cannot see movement says so rather than
     * quietly agreeing with itself.
     */
    const atStart = shift()
    await new Promise((r) => setTimeout(r, 250))
    const drawing = shift() !== atStart

    const before = { count: moving().length, states: states(), drawing }

    /*
     * Waited on a timer, never on an animation frame.
     *
     * requestAnimationFrame only fires for a window the compositor is
     * actually drawing. Run on its own this spec has the screen and it fires
     * fine; run as one of thirteen, behind the others, it never fires at all
     * and this file sat there for ten minutes holding up the suite. A timer
     * does not care whether anybody is looking.
     */
    // --- away -------------------------------------------------------------
    document.documentElement.dataset.watching = 'no'
    await new Promise((r) => setTimeout(r, 60))
    const away = { states: states(), at: shift() }
    await new Promise((r) => setTimeout(r, 250))
    const stillAway = { states: states(), at: shift() }

    // --- back -------------------------------------------------------------
    document.documentElement.dataset.watching = 'yes'
    await new Promise((r) => setTimeout(r, 60))
    const back = { states: states(), at: shift() }
    await new Promise((r) => setTimeout(r, 250))
    const laterBack = { at: shift() }

    return { before, away, stillAway, back, laterBack, drawing }
  })()`)
  console.log('  ' + JSON.stringify(m))

  check('there is more than one thing moving to begin with',
    m.before.count >= 3, m.before.count)
  check('and all of it is running', m.before.states.every((s) => s === 'running'), m.before.states)

  check('every one of them pauses when the window is not being looked at',
    m.away.states.length >= 3 && m.away.states.every((s) => s === 'paused'), m.away.states)
  check('they start again when it is', m.back.states.every((s) => s === 'running'), m.back.states)

  /* Where it was, not back to nothing. Not to the pixel - a frame or two
     passes between letting go and reading it - but nowhere near a restart,
     which from halfway through a 400px shift would be 200px away. */
  check('and carry on rather than jumping back to the start',
    Math.abs(translateOf(m.back.at) - translateOf(m.away.at)) < 5,
    { paused: m.away.at, resumed: m.back.at })

  /*
   * And what the pause is actually for, when this window is being drawn.
   *
   * playState is what the browser intends; these two are whether the pixels
   * followed. They can only be asked of a window the compositor is working
   * on, which is why the first thing measured is whether anything moves here
   * at all - a window behind fifteen others advances nothing, and asking
   * "did it stop" of a thing that was never going would answer yes for the
   * wrong reason.
   */
  if (m.drawing) {
    check('and they really do stop, not just say so',
      m.away.at === m.stillAway.at, { at: m.away.at, quarterOfASecondLater: m.stillAway.at })
    check('and are actually moving again',
      m.laterBack.at !== m.back.at, { at: m.back.at, quarterOfASecondLater: m.laterBack.at })
  } else {
    /*
     * Measured, not assumed: in a window the compositor is not drawing,
     * nothing advances at all - not the transform, not the animation's own
     * currentTime, not document.timeline.currentTime. Only playState is real,
     * and playState is what the stylesheet actually sets, so the checks above
     * are the substance and these two were only ever the belt to that braces.
     */
    console.log('  --   nothing is drawn in this window, so movement cannot be observed')
    console.log('       playState above is the real check; it is what the rule sets')
  }

  console.log('\n  ' + (bad === 0 ? 'a window nobody is looking at holds still' : bad + ' wrong'))
  win.destroy()
  app.exit(bad === 0 ? 0 : 1)
})
