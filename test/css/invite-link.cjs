/**
 * The invite link, and the button beside it.
 *
 * The box was shaped for an eight-character code: centred, letter-spaced and
 * large. It carries a whole address now, five times longer - so it wrapped
 * oddly and pushed the Copy button out through the side of the dialog.
 * Reported with a screenshot of exactly that: "Copied" sitting outside the
 * panel it belongs to.
 *
 * Measured as nothing sticking out of the dialog, which is the fault as a
 * person sees it, rather than as any particular font size.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
const css = ['apps/client/src/app.css', 'apps/client/src/stage1.css']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')

const tokens = `:root{--glass:#181c22;--glass-2:#1b2027;--glass-solid:#181c22;--blur:blur(8px);
  --line:#2b3138;--line-soft:#22262c;--raise:#20252c;--raise-2:#272d35;--text:#e7ecf2;
  --text-dim:#9aa6b2;--text-faint:#6b7683;--blue:#4b8cff;--cyan:#37d5e8;--blue-ink:#04121f;
  --cyan-line:#2c8f9c;--cyan-soft:#0f2a30;--red:#e5484d;--edge-hi:none;--shadow-pop:none;
  --radius:12px;--radius-s:8px;--radius-l:16px;--font-display:sans-serif;--font-mono:monospace}
  body{margin:0;background:#111}`

/* The real address this writes, at the length it is really sent at. */
// The current shape, because layout is measured against the worst case
// and a code is eighteen hex characters now rather than eight.
const LINK = 'https://atriumapp.duckdns.org/invite/jc-8f378fe3a91c4d20b7'

const page = `<!doctype html><meta charset="utf-8"><title>invite</title>
<style>${tokens}\n${css}</style>
<div class="as-panel" id="panel" style="width:436px;padding:20px;background:#181c22;border:1px solid #2b3138;border-radius:16px">
  <div class="as-lede">Or send an invite link to somebody</div>
  <div class="as-link" id="row">
    <span class="as-code" id="code">${LINK}</span>
    <button class="pbtn primary" id="copy">Copied</button>
  </div>
</div>`

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, useContentSize: true, width: 900, height: 600 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
  await new Promise((r) => setTimeout(r, 400))

  const m = await win.webContents.executeJavaScript(`(() => {
    const box = (id) => { const r = document.getElementById(id).getBoundingClientRect()
      return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) } }
    const code = document.getElementById('code')
    return {
      panel: box('panel'), row: box('row'), code: box('code'), copy: box('copy'),
      // Anything at all reaching past the panel's inner edge.
      widest: Math.round(Math.max(...[...document.getElementById('panel').querySelectorAll('*')]
        .map((e) => e.getBoundingClientRect().right))),
      codeOverflows: code.scrollWidth > code.clientWidth + 1,
      copySquashed: (() => { const b = document.getElementById('copy')
        return b.scrollWidth > b.clientWidth + 1 })(),
      align: getComputedStyle(code).textAlign,
      wraps: getComputedStyle(code).overflowWrap,
    } })()`)
  console.log('  ' + JSON.stringify(m))

  /*
   * The whole of the report. The button is the thing that ended up outside,
   * so it is checked by name as well as by the sweep over everything.
   */
  check('the Copy button is inside the dialog',
    m.copy.right <= m.panel.right, { copy: m.copy.right, panel: m.panel.right })
  check('and so is everything else in it',
    m.widest <= m.panel.right, { widest: m.widest, panel: m.panel.right })

  check('the address is not cut off', m.codeOverflows === false, m.codeOverflows)
  /* A URL read left to right, not centred like a code somebody reads aloud -
     which is what made a wrapped second line look like a mistake. */
  check('it reads from the left, the way an address does', m.align === 'left', m.align)
  check('and may break anywhere, having no spaces to break at',
    m.wraps === 'anywhere', m.wraps)

  /* Not a number picked out of the air: the button must not be squeezed
     narrower than the word inside it, which is what happens when a flex row
     is allowed to take space from a control instead of from the text. */
  check('the button is not squeezed narrower than its own label',
    m.copySquashed === false, { width: m.copy.w, squashed: m.copySquashed })

  console.log(bad === 0 ? '\n  the invite link fits its dialog' : `\n  ${bad} wrong`)
  win.destroy()
  app.exit(bad === 0 ? 0 : 1)
})
