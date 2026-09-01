/**
 * Does the unread badge actually reach the Windows taskbar?
 *
 * The unit tests say the right picture is drawn for the right count. They say
 * nothing about whether Windows will take it: setOverlayIcon wants a native
 * image, nativeImage has to decode the PNG the canvas produced, and an image
 * it fails to decode comes back empty rather than throwing - which would put
 * a blank square on the taskbar and look like a bug in the drawing.
 *
 * So this runs the REAL badge module, bundled from source, in a real Electron
 * window, and hands what it produces to the real Windows call. A copy of the
 * drawing code here would only prove the copy works.
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const { readFileSync } = require('node:fs')

const BUNDLE = process.argv[2]
if (!BUNDLE) {
  console.error('no bundle path given')
  process.exit(2)
}

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

const bundle = readFileSync(BUNDLE, 'utf8')
const html = `<!doctype html><meta charset="utf-8"><title>badge</title><script>${bundle}</script>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  // Shown, because a window Chromium considers unimportant stops rendering -
  // and an overlay icon on a window with no taskbar button is not a test.
  const win = new BrowserWindow({ show: true, width: 500, height: 380 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  /*
   * Drawn by the real module, with a real canvas, from a real unread map -
   * the same call the app makes.
   */
  const drawn = await win.webContents.executeJavaScript(`(() => {
    const channels = [
      { id: 'general', kind: 'text' },
      { id: 'dm', kind: 'dm' },
    ]
    const make = (counts, pinged, requests) => {
      const summary = Badge.unreadSummary(
        new Map(Object.entries(counts)), new Set(pinged || []), channels,
        new Set(), requests || 0)
      return { summary, url: Badge.badgeImage(summary), tip: Badge.badgeTooltip(summary) }
    }
    return {
      none: make({}),
      one: make({ general: 1 }),
      three: make({ general: 3 }),
      nine: make({ general: 9 }),
      lots: make({ general: 40, dm: 17 }),
      // Nothing unread anywhere, one person asking to be friends. Arrives on
      // no channel, so before this it drew nothing at all.
      asked: make({}, [], 1),
      // And alongside messages, which the tooltip has to tell apart.
      both: make({ general: 2 }, [], 1),
    }
  })()`)

  check('nothing unread draws no badge at all', drawn.none.url === null, drawn.none.url)
  check('and says only the app name', drawn.none.tip === 'Atrium', drawn.none.tip)

  for (const [name, expected] of [['one', 1], ['three', 3], ['nine', 9], ['lots', 57]]) {
    const made = drawn[name]
    check(`${expected} unread produces a real PNG`,
      typeof made.url === 'string' && made.url.startsWith('data:image/png;base64,'),
      made.url ? made.url.slice(0, 30) : made.url)
    check(`and counts them all: ${expected}`, made.summary.total === expected, made.summary)
  }

  /*
   * A friend request badges the taskbar on its own. It arrives on no channel,
   * so until now nothing the badge counted could see one: somebody could ask
   * while the app was minimised and there was no sign of it anywhere.
   */
  check('a lone friend request badges the app',
    typeof drawn.asked.url === 'string' && drawn.asked.url.startsWith('data:image/png;base64,'),
    drawn.asked.url)
  check('and counts as the one thing waiting', drawn.asked.summary.total === 1, drawn.asked.summary)
  check('named as a request, not as a message',
    drawn.asked.tip === 'Atrium — 1 friend request', drawn.asked.tip)
  check('and alongside messages, both are counted and neither renamed',
    drawn.both.summary.total === 3
      && drawn.both.tip === 'Atrium — 2 unread messages in 1 channel, 1 friend request',
    { total: drawn.both.summary.total, tip: drawn.both.tip })

  /*
   * The half the unit tests cannot reach: Electron decoding it, and Windows
   * accepting it.
   */
  for (const name of ['one', 'three', 'nine', 'lots', 'asked', 'both']) {
    const image = nativeImage.createFromDataURL(drawn[name].url)
    check(`Electron decodes the ${name} badge`, !image.isEmpty(), image.getSize())
    let threw = null
    try {
      win.setOverlayIcon(image, drawn[name].tip)
    } catch (err) {
      threw = String(err && err.message)
    }
    check(`and Windows takes it as an overlay (${name})`, threw === null, threw)
  }

  // Clearing has to work too, or a badge outlives the messages that caused it.
  let clearThrew = null
  try { win.setOverlayIcon(null, '') } catch (err) { clearThrew = String(err && err.message) }
  check('and it can be taken off again', clearThrew === null, clearThrew)

  console.log('\n  ' + (bad === 0 ? 'the badge reaches the taskbar' : bad + ' wrong'))
  win.destroy()
  app.quit()
  process.exit(bad === 0 ? 0 : 1)
})
