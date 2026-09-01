/**
 * The card that says what an update changed stays dismissible.
 *
 * A release body is whatever somebody typed on a release page, so this card
 * has no idea how tall its contents are - and it is the one thing standing
 * between somebody and the app they just opened. The failure worth guarding
 * is the obvious one: a long release pushing the button off the bottom, or
 * off the screen, leaving a card that cannot be got rid of by clicking
 * anything.
 *
 * Two releases: a short one, and one with two dozen lines in it, which is the
 * most the parser will hand over.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
const css = ['apps/client/src/app.css', 'apps/client/src/stage1.css',
  'apps/client/src/responsive.css']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')

const tokens = `:root{--glass:#181c22;--glass-2:#1b2027;--glass-solid:#181c22;--blur:blur(8px);
  --line:#2b3138;--line-soft:#22262c;--raise:#20252c;--raise-2:#272d35;--text:#e7ecf2;
  --text-dim:#9aa6b2;--text-faint:#6b7683;--blue:#4b8cff;--cyan:#37d5e8;--blue-ink:#04121f;
  --red:#e5484d;--cyan-line:#2c8f9c;--edge-hi:none;--shadow-pop:none;--radius:12px;
  --radius-s:8px;--radius-l:16px;--font-display:sans-serif;--font-mono:monospace;--dim:#8b949e}
  body{margin:0;background:#111}`

const card = (id, lines) => `<div class="scrim whatsnew-scrim" id="${id}-scrim">
  <div class="whatsnew" id="${id}">
    <div class="wn-top"><span class="wn-badge">Updated</span><span class="wn-version">0.2.30</span></div>
    <h2 class="wn-title">What changed</h2>
    <div class="wn-body">${lines}</div>
    <button class="wn-go">Get on with it</button>
  </div>
</div>`

const item = (t) => `<div class="wn-item"><span class="wn-dot"></span>${t}</div>`

const shortOne = card('short',
  '<div class="wn-h">Fixed</div>'
  + item('The incoming call is a marimba and every sound is in tune')
  + item('Avatars and banners stop moving when you tab out')
  + '<div class="wn-h" id="second">Added</div>'
  + item('The message box grows downwards as you type'))

/* Two dozen lines, which is what releasenotes.ts caps at - so this is the
   tallest card the app can ever produce, not merely a big one. */
const longOne = card('long',
  '<div class="wn-h">Fixed</div>'
  + Array.from({ length: 12 }, (_, i) =>
    item(`Something that was wrong and is now right, number ${i + 1}`)).join('')
  + '<div class="wn-h">Added</div>'
  + Array.from({ length: 10 }, (_, i) =>
    item(`Something that was not there before, number ${i + 1}`)).join(''))

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  /* A laptop. A card that only fits a big screen is the same bug reported
     later by somebody with a smaller one. */
  const win = new BrowserWindow({ show: true, useContentSize: true, width: 1200, height: 720 })

  const measure = async (html) => {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<!doctype html><meta charset="utf-8"><title>whatsnew</title>
       <style>${tokens}\n${css}</style>${html}`))
    await new Promise((r) => setTimeout(r, 350))
    return await win.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.whatsnew')
      const body = document.querySelector('.wn-body')
      const go = document.querySelector('.wn-go')
      const box = (el) => {
        const r = el.getBoundingClientRect()
        return { top: Math.round(r.top), bottom: Math.round(r.bottom),
                 height: Math.round(r.height), width: Math.round(r.width) }
      }
      return {
        card: box(card), body: box(body), go: box(go),
        viewport: window.innerHeight,
        bodyScrolls: body.scrollHeight > body.clientHeight + 1,
        cardScrolls: card.scrollHeight > card.clientHeight + 1,
        /* What a click at the middle of the button would actually hit. */
        reaches: (() => {
          const r = go.getBoundingClientRect()
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return !!el && (el === go || go.contains(el))
        })(),
      }
    })()`)
  }

  const short = await measure(shortOne)
  console.log('  short: ' + JSON.stringify(short))

  /*
   * Reported: "it's kinda hard to tell where the breaks are". A heading has
   * to be visibly a break rather than another line - so what is measured is
   * the gap above it against the gap between two ordinary lines, and whether
   * there is a rule drawn there at all.
   */
  const breaks = await win.webContents.executeJavaScript(`(() => {
    const h = document.getElementById('second')
    const before = h.previousElementSibling
    const items = [...document.querySelectorAll('#short .wn-item')]
    const gapBetweenItems = Math.round(
      items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().bottom)
    const style = getComputedStyle(h)
    return {
      gapAboveHeading: Math.round(h.getBoundingClientRect().top - before.getBoundingClientRect().bottom),
      gapBetweenItems,
      rule: style.borderTopWidth,
      ruleColour: style.borderTopColor,
      firstHeadingHasRule: getComputedStyle(document.querySelector('#short .wn-h')).borderTopWidth,
    }
  })()`)
  console.log('  breaks: ' + JSON.stringify(breaks))
  check('a section break has a rule drawn on it',
    breaks.rule !== '0px' && breaks.ruleColour !== 'rgba(0, 0, 0, 0)', breaks)
  /* Three times the space between two ordinary lines, so the eye lands on it
     as a break rather than reading on. */
  check('and stands well clear of the lines above it',
    breaks.gapAboveHeading > breaks.gapBetweenItems * 2.5,
    { aboveHeading: breaks.gapAboveHeading, betweenItems: breaks.gapBetweenItems })
  /* The first one has nothing to be separated from. */
  check('but the first heading is not given a rule to nothing',
    breaks.firstHeadingHasRule === '0px', breaks.firstHeadingHasRule)
  check('a short release makes a card that fits',
    short.card.bottom <= short.viewport && short.card.top >= 0, short.card)
  check('with nothing scrolling', short.bodyScrolls === false && short.cardScrolls === false, short)
  check('and a button you can press', short.reaches === true, short.go)

  const long = await measure(longOne)
  console.log('  long:  ' + JSON.stringify(long))
  check('the tallest release the app can produce still fits the window',
    long.card.top >= 0 && long.card.bottom <= long.viewport,
    { card: long.card, viewport: long.viewport })
  /*
   * The part that matters. The list is allowed to scroll - a long release has
   * to go somewhere - but the card around it must not, because the button
   * lives outside the list and scrolling the card is how it leaves.
   */
  check('by scrolling the list of changes', long.bodyScrolls === true, long.bodyScrolls)
  check('and not the card, which is what holds the button',
    long.cardScrolls === false, long.cardScrolls)
  check('so the button is still there', long.go.bottom <= long.viewport, long.go)
  check('and can still be pressed', long.reaches === true, long.go)

  console.log(bad === 0 ? '\n  the card can always be got rid of' : `\n  ${bad} wrong`)
  win.destroy()
  app.exit(bad === 0 ? 0 : 1)
})
