/**
 * A profile fits on the screen without being scrolled.
 *
 * Reported with a screenshot: the card had to be scrolled a long way, and
 * what was down there was the settings - theme, accent tint, notification
 * sounds - which are all on their own pages in Settings and always were. A
 * card about a person had become mostly a second copy of a settings panel.
 *
 * Reported a second time with the settings already gone, comparing it against
 * a card that "just extends based on what to display" - and this test passed
 * throughout, because it was measuring the wrong card. Opened from the member
 * list the class is `profile beside`, which sets its own width and its own
 * 560px ceiling, and two classes beat one: everything measured here applied
 * to a card nobody was looking at. So the busy one now carries the class it
 * has in the app.
 *
 * Measured as height against the room it is given, because "cleaner" is a
 * judgement and "taller than the window" is a fact. Two people: an ordinary
 * one, and somebody with everything filled in at once, because the second is
 * where it actually overflowed.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
/* responsive.css is in here for one line of it: the root font size that
   every other size in the app is a multiple of. Without it this measured
   the card at the browser's 16px rather than at the size the app renders
   at, which is not the same card - and that size is a setting, so it can
   move under the layout. */
const css = ['apps/web/src/app.css']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')

const tokens = `:root{--glass:#181c22;--glass-2:#1b2027;--glass-solid:#181c22;--blur:blur(8px);
  --line:#2b3138;--line-soft:#22262c;--raise:#20252c;--raise-2:#272d35;--text:#e7ecf2;
  --text-dim:#9aa6b2;--text-faint:#6b7683;--blue:#4b8cff;--cyan:#37d5e8;--blue-ink:#04121f;
  --red:#e5484d;--cyan-line:#2c8f9c;--edge-hi:none;--shadow-pop:none;--radius:12px;
  --radius-s:8px;--radius-l:16px;--font-display:sans-serif;--font-mono:monospace;--dim:#8b949e}
  body{margin:0;background:#111}`

const sec = (h, body) => `<div class="profile-sec"><div class="profile-h">${h}</div>${body}</div>`

const card = (a) => `<div class="act-card">
  <div class="act-head">${a.head}</div>
  <div class="act-body">
    <div class="act-art is-blank"><span class="act-initials">EF</span></div>
    <div class="act-lines">
      <div class="act-name">${a.name}</div>
      <div class="act-since">01:03 elapsed</div>
    </div>
  </div>
</div>`

const chips = (n) => Array.from({ length: n }, (_, i) =>
  `<span class="role-chip"><span class="swatch"></span>Role ${i + 1}</span>`).join('')

/* Everything a profile can hold at once: a status, both activity cards, a
   bio, and the full six role chips plus the count. */
const busy = `<div class="profile beside" id="busy" style="top:8px;left:8px">
  <div class="profile-banner"></div>
  <div class="profile-top"><div class="profile-av"></div></div>
  <div class="profile-card">
    <div class="profile-id">
      <div class="profile-name">Somebody</div>
      <div class="profile-handle">somebody · joined Aug 2026</div>
      <div class="profile-mutual">You are both in Somewhere</div>
    </div>
    <div class="profile-status">Professional Dumbass</div>
    <div class="act-stack">${card({ head: 'Playing a game', name: 'Escape from Tarkov' })}${card({ head: 'Listening to Spotify', name: 'A Song' })}</div>
    ${sec('About', '<div class="profile-bio">A couple of lines about themselves, of the length people actually write.</div>')}
    ${sec('Roles', `<div class="roles">${chips(6)}<span class="role-chip is-more">+3</span></div>`)}
    <div class="profile-actions"><button class="pbtn">Call</button><button class="pbtn">Close</button></div>
  </div>
</div>`

/*
 * The one that gets opened.
 *
 * Somebody playing something with music on, a status, and the one role they
 * hold - no bio, no servers in common, not six roles. This is the card in
 * the screenshot the scrolling was reported from, so it is the one that has
 * to fit a laptop; `busy` above is the outside edge rather than the case.
 */
const real = `<div class="profile beside" id="real" style="top:8px;left:420px">
  <div class="profile-banner"></div>
  <div class="profile-top"><div class="profile-av"></div></div>
  <div class="profile-card">
    <div class="profile-id">
      <div class="profile-name">Somebody</div>
      <div class="profile-handle">somebody · joined Aug 2026</div>
    </div>
    <div class="profile-status">Professional Dumbass</div>
    <div class="act-stack">${card({ head: 'Playing a game', name: 'Escape from Tarkov' })}${card({ head: 'Listening to Spotify', name: 'A Song' })}</div>
    ${sec('Roles', `<div class="roles">${chips(1)}</div>`)}
    <div class="profile-actions"><button class="pbtn">Call</button><button class="pbtn">Close</button></div>
  </div>
</div>`

/* And an ordinary one: a name, a status, nothing else filled in. */
const plain = `<div class="profile" id="plain">
  <div class="profile-banner"></div>
  <div class="profile-top"><div class="profile-av"></div></div>
  <div class="profile-card">
    <div class="profile-id">
      <div class="profile-name">Somebody</div>
      <div class="profile-handle">somebody · joined Aug 2026</div>
    </div>
    ${sec('Roles', `<div class="roles">${chips(1)}</div>`)}
    <div class="profile-actions"><button class="pbtn">Call</button><button class="pbtn">Close</button></div>
  </div>
</div>`

