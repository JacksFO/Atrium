/**
 * What the window shows when the app cannot load.
 *
 * The old screen opened with "Atrium could not start" over a red block of
 * diagnostics - secure context, resource timings, the address. All of it
 * useful about once a week, and all of it in front of somebody whose actual
 * situation is that the server is restarting and will be back before they
 * finish reading.
 *
 * This drives the real page with its real failure path: the built index.html,
 * loaded so that its own script cannot be fetched, which is exactly what a
 * browser sees when the server is not answering. Nothing is called directly -
 * the point is that the page notices on its own.
 */
const { app, BrowserWindow } = require('electron')
const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = join(__dirname, '..', '..')
const PAGE = join(ROOT, 'apps', 'client', 'dist', 'index.html')

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  if (!existsSync(PAGE)) {
    console.error(`no built client at ${PAGE} - run the client build first`)
    process.exit(1)
  }

  const win = new BrowserWindow({ show: true, width: 900, height: 700 })
  /*
   * file:// on purpose. The page asks for /assets/... from the root of the
   * filesystem, which is nowhere - so the script fails to load exactly as it
   * does when the server is down, and the page's own watchdog is what
   * eventually notices.
   */
  await win.loadURL(pathToFileURL(PAGE).href)

  // Its watchdog waits fifteen seconds before deciding nothing rendered.
  await new Promise((r) => setTimeout(r, 18_000))

  const seen = await win.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('.jc-panel')
    const pre = document.getElementById('jc-pre')
    return {
      shown: !!panel,
      title: (document.querySelector('.jc-name') || {}).textContent || '',
      lead: (document.querySelector('.jc-state') || {}).textContent || '',
      buttons: [...document.querySelectorAll('.jc-btn')].map((b) => b.textContent.trim()),
      detailsHidden: pre ? pre.hidden : null,
      glyph: (document.querySelector('.jc-glyph') || {}).textContent || '',
      // Nothing red, and no wall of text as the first thing read.
      red: document.body.innerHTML.includes('#FF6E7F'),
      oldTitle: document.body.innerText.includes('could not start'),
    }
  })()`)
  console.log('    ' + JSON.stringify(seen))

  check('the failure screen renders at all', seen.shown === true)
  check('it carries the mark from the splash', seen.glyph === 'J', seen.glyph)
  check('it says the server cannot be reached, not that the app broke',
    /can.t reach/i.test(seen.title), seen.title)
  check('and says restarting usually clears it',
    /restarting/i.test(seen.lead), seen.lead)
  check('the old wording is gone', seen.oldTitle === false)
  check('and so is the red block', seen.red === false)
  check('there is something to press', seen.buttons.includes('Try again'), seen.buttons)
  check('the detail is offered', seen.buttons.includes('Details'), seen.buttons)
  check('but not shown first', seen.detailsHidden === true, seen.detailsHidden)

  // And the detail is still reachable, because when it IS the app that broke
  // the detail is the whole point.
  const opened = await win.webContents.executeJavaScript(`(() => {
    const b = document.getElementById('jc-detail')
    if (b) b.click()
    const pre = document.getElementById('jc-pre')
    return { hidden: pre ? pre.hidden : null, label: b ? b.textContent.trim() : '',
      text: pre ? pre.textContent.slice(0, 60) : '' }
  })()`)
  check('pressing Details shows it', opened.hidden === false, opened)
  check('and the button says how to put it back', /hide/i.test(opened.label), opened.label)
  check('with the real reason in it', opened.text.length > 0, opened.text)

  console.log('\n  ' + (bad === 0 ? 'the failure screen behaves' : bad + ' wrong'))
  win.destroy()
  app.quit()
  process.exit(bad === 0 ? 0 : 1)
})
