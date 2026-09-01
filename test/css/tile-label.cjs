/**
 * Does the tile label get out of the way of the picture?
 *
 * Reported with a screenshot: the name bar across the bottom of a thumbnail
 * covering the camera it was sitting on. A tile is 150x90, and a full-width
 * bar is a large share of that.
 *
 * Measured rather than reasoned about, and measured on both sides of the
 * rule: a label that hid and never came back would be a worse bug than the
 * one being fixed, and it would look identical to this one passing.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
/*
 * Every stylesheet, in the order main.tsx imports them.
 *
 * This loaded two of the six and measured a tile sitting loose on the body.
 * It passed while the real app was visibly wrong, which is worse than having
 * no measurement at all: a later sheet can set a height, and a tile that is a
 * grid child is not a tile floating in a page.
 */
const css = [
  'apps/client/src/tokens.css',
  'apps/client/src/app.css',
  'apps/client/src/stage1.css',
  'apps/client/src/settings.css',
  'apps/client/src/rail.css',
  'apps/client/src/responsive.css',
].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')

const tokens = `:root{--glass:#181c22;--glass-2:#1d2229;--glass-solid:#181c22;--blur:blur(8px);
  --line:#2b3138;--line-soft:#22262c;--raise:#20252c;--raise-2:#272d35;--text:#e7ecf2;
  --text-dim:#9aa6b2;--text-faint:#6b7683;--blue:#4b8cff;--cyan:#37d5e8;--red:#e5484d;
  --grey:#6b7683;--cyan-glow:0 0 8px #37d5e8;--edge-hi:none;--radius:12px;--radius-s:8px;
  --font-display:sans-serif;--dim:#8b949e}
  body{margin:0;background:#111}`

/*
 * Two tiles: one with a picture under the label, one showing only an avatar.
 * The rule has to treat them differently, and a test with only the first
 * would pass just as happily with the label hidden on both.
 */
const html = `<!doctype html><meta charset="utf-8"><style>${tokens}\n${css}</style>
<div class="stage-tiles">
  <button class="tile has-picture" id="withPicture">
    <video class="tile-video"></video>
    <span class="tile-label"><span class="tile-name">Kai</span></span>
  </button>
  <button class="tile" id="avatarOnly">
    <span class="tile-face">KA</span>
    <span class="tile-label"><span class="tile-name">Bailey</span></span>
  </button>
</div>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 600, height: 400 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  const opacityOf = (id) => win.webContents.executeJavaScript(
    `getComputedStyle(document.querySelector('#${id} .tile-label')).opacity`)

  const resting = {
    picture: Number(await opacityOf('withPicture')),
    avatar: Number(await opacityOf('avatarOnly')),
  }

  /*
   * The shape of the tile, which the resize got wrong once already.
   *
   * The base rule gives an explicit width AND height, and aspect-ratio has
   * no say while both are set - so growing only the width left the height
   * pinned and produced a letterbox. Measured as a ratio rather than as two
   * numbers, because the whole point is that the two move together.
   */
  const shape = await win.webContents.executeJavaScript(`(() => {
    const r = document.getElementById('withPicture').getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), ratio: r.width / r.height }
  })()`)
  console.log('  tile shape: ' + JSON.stringify(shape))

  /*
   * The hover half, read out of the stylesheet rather than acted out.
   *
   * Two ways of producing a hover state were tried here and neither works in
   * a window driven like this: a synthetic mouseMove leaves `.tile:hover`
   * null, and CSS.forcePseudoState through the devtools protocol changed
   * nothing either. Adding a stand-in class would have "passed" while proving
   * only that the stand-in works.
   *
   * So this asks the real shipped stylesheet what it says, through the same
   * CSSOM the browser resolves from. Weaker than seeing the pixels change,
   * and said plainly rather than dressed up: it catches the rule being
   * deleted, renamed or having its opacity changed, which is what would
   * actually go wrong.
   */
  const rule = await win.webContents.executeJavaScript(`(() => {
    for (const sheet of document.styleSheets) {
      for (const r of sheet.cssRules) {
        if (!r.selectorText || !/\.tile\.has-picture:hover/.test(r.selectorText)) continue
        return { selector: r.selectorText, opacity: r.style.opacity }
      }
    }
    return null
  })()`)
  console.log('  hover rule: ' + JSON.stringify(rule))

  console.log(JSON.stringify({ resting }, null, 2))

  const results = [
    ['the label is out of the way of a picture', resting.picture === 0],
    ['a tile with no picture keeps its name', resting.avatar === 1],
    ['there is a rule bringing it back on hover', rule !== null],
    ['and it brings it all the way back', rule?.opacity === '1'],
    ['a tile keeps its shape rather than stretching flat',
      Math.abs(shape.ratio - 16 / 10) < 0.05],
  ]

  let bad = 0
  for (const [what, ok] of results) {
    if (!ok) bad += 1
    console.log((ok ? 'PASS ' : 'FAIL ') + what)
  }

  app.quit()
  process.exit(bad === 0 ? 0 : 1)
})
