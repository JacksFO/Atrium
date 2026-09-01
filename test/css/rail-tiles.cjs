/**
 * Does a server's picture actually fill its tile in the rail?
 *
 * Reported as the icon being "a little smaller" than the tile it sits in.
 * The tile carries a 1px border and a background of its own for the initials
 * to sit on, and a picture inside that reached only the content box - so it
 * was inset all round with the tile's background showing as a ring.
 *
 * Loads the real stylesheet rather than a copy of the rules, because a copy
 * would only prove that the copy is right.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
// The real cascade, in the order the app loads it: the reset resets some of
// what a <button> brings with it but not all, which is the whole question.
const css = ['apps/web/src/app.css']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')
// The tokens the rail's rules refer to. Values do not matter to geometry;
// they only have to exist so nothing collapses to an unset length.
const tokens = `:root{--glass:#181c22;--glass-solid:#181c22;--blur:blur(8px);--line:#2b3138;
  --line-soft:#22262c;--raise:#20252c;--raise-2:#272d35;--text:#e7ecf2;--text-dim:#9aa6b2;
  --text-faint:#6b7683;--blue:#4b8cff;--cyan:#37d5e8;--blue-ink:#04121f;--red:#e5484d;
  --cyan-line:#2c8f9c;--cyan-glow:0 0 8px #37d5e8;--edge-hi:none;--radius:12px;--radius-s:8px;
  --font-display:sans-serif}
  body{margin:0;background:#111}`

// A 1x1 PNG, so the image is real and has an intrinsic size to fight with.
const PIXEL = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const html = `<!doctype html><meta charset="utf-8"><style>${tokens}\n${css}</style>
<div class="rail">
  <button class="rail-pip is-space has-icon" id="withIcon">
    <img class="rail-icon" src="${PIXEL}" alt="B">
  </button>
  <button class="rail-pip is-space" id="initials">BD</button>
</div>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, x: -4000, y: 0, focusable: false, width: 400, height: 400 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const out = await win.webContents.executeJavaScript(`(() => {
    const pip = document.getElementById('withIcon')
    const img = pip.querySelector('.rail-icon')
    const p = pip.getBoundingClientRect()
    const i = img.getBoundingClientRect()
    const plain = document.getElementById('initials').getBoundingClientRect()
    return {
      tile: { w: p.width, h: p.height },
      picture: { w: i.width, h: i.height },
      insetLeft: i.left - p.left,
      insetTop: i.top - p.top,
      radius: getComputedStyle(img).borderTopLeftRadius,
      fit: getComputedStyle(img).objectFit,
      initialsTile: { w: plain.width, h: plain.height },
      initialsBorder: getComputedStyle(document.getElementById('initials')).borderTopWidth,
    }
  })()`)
  console.log(JSON.stringify(out, null, 2))
  const fills = out.picture.w === out.tile.w && out.picture.h === out.tile.h
  const flush = out.insetLeft === 0 && out.insetTop === 0
  console.log(fills && flush ? '\nPASS the picture fills its tile' : '\nFAIL still inset')
  // The tile without a picture must keep its border, or the initials lose
  // the surface they are drawn on.
  console.log(out.initialsBorder === '1px'
    ? 'PASS a tile showing initials keeps its border'
    : 'FAIL the initials tile lost its border: ' + out.initialsBorder)
  app.quit()
  process.exit(fills && flush && out.initialsBorder === '1px' ? 0 : 1)
})
