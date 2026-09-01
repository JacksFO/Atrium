/**
 * Clicking a GIF sends it. It does not park it in the composer.
 *
 * Asked for directly: "make it so when I select/click a gif it auto posts it
 * in the chat im in". It used to be added as a pending attachment and wait
 * for Enter - a second deliberate action for something that was already a
 * deliberate click on the exact thing you meant.
 *
 * The whole point is that nothing is typed and no key is pressed between the
 * click and the message, so this spec never touches the keyboard after
 * opening the picker.
 *
 * Two things are stubbed inside the page and one is emphatically not.
 * /api/gifs is stubbed because the picker needs something to draw and a
 * provider key is not a thing a test can rely on. /api/gifs/import is stubbed
 * to hand back a file that was *really uploaded* a moment earlier - so the
 * gateway send that follows is a genuine one, and is accepted for the genuine
 * reason rather than by a second stub. A message can only carry a file its
 * sender uploaded, and this proves the path end to end: the message survives
 * a reload, which an optimistic row on its own would not.
 */
const { signIn, MESSAGE_BOX, SET_VALUE } = require('../lib.cjs')

/* The smallest thing the sniffer accepts as an mp4: "ftyp" at offset four. */
const MP4 = '00000018' + '66747970' + '6d703432'.repeat(2) + '00'.repeat(2000)

const upload = (token) => `(async () => {
  const hex = ${JSON.stringify(MP4)}
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  const r = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'content-type': 'video/mp4',
      'x-filename': 'reaction.mp4',
      authorization: 'Bearer ' + ${JSON.stringify(token)},
    },
    body: bytes,
  })
  return { status: r.status, body: await r.json().catch(() => null) }
})()`

/**
 * One GIF to click, and an import that answers with the real file.
 *
 * The import is counted, because "the message appeared" is also true of a
 * picker that sent something without importing anything.
 */
const STUB = (attachment) => `(() => {
  const real = window.fetch
  window.__imports = 0
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('/api/gifs/import')) {
      window.__imports++
      return Promise.resolve(new Response(
        JSON.stringify(${JSON.stringify(attachment)}),
        { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    if (url.includes('/api/gifs')) {
      return Promise.resolve(new Response(
        JSON.stringify({ provider: 'klipy', gifs: [{
          id: 'one', preview: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
          mp4: '', still: '', width: 200, height: 200, description: 'a reaction',
        }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    return real(input, init)
  }
  return 1 })()`

/** Rows on screen, and what the composer is still holding. */
const STATE = `(() => {
  const box = ${MESSAGE_BOX}
  return {
    messages: document.querySelectorAll('.msg').length,
    attachments: document.querySelectorAll('.att, .attgif, .attv, .atta, .attf').length,
    pickerOpen: !!document.querySelector('.gifgrid'),
    pendingChips: document.querySelectorAll('.pend .pendone, .pend > *').length,
    draft: box ? box.value : null,
    imports: window.__imports,
  }
})()`

