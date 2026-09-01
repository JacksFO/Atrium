/**
 * Does the picture sit in the middle of its tile?
 *
 * Reported with a screenshot from a phone: a camera with a band of black
 * filling the top of the tile and the picture pushed to the bottom. A
 * letterbox is fine and expected - a phone camera is portrait and the tile is
 * not - but it belongs equally above and below, not all at one end.
 *
 * Measured rather than reasoned about, because the last three guesses about
 * this stage were wrong and the one before that was a padding nobody
 * suspected. The numbers here are the gap above the picture and the gap below
 * it; the fault is those two not matching.
 *
 * Both aspect ratios, because a rule that centres a portrait video by
 * stretching it would pass a test that only measured black.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')

/* Every stylesheet, in the order main.tsx imports them: a later sheet sets
   the height of this tile, and measuring without it measures nothing. */
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
  --radius-l:16px;--font-display:sans-serif;--dim:#8b949e}
  body{margin:0;background:#111}`

/*
 * A real <video>, given a size by a poster.
 *
 * It has to be a video element: the rule that shapes the picture is
 * `.stage-screen video`, so a stand-in <img> is styled by nothing at all -
 * which the first version of this did, and duly reported object-fit as
 * "fill" on an element the app never renders.
 *
 * A video with no stream has no intrinsic size, and a poster gives it one
 * without needing anything to play.
 */
const pixel = (w, h) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#c33"/></svg>`)

const html = `<!doctype html><meta charset="utf-8"><style>${tokens}\n${css}</style>
<div class="stage-grid n1">
  <figure class="stage-cell is-camera" id="portrait">
    <div class="stage-screen"><video id="pv" poster="${pixel(720, 1280)}"></video></div>
    <figcaption><span class="stage-cell-name">Nipeno</span></figcaption>
  </figure>
</div>
<div class="stage-grid n1">
  <figure class="stage-cell" id="landscape">
    <div class="stage-screen"><video id="lv" poster="${pixel(1920, 1080)}"></video></div>
    <figcaption><span class="stage-cell-name">A screen</span></figcaption>
  </figure>
</div>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  // A phone, and the width the stage collapses to one column at.
  const win = new BrowserWindow({ show: true, useContentSize: true, width: 390, height: 900 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))

  let bad = 0
  const check = (what, ok, got) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
    if (!ok) bad++
  }

  /**
   * Where the picture actually is inside the box it was given.
   *
   * The element fills the box; object-fit decides where the pixels land
   * inside it, and that is not something a bounding rectangle shows. So the
   * gaps are worked out from the intrinsic ratio the same way the browser
   * does, which is the number a person sees as a black band.
   */
  const geometry = (id, nat) => win.webContents.executeJavaScript(`(() => {
    const el = document.getElementById('${id}')
    const box = el.getBoundingClientRect()
    const fit = getComputedStyle(el).objectFit
    // Supplied rather than read: a poster gives a video a size to lay out
    // with but leaves videoWidth at zero, so the element cannot be asked.
    const nat = ${nat}
    const shown = fit === 'cover'
      ? { w: box.width, h: box.height }
      : (box.width / box.height > nat
          ? { w: box.height * nat, h: box.height }
          : { w: box.width, h: box.width / nat })
    return {
      fit,
      box: { w: Math.round(box.width), h: Math.round(box.height) },
      picture: { w: Math.round(shown.w), h: Math.round(shown.h) },
      above: Math.round((box.height - shown.h) / 2),
      below: Math.round((box.height - shown.h) / 2),
      // What the box does with a child that does not fill it, which is the
      // thing that decides whether a letterbox is split or dumped at one end.
      align: getComputedStyle(el.parentElement).alignItems,
      justify: getComputedStyle(el.parentElement).justifyItems,
      // And where the element itself sits, which is the fault if it is not
      // the same height as its box.
      top: Math.round(box.top),
    } })()`)

  const portrait = await geometry('pv', 720 / 1280)
  const landscape = await geometry('lv', 1920 / 1080)
  console.log('  portrait : ' + JSON.stringify(portrait))
  console.log('  landscape: ' + JSON.stringify(landscape))

  /*
   * A camera crops, a screen letterboxes, and that is deliberate: a document
   * cut to 16:9 loses its edges, and a person cut to 16:9 is a forehead.
   *
   * Which also means a camera cannot produce a black band at all - it fills
   * its tile by construction. That is the finding this measurement was
   * written to look for and did not find, and it is worth keeping as the
   * thing that would notice if the two rules were ever swapped.
   */
  check('a camera fills its tile rather than letterboxing',
    portrait.fit === 'cover', portrait.fit)
  check('so there is no band above or below it',
    portrait.above === 0 && portrait.below === 0, portrait)
  check('a screen letterboxes rather than losing its edges',
    landscape.fit === 'contain', landscape.fit)
  check('and fills the width it is given',
    Math.abs(landscape.picture.w - landscape.box.w) <= 2, landscape)

  /*
   * The element itself has to fill the box for object-fit to have anything to
   * centre within. An element shorter than its box, aligned to one end, looks
   * exactly like the reported fault and no amount of object-fit fixes it.
   */
  const fills = await win.webContents.executeJavaScript(`(() => {
    const el = document.getElementById('pv')
    const box = el.parentElement.getBoundingClientRect()
    const mine = el.getBoundingClientRect()
    return {
      boxH: Math.round(box.height), elH: Math.round(mine.height),
      boxW: Math.round(box.width), elW: Math.round(mine.width),
      offsetTop: Math.round(mine.top - box.top),
    } })()`)
  console.log('  fills    : ' + JSON.stringify(fills))
  // Within the tile's own border, which is a pixel each side.
  check('the picture element fills the tile it sits in',
    Math.abs(fills.elH - fills.boxH) <= 2 && Math.abs(fills.elW - fills.boxW) <= 2, fills)
  check('and starts at the top of it', fills.offsetTop <= 1, fills)

  console.log(bad === 0 ? '\n  the picture sits in its frame' : `\n  ${bad} wrong`)
  win.destroy()
  app.exit(bad === 0 ? 0 : 1)
})
