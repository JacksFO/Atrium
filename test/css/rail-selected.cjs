/**
 * Can you tell which server you are in, when its icon covers the tile?
 *
 * The selected server said so with a gradient background and a bar on the
 * left edge. A server showing initials wears that gradient and is obvious; a
 * server with a picture covers every pixel of it, so all that was left was
 * four pixels at the far edge. Reported as being hard to tell.
 *
 * The ring is drawn outside the tile with a box-shadow, which is the part
 * worth measuring: a picture cannot cover it, but the rail CAN clip it -
 * the column hides its horizontal overflow, and a ring is exactly the sort
 * of thing that gets quietly cut off at an edge.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
const css = ['apps/web/src/app.css'].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')

const tokens = `:root{--glass:#181c22;--glass-2:#1d2229;--glass-solid:#181c22;--blur:blur(8px);
  --line:#2b3138;--line-soft:#22262c;--raise:#20252c;--raise-2:#272d35;--text:#e7ecf2;
  --text-dim:#9aa6b2;--text-faint:#6b7683;--blue:#4b8cff;--cyan:#37d5e8;--blue-ink:#04121f;
  --red:#e5484d;--grey:#6b7683;--cyan-glow:0 0 8px #37d5e8;--edge-hi:none;
  --radius:12px;--radius-s:8px;--font-display:sans-serif}
  body{margin:0;background:#111}
  /* The rail's real width, from .app.has-rail. Without it the column is as
     wide as the window and the clipping check passes on 200 pixels of room
     that does not exist - which is the harness answering a question about a
     page the app never renders. */
  .rail{width:84px}`

// A 1x1 PNG, so the icon is real and really does cover the tile.
const PIXEL = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const html = `<!doctype html><meta charset="utf-8"><style>${tokens}\n${css}</style>
<aside class="rail">
  <div class="rail-spaces">
    <button class="rail-pip is-space has-icon is-on" id="selected">
      <img class="rail-icon" src="${PIXEL}" alt="">
    </button>
    <button class="rail-pip is-space has-icon" id="other">
      <img class="rail-icon" src="${PIXEL}" alt="">
      <span class="rail-badge is-ping" id="badge">@</span>
    </button>
  </div>
</aside>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: -4000, y: 0, focusable: false, width: 500, height: 500 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  const out = await win.webContents.executeJavaScript(`(() => {
    const on = document.getElementById('selected')
    const off = document.getElementById('other')
    const rail = document.querySelector('.rail')
    const cs = getComputedStyle(on)
    const bar = getComputedStyle(on, '::before')
    return {
      /* Nothing may be drawn ON the icon: the artwork belongs to whoever made
         the server, and a frame around it was reported as not fitting twice. */
      selectedOutline: cs.outlineStyle,
      selectedShadow: cs.boxShadow,
      bar: { w: bar.width, h: bar.height, content: bar.content },
      dim: {
        selected: getComputedStyle(on.querySelector('.rail-icon')).opacity,
        other: getComputedStyle(off.querySelector('.rail-icon')).opacity,
      },
      /* The badge only ever appears on a server you are NOT in, so it must
         not be dimmed with the artwork it sits on. */
      badge: {
        own: getComputedStyle(document.getElementById('badge')).opacity,
        tile: getComputedStyle(off).opacity,
      },
      tile: Math.round(on.getBoundingClientRect().height),
      railWidth: Math.round(rail.getBoundingClientRect().width),
      barLeft: bar.left,
    }
  })()`)

  console.log(JSON.stringify(out, null, 2))

  const barH = parseFloat(out.bar.h)
  const barW = parseFloat(out.bar.w)

  const results = [
    // The bar is now the only thing saying which server you are in, so it has
    // to be big enough to find in a column of tiles.
    ['the server you are in has a bar', out.bar.content !== 'none' && barW >= 5],
    ['and it is most of the tile, not a stub', barH >= out.tile * 0.6],
    // Nothing on the artwork. This is the whole point of the change.
    ['nothing is drawn on the icon itself',
      out.selectedOutline === 'none' && !/rgb/.test(out.selectedShadow)],
    // The second signal: everything else steps back.
    ['the servers you are not in are dimmed', parseFloat(out.dim.other) < 0.7],
    ['and the one you are in is not', parseFloat(out.dim.selected) === 1],
    // The regression this was written for: dimming the tile dimmed the badge
    // with it, on exactly the servers where a badge is the point.
    ['a badge on a dimmed server is still at full strength',
      parseFloat(out.badge.own) === 1 && parseFloat(out.badge.tile) === 1],
    ['the rail is wide enough for the bar beside the tile',
      out.railWidth - out.tile >= barW * 2],
  ]

  let bad = 0
  for (const [what, ok] of results) {
    if (!ok) bad += 1
    console.log((ok ? 'PASS ' : 'FAIL ') + what)
  }

  app.quit()
  process.exit(bad === 0 ? 0 : 1)
})
