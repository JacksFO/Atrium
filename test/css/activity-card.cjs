/**
 * The card that says what somebody is doing, measured.
 *
 * Written from screenshots of the shape this was asked to match, and never
 * once seen on screen while it was written - so what is checked here is the
 * set of things that would be wrong in a way a person notices immediately: a
 * long name pushing the card wider than the profile it sits in, a tile that
 * is not square, a progress bar that does not fill to where it says, and
 * numbers that shift sideways as they count.
 *
 * Two widths, because the same card is used in two columns: the profile
 * popout, and the narrower panel beside a conversation. The narrow one is
 * where a long track title has somewhere to go wrong.
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
  --red:#e5484d;--cyan-line:#2c8f9c;--edge-hi:none;--shadow-pop:none;--radius:12px;
  --radius-s:8px;--radius-l:16px;--font-display:sans-serif;--font-mono:monospace;--dim:#8b949e}
  body{margin:0;background:#111}`

/*
 * A line as Marquee renders it.
 *
 * `shift` is what the component works out by measuring - one copy of the text
 * plus the gap behind it - and is 0 for a name that fits, which renders as
 * one copy with nothing moving. Written by hand here because this harness has
 * no React in it; what is being checked is that the stylesheet does the right
 * thing with each of the two states, not that the measuring is right.
 */
const line = (cls, text, shift = 0) => shift
  ? `<div class="${cls} marq-box" title="${text}">
       <span class="marq is-running" style="--marq-shift:${shift}px;--marq-gap:44px;--marq-time:${(shift / 34 / 0.88).toFixed(2)}s">
         <span class="marq-copy">${text}</span><span class="marq-copy" aria-hidden="true">${text}</span>
       </span>
     </div>`
  : `<div class="${cls} marq-box" title="${text}">
       <span class="marq"><span class="marq-copy">${text}</span></span>
     </div>`

/* A game: a clock and no bar. A track: a bar and no clock. Long names on
   both, because a short one proves nothing about a column. */
const game = (name) => `<div class="act-card">
  <div class="act-head">Playing a game</div>
  <div class="act-body">
    <div class="act-art is-blank"><span class="act-initials">ET</span></div>
    <div class="act-lines">
      ${line('act-name', name)}
      <div class="act-since">01:03 elapsed</div>
    </div>
  </div>
</div>`

const music = (name) => `<div class="act-card">
  <div class="act-head">Listening to Spotify</div>
  <div class="act-body">
    <div class="act-art is-blank is-music"><svg width="22" height="22"></svg></div>
    <div class="act-lines">
      ${line('act-name', name)}
      ${line('act-detail', 'by An Artist With A Rather Long Name')}
      <div class="act-bar-wrap">
        <div class="act-bar"><i style="width:40%"></i></div>
        <div class="act-times"><span>1:23</span><span>3:45</span></div>
      </div>
    </div>
  </div>
</div>`

const LONG = 'Escape from Tarkov: Arena of Extremely Long Edition Names'

