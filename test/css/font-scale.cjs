/**
 * The font size setting actually changes the font size.
 *
 * Reported: changing it in Appearance did nothing. It wrote a custom property
 * and body used it - and every other rule in the app set its font-size in
 * absolute pixels, so a message, a name, a channel and a button all overrode
 * it. The slider moved one element nobody looks at.
 *
 * Two things to prove, and the first matters as much as the second: that the
 * default renders exactly as it always has, so nobody's app changes under
 * them, and that moving the setting moves everything.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
const css = ['apps/web/src/app.css']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')

/* A sample of the app: a message, a name, a channel row, a small label. */
const html = `<!doctype html><meta charset="utf-8"><title>font</title>
<style>${css}</style>
<div class="app">
  <div class="channels"><button class="chan"><span class="chan-name" id="chan">general</span></button></div>
  <main class="chat">
    <div class="msg"><div class="msg-body">
      <div class="msg-head"><button class="author" id="author">JacksFO</button>
      <span class="stamp" id="stamp">18:20</span></div>
      <div class="msg-text" id="text">evening</div>
    </div></div>
  </main>
</div>`

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

const sizes = () => `(() => {
  const px = (id) => {
    const el = document.getElementById(id)
    return el ? Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100 : null
  }
  return { chan: px('chan'), author: px('author'), stamp: px('stamp'), text: px('text'),
    body: Math.round(parseFloat(getComputedStyle(document.body).fontSize) * 100) / 100 }
})()`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: -4000, y: 0, focusable: false, width: 1200, height: 800 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  // --- the default has to look exactly as it always did -------------------
  const base = await win.webContents.executeJavaScript(sizes())
  console.log('    at the default: ' + JSON.stringify(base))
  check('the body is twenty, which is the default', base.body === 20, base.body)
  check('and every sampled element has a real size',
    Object.values(base).every((v) => typeof v === 'number' && v > 0), base)

  /*
   * Everything is a multiple of the base, so the ratios are what is worth
   * checking rather than the pixels. A message is the base size; a timestamp
   * is 23/30 of it, which at the old default of fifteen was the 11.5px it had
   * always rendered at. If the arithmetic drifted these are where it shows.
   */
  check('a message renders at the base size', base.text === base.body, base.text)
  check('and a timestamp at just over three quarters of it',
    Math.abs(base.stamp / base.body - 11.5 / 15) < 0.02,
    { got: Math.round((base.stamp / base.body) * 1000) / 1000, want: Math.round((11.5 / 15) * 1000) / 1000 })

  // --- turning it up moves everything -------------------------------------
  const bigger = await win.webContents.executeJavaScript(`(() => {
    document.documentElement.style.setProperty('--base-font', '26px')
    return ${sizes()}
  })()`)
  console.log('    at twenty-six:  ' + JSON.stringify(bigger))

  for (const key of ['chan', 'author', 'stamp', 'text', 'body']) {
    check(`${key} grew`, bigger[key] > base[key], { from: base[key], to: bigger[key] })
  }
  // Proportionally, not by a fixed amount - the whole scale moves together.
  const ratio = 26 / 20
  check('the timestamp grew by the same proportion as everything else',
    Math.abs(bigger.stamp / base.stamp - ratio) < 0.02,
    { got: Math.round((bigger.stamp / base.stamp) * 1000) / 1000, want: Math.round(ratio * 1000) / 1000 })

  // --- and down ------------------------------------------------------------
  const smaller = await win.webContents.executeJavaScript(`(() => {
    document.documentElement.style.setProperty('--base-font', '12px')
    return ${sizes()}
  })()`)
  console.log('    at twelve:      ' + JSON.stringify(smaller))
  check('everything shrinks too',
    ['chan', 'author', 'stamp', 'text'].every((k) => smaller[k] < base[k]), smaller)

  console.log('\n  ' + (bad === 0 ? 'the whole interface scales from the setting' : bad + ' wrong'))
  win.destroy()
  app.quit()
  process.exit(bad === 0 ? 0 : 1)
})