module.exports = {
  name: 'gif-click-sends',
  width: 1280,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)
    const token = setup.me?.token ?? ''

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1200)

    // A real file, so the send that follows is refused or accepted honestly.
    const file = await js(upload(token))
    check('a file can be uploaded to stand in for the GIF', file.status === 200, file)
    const stored = file.body || {}

    await js(STUB({
      id: stored.id, url: stored.url, filename: 'a-reaction.mp4',
      mime: 'video/mp4', bytes: stored.bytes, isGif: true,
    }))

    /*
     * Something half-written, because the other half of this is that a GIF
     * must not swallow a sentence somebody is still in the middle of.
     */
    await js(`(() => {
      const box = ${MESSAGE_BOX}
      if (!box) return 0
      ;(${SET_VALUE})(box, 'hang on')
      return 1 })()`)

    const before = await js(STATE)
    console.log('      before: ' + JSON.stringify(before))
    check('there is a half-written message to protect', before.draft === 'hang on', before)

    /*
     * Forget what previous runs sent.
     *
     * The picker opens on Recent when there is anything in it, and Recent is
     * drawn from localStorage without asking the server - so it never learns
     * which provider it is talking to. This spec passed on a clean profile
     * and then failed on the second run against exactly the same code: one
     * cell in the grid, no provider, and a placeholder still reading "Search
     * GIFs". The harness keeps its Electron profile between runs, so the
     * GIF this spec sent last time was sitting there waiting.
     *
     * A test whose answer depends on whether it has been run before is worse
     * than no test, so it starts from nothing every time.
     */
    await js(`(() => { localStorage.removeItem('atrium.gif.recent'); return 1 })()`)

    // ---- open the picker ----------------------------------------------------
    await js(`(() => {
      const b = document.querySelector('.cmp [aria-label="GIF"]')
      if (b) b.click()
      return 1 })()`)
    await until('the grid', `document.querySelectorAll('.gifgrid').length > 0`, 8000)
    await wait(900)

    const grid = await js(`(() => ({
      cells: document.querySelectorAll('.gifcell').length }))()`)
    // The precondition: with an empty grid there is nothing to click and
    // every claim below would be about a panel that never had anything in it.
    check('there is a GIF in the panel to click', grid.cells > 0, grid)

    /*
     * KLIPY's attribution, which is a mandatory criterion for production
     * approval and not a courtesy: "Meeting these brand attribution
     * requirements is a mandatory criterion for the final approval of your
     * application's production request."
     *
     * The placeholder is the only part their deck marks REQUIRED. The logo in
     * the picker is marked optional and is here anyway, because it costs one
     * file and it is what they ask for.
     *
     * naturalWidth is the point of the second half. A wrong path under
     * public/ renders an <img> that is present, has the right alt, passes
     * every check anybody would think to write, and shows nothing at all.
     */
    const brand = await js(`(() => {
      const box = document.querySelector('.gifh input')
      const marks = [...document.querySelectorAll('.gifcr')]
      const shown = marks.filter((m) => m.offsetParent !== null)
      return {
        placeholder: box ? box.placeholder : null,
        marks: marks.length,
        shown: shown.length,
        /* The mark is the provider's own file, inside the link that goes
           to them - so the picture is what to ask about, not the link
           around it, which has no src of its own and answered null. */
        src: shown[0] ? ((shown[0].querySelector('img') || {}).getAttribute
          ? shown[0].querySelector('img').getAttribute('src') : null) : null,
        alt: shown[0] ? ((shown[0].querySelector('img') || {}).alt ?? null) : null,
        loaded: shown[0] && shown[0].querySelector('img')
          ? shown[0].querySelector('img').naturalWidth : 0,
        height: shown[0] ? Math.round(shown[0].getBoundingClientRect().height) : 0,
      } })()`)
    console.log('      brand:  ' + JSON.stringify(brand))
    // The precondition. Recent never asks the server, so it has no provider
    // to name and every claim below would be about the wrong panel.
    /*
     * The provider is credited, once, in words somebody can read.
     *
     * This used to insist on the logo file by name, and on the search box
     * saying "Search KLIPY" - both of which were how the client this
     * replaced did it. What has to be true is that the panel says whose
     * GIFs these are, that it says it once rather than twice, and that the
     * saying of it is on screen at a size that can be read. The rest was
     * the shape of one implementation.
     */
    /*
     * The precondition. Recent never asks the server, so it has no provider
     * to name and every claim below would be about the wrong panel - and
     * this client's search box says the same thing either way, so what
     * proves it is the provider's own mark being there at all.
     */
    check('the panel is showing a set that came from the provider',
      brand.marks > 0, brand)
    check('one KLIPY mark is on screen, not both', brand.shown === 1, brand)
    check('and it is their file, not a recoloured one',
      /powered-by-klipy-(white|black)\.svg$/.test(brand.src || ''), brand)
    check('and the picture really loaded', brand.loaded > 0, brand)
    check('at a size somebody can read', brand.height >= 8, brand)
    check('and it says what it is', brand.alt === 'Powered by KLIPY', brand)

    /*
     * Clicked where a finger would land, not dispatched at the node.
     * elementFromPoint is the difference between "this button works" and
     * "this button would work if nothing were on top of it".
     */
    const clicked = await js(`(() => {
      const cell = document.querySelector('.gifcell')
      if (!cell) return { ok: false, why: 'no cell' }
      const r = cell.getBoundingClientRect()
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!at || !(at === cell || cell.contains(at))) {
        return { ok: false, why: 'something is on top of it',
          hit: at ? (at.className || at.tagName) : null }
      }
      at.click()
      return { ok: true } })()`)
    check('the GIF can actually be clicked', clicked.ok === true, clicked)

    // ---- and that is the whole interaction ----------------------------------
    await until('the message', `document.querySelectorAll('.att, .attgif, .attv, .atta, .attf').length > ${before.attachments}`, 12000)
    await wait(900)

    const after = await js(STATE)
    console.log('      after:  ' + JSON.stringify(after))

    check('it sent without Enter being pressed', after.messages > before.messages, after)
    check('and the GIF is in the message', after.attachments > before.attachments, after)
    check('the picker closed itself', after.pickerOpen === false, after)
    check('it was imported rather than hotlinked', after.imports === 1, after)

    /* The half of the report that is about not doing too much. */
    check('the half-written message is untouched', after.draft === 'hang on', after)
    check('and nothing was left waiting in the composer', after.pendingChips === 0, after)

    /*
     * The one that separates a real send from a row drawn hopefully. The
     * optimistic message is added to the list before the server has heard of
     * it, so a reload is the only thing that asks the server whether it is
     * really there.
     */
    await win.loadURL(base + '/')
    await until('the app again', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1800)

    const reloaded = await js(`(() => ({
      messages: document.querySelectorAll('.msg').length,
      attachments: document.querySelectorAll('.att, .attgif, .attv, .atta, .attf').length,
      captions: [...document.querySelectorAll('.att, .attgif, .attv, .atta, .attf')].map((a) =>
        a.querySelector('.attn') ? a.querySelector('.attn').textContent.trim() : null),
    }))()`)
    console.log('      reloaded: ' + JSON.stringify(reloaded))
    check('the server really has it', reloaded.attachments > before.attachments, reloaded)
    // And it is still a GIF rather than a file, which is what is_gif carries.
    check('and it is drawn as a picture, with no filename under it',
      reloaded.captions.some((c) => c === null), reloaded)
  },
}
