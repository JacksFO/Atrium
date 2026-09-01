/**
 * Do somebody's name effects survive into the DM panel?
 *
 * Reported: the name in the right-hand panel of a DM has none of the effects
 * or colours it has everywhere else.
 *
 * Three of the effects - gradient, shimmer and outline - fill the letters
 * themselves, and every one of them needs the text transparent for the paint
 * behind it to show through. The panel's own rule set a colour, in a
 * stylesheet loaded after the effects and at the same specificity, so it won
 * and painted the letters flat again. A flat name looks exactly like a name
 * with no effect chosen, which is why it read as the effects being absent
 * rather than as one rule too many.
 *
 * Measured against the message list, which never had the problem: its rule
 * sets no colour at all, and that is the standard the panel has to meet.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
const css = ['apps/web/src/app.css'].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')

const tokens = `:root{--glass:#181c22;--glass-2:#1d2229;--glass-solid:#181c22;--blur:blur(8px);
  --line:#2b3138;--line-soft:#22262c;--raise:#20252c;--raise-2:#272d35;--text:#e7ecf2;
  --text-dim:#9aa6b2;--text-faint:#6b7683;--blue:#4b8cff;--cyan:#37d5e8;--red:#e5484d;
  --grey:#6b7683;--cyan-glow:0 0 8px #37d5e8;--edge-hi:none;--radius:12px;--radius-s:8px;
  --font-display:sans-serif;--font-ui:sans-serif;--font-mono:monospace;--dim:#8b949e}
  body{margin:0;background:#111;color:#e7ecf2}`

/*
 * The same name, with the same effect, in both places. nameStyle hands the
 * colour over as a custom property and deliberately does NOT set `color` for
 * these three - which is what the markup here reproduces.
 */
const html = `<!doctype html><meta charset="utf-8"><style>${tokens}\n${css}</style>
<span class="author fx-gradient" id="inMessages" style="--name-colour:#ff7bc8">Kai</span>

<aside class="dm-profile"><div class="dm-profile-scroll"><div class="dmp-head">
  <div class="dmp-name-row">
    <span class="dmp-name fx-gradient" id="inPanel" style="--name-colour:#ff7bc8">Kai</span>
  </div>
</div></div></aside>

<aside class="dm-profile"><div class="dm-profile-scroll"><div class="dmp-head">
  <div class="dmp-name-row">
    <span class="dmp-name" id="plainPanel">Bailey</span>
  </div>
</div></div></aside>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: -4000, y: 0, focusable: false, width: 900, height: 600 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  const out = await win.webContents.executeJavaScript(`(() => {
    const read = (id) => {
      const cs = getComputedStyle(document.getElementById(id))
      return {
        color: cs.color,
        clip: cs.webkitBackgroundClip || cs.backgroundClip,
        image: cs.backgroundImage === 'none' ? null : 'gradient',
      }
    }
    return {
      messages: read('inMessages'),
      panel: read('inPanel'),
      plain: read('plainPanel'),
    }
  })()`)

  console.log(JSON.stringify(out, null, 2))

  const transparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'

  const results = [
    // The one that always worked, so a change to the shared rule shows here first.
    ['a name in the message list lets its gradient through',
      transparent(out.messages.color) && out.messages.image === 'gradient'],
    ['and so does the same name in the DM panel',
      transparent(out.panel.color) && out.panel.image === 'gradient'],
    ['the two agree', out.panel.color === out.messages.color],
    // A name with nothing chosen must still be readable - a "fix" that made
    // every name transparent would satisfy everything above.
    ['a name with no effect is still painted', !transparent(out.plain.color)],
  ]

  let bad = 0
  for (const [what, ok] of results) {
    if (!ok) bad += 1
    console.log((ok ? 'PASS ' : 'FAIL ') + what)
  }

  app.quit()
  process.exit(bad === 0 ? 0 : 1)
})
