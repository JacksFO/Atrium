/**
 * The update bar sits at the top, and the app moves out from under it.
 *
 * Asked for by name: a banner at the top of the desktop client when there is
 * an update for the app itself. It used to be a pill at the bottom among the
 * toasts - the right weight for "a message arrived", the wrong one for "there
 * is a new version of the program you are using".
 *
 * The risk in moving it is the obvious one: the shell is a grid a full
 * viewport tall, so a bar laid across the top covers the strip carrying the
 * server name and the channel. That is what this measures - not that the bar
 * is there, but that nothing is underneath it.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
const css = ['apps/web/src/app.css']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')

const tokens = `:root{--glass:#181c22;--glass-2:#1b2027;--glass-solid:#181c22;--blur:blur(8px);
  --line:#2b3138;--line-soft:#22262c;--raise:#20252c;--raise-2:#272d35;--text:#e7ecf2;
  --text-dim:#9aa6b2;--text-faint:#6b7683;--blue:#4b8cff;--cyan:#37d5e8;--blue-ink:#04121f;
  --red:#e5484d;--cyan-line:#2c8f9c;--cyan-glow:0 0 8px #37d5e8;--edge-hi:none;--radius:12px;
  --radius-s:8px;--font-display:sans-serif;--ambient:#0b0f14}
  body{margin:0;background:#111}
  /*
   * A title bar of its own, the way the packaged shell has one.
   *
   * env(titlebar-area-height) is zero in a plain window and cannot be set
   * from a test, so everything measured here used to be measured with no
   * title bar at all - which is why this passed for weeks on a layout where
   * the bar and the app overlapped by exactly its height in the only build
   * that has one. The app reads the same custom property, so setting it is
   * the whole of the simulation.
   */
  :root{--titlebar:40px}`

const page = (withBar) => `<!doctype html><meta charset="utf-8"><title>bar</title>
<style>${tokens}\n${css}</style>
<div class="app">
  <div class="chat"><div class="chat-head" id="head">Atrium / general</div></div>
  <div class="topbar" id="strip">Atrium / general</div>
  <div>channels</div><div>messages</div><div>members</div>