const page = `<!doctype html><meta charset="utf-8"><title>card</title>
<style>${tokens}\n${css}</style>
<div class="profile" id="profile">
  <div class="profile-card" id="wide">${game(LONG)}${music(LONG)}</div>
</div>
<div style="width:240px" id="narrowOuter">
  <div class="profile-card" id="narrow">${music(LONG)}</div>
</div>
<div class="profile" id="scrollingProfile">
  <div class="profile-card">
    <div class="act-card"><div class="act-body"><div class="act-lines">
      ${line('act-name', LONG, 420)}
    </div></div></div>
  </div>
</div>`

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: -4000, y: 0, focusable: false, useContentSize: true, width: 900, height: 800 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
  await new Promise((r) => setTimeout(r, 400))

  const measured = await win.webContents.executeJavaScript(`(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return {
      w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), right: Math.round(r.right) } }
    const wide = document.getElementById('wide')
    const narrow = document.getElementById('narrow')
    const art = wide.querySelector('.act-art')
    const name = wide.querySelector('.act-name')
    const bar = wide.querySelector('.act-bar')
    const fill = wide.querySelector('.act-bar i')
    const since = wide.querySelector('.act-since')
    const narrowName = narrow.querySelector('.act-name')
    return {
      cardInner: box(wide),
      art: box(art),
      name: box(name),
      nameOverflows: name.scrollWidth > name.clientWidth,
      nameClipped: getComputedStyle(name).overflow,
      bar: box(bar), fill: box(fill),
      sinceNums: getComputedStyle(since).fontVariantNumeric,
      widest: Math.max(...[...wide.querySelectorAll('*')]
        .filter((e) => !e.closest('.marq-box'))
        .map((e) => e.getBoundingClientRect().right)),
      // What actually spills: a box wanting to be wider than it is given.
      cardSpills: wide.scrollWidth > wide.clientWidth,
      narrowCard: box(narrow),
      narrowWidest: Math.max(...[...narrow.querySelectorAll('*')]
        .filter((e) => !e.closest('.marq-box'))
        .map((e) => e.getBoundingClientRect().right)),
      narrowSpills: narrow.scrollWidth > narrow.clientWidth,
      narrowNameOverflows: narrowName.scrollWidth > narrowName.clientWidth,
      timesApart: (() => {
        const t = wide.querySelectorAll('.act-times span')
        return Math.round(t[1].getBoundingClientRect().left - t[0].getBoundingClientRect().right)
      })(),
      /*
       * The scrolling one, driven rather than looked at.
       *
       * Seeking the animation and reading the transform back is the only way
       * to know it goes anywhere: a rule with a keyframe name in it looks
       * identical whether the keyframes move the element or not.
       */
      scrolling: (() => {
        const el = document.querySelector('#scrollingProfile .marq')
        const anims = el.getAnimations()
        const at = (fraction) => {
          anims[0].currentTime = anims[0].effect.getTiming().duration * fraction
          const m = new DOMMatrix(getComputedStyle(el).transform)
          return Math.round(m.m41)
        }
        return {
          running: anims.length,
          seconds: Math.round(anims[0].effect.getTiming().duration) / 1000,
          still: at(0.12),
          halfway: at(0.56),
          moved: at(0.999),
          gap: Math.round(parseFloat(getComputedStyle(el).columnGap)),
          clipped: getComputedStyle(el.parentElement).overflow,
        }
      })(),
    } })()`)
  console.log('  ' + JSON.stringify(measured))

  check('the tile is square', measured.art.w === measured.art.h, measured.art)
  check('and the size it was designed at', measured.art.w === 58, measured.art.w)

  /*
   * The one that matters. A name longer than the column must be cut with an
   * ellipsis, not push the card wider than the profile holding it - which is
   * what min-width on a flex child is for and what its absence looks like.
   */
  check('a long name is clipped rather than widening the card',
    measured.widest <= measured.cardInner.right + 1 && !measured.cardSpills,
    { widest: measured.widest, cardRight: measured.cardInner.right, spills: measured.cardSpills })
  check('and it really is being clipped', measured.nameOverflows === true, measured.nameOverflows)
  check('by the line it sits on', measured.nameClipped === 'hidden', measured.nameClipped)

  /* --- and a name that does not fit is scrolled, not cut off ------------- */
  check('a name too long for the line gets exactly one animation',
    measured.scrolling.running === 1, measured.scrolling.running)
  check('it holds still at the start, so the beginning can be read',
    measured.scrolling.still === 0, measured.scrolling.still)
  /* Halfway through the moving part it is halfway along, which is what makes
     it a constant slide rather than an ease. */
  check('and slides at an even pace',
    Math.abs(measured.scrolling.halfway + 210) <= 1, measured.scrolling.halfway)
  /* The whole point: it ends one copy plus one gap along, which is where the
     trailing copy began - so the text leaves left and the same text is
     already arriving from the right. 420 is the shift this line was given. */
  check('travelling the full copy-plus-gap, so the loop has no seam',
    Math.abs(measured.scrolling.moved + 420) <= 1, measured.scrolling.moved)
  check('the gap between the copies is the one the shift was measured with',
    measured.scrolling.gap === 44, measured.scrolling.gap)
  check('and the line still clips, so nothing spills out of the card',
    measured.scrolling.clipped === 'hidden', measured.scrolling.clipped)
  /* Constant speed, not constant duration: 420px at 34px a second, with the
     still part making up the rest of the loop. */
  check('it moves at a readable speed rather than to a fixed clock',
    Math.abs(measured.scrolling.seconds - 420 / 34 / 0.88) < 0.1, measured.scrolling.seconds)

  check('the bar fills to what it says', Math.abs(measured.fill.w - measured.bar.w * 0.4) <= 2,
    { fill: measured.fill.w, of: measured.bar.w })
  check('the two times sit at opposite ends', measured.timesApart > 100, measured.timesApart)
  check('and the counting numbers do not shift as they count',
    measured.sinceNums.includes('tabular-nums'), measured.sinceNums)

  // The narrow column beside a conversation, where it is tightest.
  check('it still fits the narrow panel',
    measured.narrowWidest <= measured.narrowCard.right + 1 && !measured.narrowSpills,
    { widest: measured.narrowWidest, cardRight: measured.narrowCard.right, spills: measured.narrowSpills })
  check('clipping the name there too', measured.narrowNameOverflows === true)

  console.log(bad === 0 ? '\n  the card fits where it is put' : `\n  ${bad} wrong`)
  win.destroy()
  app.exit(bad === 0 ? 0 : 1)
})
