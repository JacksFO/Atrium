/**
 * What the splash does with each kind of progress it is told about.
 *
 * The splash has three states by design: no bar, a bar at a percentage, and
 * a bar that moves without one - the last for a download whose total nobody
 * sent. The third had never once been reachable.
 *
 * The main process describes progress by running a call inside the splash,
 * and it used to build that call with JSON.stringify. JSON has no NaN: it
 * comes out as null, and null is this splash's word for "no bar at all". So
 * every "we are fetching something, size unknown" arrived as "nothing is
 * happening", while the text beside it went through perfectly - which is
 * what made it read as a deliberately plain screen rather than a fault.
 *
 * Driven through the same string the main process builds, so a change to how
 * that is put together is caught here rather than in a screenshot after a
 * release.
 */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
const SPLASH = join(ROOT, 'apps', 'desktop', 'src', 'splash.html')

/* The call exactly as saySplash builds it. Kept as its own function so the
   two cannot drift apart quietly: if the main process starts saying it
   differently, this is the line to change and these checks are why. */
const call = (text, percent) => {
  const shown = percent === null ? 'null'
    : Number.isFinite(percent) ? String(percent) : 'NaN'
  return `window.setSplash && window.setSplash({ text: ${JSON.stringify(text)}, percent: ${shown} })`
}

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 300, height: 340 })
  await win.loadFile(SPLASH)
  await new Promise((r) => setTimeout(r, 300))

  const say = async (text, percent) => {
    await win.webContents.executeJavaScript(call(text, percent))
    return win.webContents.executeJavaScript(`(() => {
      const bar = document.querySelector('.bar') || document.getElementById('bar')
      const fill = bar && (bar.querySelector('i') || bar.firstElementChild)
      const state = document.querySelector('.state') || document.getElementById('state')
      return {
        text: state && state.textContent,
        on: !!bar && bar.classList.contains('on'),
        unknown: !!bar && bar.classList.contains('unknown'),
        width: fill ? fill.style.width : null,
      } })()`)
  }

  const quiet = await say('Starting…', null)
  console.log('  no total given: ' + JSON.stringify(quiet))
  check('the text always arrives', quiet.text === 'Starting…', quiet.text)
  check('null means no bar at all', quiet.on === false, quiet)

  const half = await say('Updating to 0.2.19…', 42)
  console.log('  a percentage  : ' + JSON.stringify(half))
  check('a number fills the bar to it', half.on === true && half.width === '42%', half)
  check('and it is not the moving kind', half.unknown === false, half)

  /*
   * The one that was unreachable. Both halves matter: the bar has to be
   * there, and it has to be the moving kind rather than sitting at whatever
   * width it was last left at.
   */
  const moving = await say('Installing 0.2.19…', Number.NaN)
  console.log('  size unknown  : ' + JSON.stringify(moving))
  check('progress with no total still shows a bar', moving.on === true, moving)
  check('and it is the one that keeps moving', moving.unknown === true, moving)
  check('with the message beside it', moving.text === 'Installing 0.2.19…', moving.text)

  console.log(bad === 0 ? '\n  the splash says what it is told' : `\n  ${bad} wrong`)
  win.destroy()
  app.exit(bad === 0 ? 0 : 1)
})