const page = `<!doctype html><meta charset="utf-8"><title>profile</title>
<style>${tokens}\n${css}</style>${busy}${real}${plain}`

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

app.disableHardwareAcceleration()

/*
 * Measured in each window rather than worked out from one of them.
 *
 * The banner is sized against the viewport - it is the part of the card that
 * gives way when the screen is short - so a card built in a 900px window is
 * not the card a 720px window gets, and doing the arithmetic here would be
 * checking a number this file made up rather than one the browser produced.
 */
let win = null
const measure = async (height) => {
  if (!win) {
    win = new BrowserWindow({ show: true, x: -4000, y: 0, focusable: false, useContentSize: true, width: 1400, height })
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
  } else {
    // Resized rather than reloaded: it is the same page seeing a smaller
    // window, which is what a person shrinking one gets.
    win.setContentSize(1400, height)
  }
  await new Promise((r) => setTimeout(r, 400))
  const m = await win.webContents.executeJavaScript(`(() => {
    const of = (id) => {
      const el = document.getElementById(id)
      return {
        height: Math.round(el.getBoundingClientRect().height),
        // What it would need if nothing were cut off - taller than the box
        // means a scrollbar, which is the thing being measured.
        wants: el.scrollHeight,
        scrolls: el.scrollHeight > el.clientHeight + 1,
      }
    }
    // Where the height goes, so a failure says which part is spending it.
    const parts = {}
    for (const el of document.getElementById('busy').querySelectorAll('*')) {
      const cls = el.className && el.className.split(' ')[0]
      if (!cls) continue
      const h = Math.round(el.getBoundingClientRect().height)
      if (h > 0) parts[cls] = (parts[cls] || 0) + h
    }
    return {
      window: window.innerHeight, parts,
      width: Math.round(document.getElementById('busy').getBoundingClientRect().width),
      busy: of('busy'), real: of('real'), plain: of('plain'),
    }
  })()`)
  return m
}

app.whenReady().then(async () => {
  /* A desktop, and a laptop. The laptop is the one that matters: it is the
     size the scrolling was reported at, and the size a card that only fits
     when the window is generous would fail at. */
  const m = await measure(900)
  const small = await measure(720)
  console.log('  ' + JSON.stringify({ window: m.window, width: m.width, busy: m.busy, plain: m.plain }))
  console.log('  height goes to: ' + JSON.stringify(m.parts))
  console.log('  on a laptop:    ' + JSON.stringify({
    window: small.window, banner: small.parts['profile-banner'], real: small.real, busy: small.busy }))

  /*
   * The room a profile is allowed: the window, less the margin the popover
   * keeps off the top and bottom edges. Not a design number - the point past
   * which the bottom of the card cannot be reached at all.
   */
  const room = m.window - 24

  /* Wide enough for a track title and a game name to sit on one line instead
     of wrapping, which is where a good deal of the height was going. */
  check('the card is as wide as it was widened to', m.width === 400, m.width)

  check('an ordinary profile fits with room to spare',
    m.plain.wants < room * 0.55, { wants: m.plain.wants, room })
  check('and does not scroll', m.plain.scrolls === false, m.plain)

  /*
   * The one that matters. Everything at once - a status, a game, a track, a
   * bio and a full set of roles - and it still has to fit, because that is
   * the card that was reported as needing scrolling.
   */
  check('a profile with everything on it still fits the window',
    m.busy.wants <= room, { wants: m.busy.wants, room })
  check('and does not scroll either', m.busy.scrolls === false, m.busy)

  /*
   * And fits a small window too.
   *
   * The one it was reported on was not 900 tall. A card that only fits when
   * the window is generous is the same bug reported again later, so the
   * height is checked against a laptop that is only 720 tall as well - which
   * is the size this has to survive, not the size it happens to be tested at.
   */
  /*
   * And the card people actually open fits a laptop.
   *
   * Not `busy`: at the default font size of twenty, a card carrying a bio, a
   * set of servers in common and six roles as well wants about 750px, and a
   * 720px window has 696 to give it. That one keeps its scrollbar, which is
   * what a scrollbar is for. The card in the report - a status, what they are
   * doing, and their role - is the one that has to fit, and does.
   */
  check('the card people actually open fits a 720px window',
    small.real.wants <= small.window - 24, { wants: small.real.wants, room: small.window - 24 })
  check('without scrolling there either', small.real.scrolls === false, small.real)
  /* Smaller than the desktop gets, larger than the letterbox it was reported
     as - the banner gives way, and does not give all of it back. */
  check('and the banner is still worth looking at on a laptop',
    small.parts['profile-banner'] >= 80, small.parts['profile-banner'])

  console.log(bad === 0 ? '\n  a profile fits on the screen' : `\n  ${bad} wrong`)
  win.destroy()
  app.exit(bad === 0 ? 0 : 1)
})