</div>
<div class="settings" id="settings"><div class="set-nav">Profile</div><div>Connection</div></div>
${withBar ? `<div class="update-banner" id="bar">
  <div class="ub-text">Version 0.2.17 is ready.</div>
  <div class="ub-actions"><button class="ub-go" id="go">Restart now</button><button class="ub-later" id="later">Later</button></div>
</div>` : ''}`

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: -4000, y: 0, focusable: false, width: 1200, height: 800 })

  // --- without a bar, nothing is moved ------------------------------------
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(false)))
  const plain = await win.webContents.executeJavaScript(`(() => {
    const a = document.querySelector('.app').getBoundingClientRect()
    return { top: Math.round(a.top), height: Math.round(a.height) }
  })()`)
  check('with no update, the app starts at the top', plain.top === 0, plain)

  // --- with one, it is at the top and the app is below it ------------------
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(true)))
  const measured = await win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement
    const bar = document.getElementById('bar')
    // What the component does: mark the document and publish the height.
    root.classList.add('has-update-bar')
    root.style.setProperty('--update-bar', Math.round(bar.getBoundingClientRect().height) + 'px')
    const b = bar.getBoundingClientRect()
    const a = document.querySelector('.app').getBoundingClientRect()
    const strip = document.getElementById('strip').getBoundingClientRect()
    return {
      barTop: Math.round(b.top), barHeight: Math.round(b.height),
      barLeft: Math.round(b.left), barRight: Math.round(b.right),
      viewport: window.innerWidth,
      appTop: Math.round(a.top), appBottom: Math.round(a.bottom),
      stripTop: Math.round(strip.top),
      viewportHeight: window.innerHeight,
      settingsTop: Math.round(document.getElementById('settings').getBoundingClientRect().top),
      headTop: Math.round(document.getElementById('head').getBoundingClientRect().top),
      titlebar: parseInt(getComputedStyle(root).getPropertyValue('--titlebar')) || 0,
      /*
       * What a click at the middle of each button actually reaches.
       *
       * Dispatching one on the element proves the handler runs, not that a
       * person can get to it - and getting to it is the whole of what was
       * reported.
       *
       * This half only catches something painted over the button. The drag
       * region is not in the page at all: it is a shape handed to the
       * operating system, taken from this same layout, and a press inside it
       * never reaches the document to be hit-tested. That is the fault that
       * was reported, and the no-drag check below is the one that catches
       * it - this one stays green through it.
       */
      hits: ['go', 'later'].map((id) => {
        const el = document.getElementById(id)
        const r = el.getBoundingClientRect()
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return { id, reached: !!at && (at === el || el.contains(at)), got: at && (at.id || at.className) }
      }),
      // And whether the bar is allowed to take its own clicks at all.
      barDrag: getComputedStyle(bar).webkitAppRegion || getComputedStyle(bar).getPropertyValue('-webkit-app-region'),
    }
  })()`)
  console.log('    ' + JSON.stringify(measured))

  check('and spans the whole width',
    measured.barLeft === 0 && measured.barRight === measured.viewport,
    [measured.barLeft, measured.barRight, measured.viewport])

  /*
   * The heart of it. The strip underneath carries the server name and the
   * channel, and a bar laid over it would hide exactly that.
   */
  check('the bar clears the title bar the window draws',
    measured.barTop === measured.titlebar, { barTop: measured.barTop, titlebar: measured.titlebar })
  check('the app starts below the bar, not underneath it',
    measured.appTop >= measured.barTop + measured.barHeight,
    { appTop: measured.appTop, barBottom: measured.barTop + measured.barHeight })
  check('and the strip it carries is clear of it',
    measured.stripTop >= measured.barTop + measured.barHeight,
    { strip: measured.stripTop, barBottom: measured.barTop + measured.barHeight })

  /*
   * The header is the window's drag handle, and a drag region is a shape the
   * operating system is handed from this layout - so the bar lying across it
   * meant every press on the bar was taken as a grab of the title bar. The
   * buttons were drawn, lit up under the pointer, and did nothing.
   */
  check('and so is the header, which is what drags the window',
    measured.headTop >= measured.barTop + measured.barHeight,
    { head: measured.headTop, barBottom: measured.barTop + measured.barHeight })

  /*
   * Settings is fixed to all four edges rather than living inside the app, so
   * moving the app down is something it never sees.
   */
  check('a full-window screen makes room for it too',
    measured.settingsTop >= measured.barTop + measured.barHeight,
    { settings: measured.settingsTop, barBottom: measured.barTop + measured.barHeight })

  // The buttons, reached the way a press reaches them.
  for (const hit of measured.hits) {
    check(`the ${hit.id === 'go' ? 'Restart now' : 'Later'} button can actually be pressed`,
      hit.reached === true, hit)
  }
  check('and the bar is not part of what drags the window',
    measured.barDrag === 'no-drag', measured.barDrag)

  // And the window still ends where the window ends - no scrollbar from an
  // app that is now a bar taller than the screen.
  check('the app still fits the window',
    measured.appBottom <= measured.viewportHeight + 1,
    { bottom: measured.appBottom, viewport: measured.viewportHeight })

  // --- and taking it away puts everything back ----------------------------
  const after = await win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement
    root.classList.remove('has-update-bar')
    root.style.removeProperty('--update-bar')
    const a = document.querySelector('.app').getBoundingClientRect()
    return { top: Math.round(a.top), height: Math.round(a.height) }
  })()`)
  check('dismissing it leaves the app where it was', after.top === 0, after)

  console.log('\n  ' + (bad === 0 ? 'the update bar sits above the app' : bad + ' wrong'))
  win.destroy()
  app.quit()
  process.exit(bad === 0 ? 0 : 1)
})
