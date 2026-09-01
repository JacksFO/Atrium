/**
 * The banner preview is the shape of the banner.
 *
 * The preview used to be a flat 92px tall, and it sits in two places of very
 * different widths - a narrow column while a profile is being edited, and a
 * wide card in Settings. One height meant two different crops, so the picture
 * you approved was not the picture you got, and a preview that is not the
 * shape of the thing it previews is worse than no preview at all.
 *
 * It is a ratio now. Which is a rule with two ways to go quietly wrong:
 * aspect-ratio is a newer property than the browsers this app is built for, so
 * there is a min-height behind it for anything that does not know it - and a
 * height that comes out of a ratio is easy to get right at one width and wrong
 * at another, which is the failure this replaced.
 *
 * So it is measured at both widths, and against the two places a banner is
 * actually shown, since "the same shape" is a claim about all three.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
const css = ['apps/client/src/app.css', 'apps/client/src/stage1.css',
  'apps/client/src/rail.css', 'apps/client/src/responsive.css']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')

const tokens = `:root{--glass:#181c22;--glass-2:#1b2027;--glass-solid:#181c22;--blur:blur(8px);
  --line:#2b3138;--line-soft:#22262c;--raise:#20252c;--raise-2:#272d35;--text:#e7ecf2;
  --text-dim:#9aa6b2;--text-faint:#6b7683;--blue:#4b8cff;--cyan:#37d5e8;--blue-ink:#04121f;
  --red:#e5484d;--cyan-line:#2c8f9c;--edge-hi:none;--shadow-pop:none;--radius:12px;
  --radius-s:8px;--radius-l:16px;--font-display:sans-serif;--font-mono:monospace;--dim:#8b949e}
  body{margin:0;background:#111}`

/*
 * The two columns it lives in. 260 is the picture column of the edit form,
 * which is where the old fixed height was most wrong; 520 is the Settings
 * card. Both hold the same component.
 */
const page = `<!doctype html><meta charset="utf-8"><title>preview</title>
<style>${tokens}\n${css}</style>
<div style="width:260px"><div class="image-edit-preview banner" id="narrow"></div></div>
<div style="width:520px"><div class="image-edit-preview banner" id="wide"></div></div>
<div class="profile beside" style="position:static"><div class="profile-banner" id="card"></div></div>
<div style="width:304px"><div class="dmp-banner" id="panel"></div></div>`

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, useContentSize: true, width: 1000, height: 1200 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
  await new Promise((r) => setTimeout(r, 400))

  const measure = async (height) => {
    win.setContentSize(1000, height)
    await new Promise((r) => setTimeout(r, 350))
    return await win.webContents.executeJavaScript(SIZES)
  }

  const SIZES = `(() => {
    const of = (id) => {
      const r = document.getElementById(id).getBoundingClientRect()
      return {
        w: Math.round(r.width), h: Math.round(r.height),
        ratio: Math.round((r.width / r.height) * 100) / 100,
      }
    }
    return {
      window: window.innerHeight,
      narrow: of('narrow'), wide: of('wide'), card: of('card'), panel: of('panel'),
    }
  })()`

  /* Roomy, and a laptop. The card's banner is clamped against the window - it
     is the part of the card that gives way when the screen is short - so it
     has no one shape, and asking at one height would be asking about that
     height rather than about the rule. */
  const m = await measure(1200)
  const small = await measure(720)
  console.log('  roomy:  ' + JSON.stringify(m))
  console.log('  laptop: ' + JSON.stringify(small))

  /* A ratio holds at any width; a fixed height only looks right at one. */
  check('the preview is three to one in a narrow column',
    Math.abs(m.narrow.ratio - 3) < 0.05, m.narrow)
  check('and three to one in a wide one',
    Math.abs(m.wide.ratio - 3) < 0.05, m.wide)
  check('which is the same shape in both, unlike a fixed height',
    Math.abs(m.narrow.ratio - m.wide.ratio) < 0.05,
    { narrow: m.narrow.ratio, wide: m.wide.ratio })

  /*
   * And the same shape as the things it is previewing, given the room. Not to
   * the decimal - the panel's height is a round number - but near enough that
   * a picture cropped to one is not a surprise in the other.
   */
  check('the card it previews is about the same shape, given the room',
    Math.abs(m.card.ratio - 3) < 0.35, m.card)
  check('and so is the panel beside a conversation',
    Math.abs(m.panel.ratio - 3) < 0.35, m.panel)

  /*
   * On a short screen the card is more letterboxed than its preview, and that
   * is the design rather than a fault: the banner is the part of the card
   * chosen to give way, because the picture being worth its full height
   * matters less than the buttons at the bottom being reachable. Written down
   * here so the difference reads as a decision if anybody measures it later.
   */
  check('on a laptop the card is more letterboxed, which is deliberate',
    small.card.ratio > m.card.ratio, { roomy: m.card.ratio, laptop: small.card.ratio })
  check('and the preview does not follow it, being about the picture',
    Math.abs(small.narrow.ratio - 3) < 0.05, small.narrow)

  /* The floor for a browser without aspect-ratio, where height:auto would
     otherwise collapse the box to nothing. It must never be what decides the
     height at these widths, or the ratio above is a coincidence. */
  check('and the fallback floor is not what is deciding the height',
    m.narrow.h > 80, m.narrow.h)

  console.log(bad === 0 ? '\n  a preview is the shape of the thing it previews' : `\n  ${bad} wrong`)
  win.destroy()
  app.exit(bad === 0 ? 0 : 1)
})
