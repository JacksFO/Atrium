/**
 * Changing GIF category swaps the pictures; it does not empty the panel first.
 *
 * Reported: "when changing the category in the gif menu it does like an
 * annoying refresh thing where the box goes away then pops back etc, looks
 * janky."
 *
 * The grid was emptied the instant a category was clicked, so the panel
 * collapsed to a line of text, waited for the request, and sprang back to
 * full height. Two jumps and a flash of "Searching..." for something that
 * arrives in a couple of hundred milliseconds.
 *
 * The provider is stubbed inside the page rather than asked for real. That is
 * not to avoid the network - it is so the slow part can be held open on
 * purpose. The whole question is what the panel looks like *during* the wait,
 * and a real request that finishes in 200ms is a window too narrow to catch.
 */
const { signIn } = require('../lib.cjs')

/* Answers /api/gifs after a delay this controls, with distinguishable sets. */
const STUB = (delayMs) => `(() => {
  const real = window.fetch
  window.__gifCalls = 0
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('/api/gifs')) {
      window.__gifCalls++
      const q = (url.match(/[?&]q=([^&]*)/) || [])[1] || 'trending'
      return new Promise((resolve) => setTimeout(() => resolve(new Response(
        JSON.stringify({ provider: 'giphy', gifs: Array.from({ length: 8 }, (_, i) => ({
          id: q + '-' + i,
          preview: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
          mp4: '', still: '', width: 200, height: 200, description: q + ' ' + i,
        })) }),
        { status: 200, headers: { 'content-type': 'application/json' } })), ${delayMs}))
    }
    return real(input, init)
  }
  return 1 })()`

const GRID = `(() => {
  const grid = document.querySelector('.gifgrid')
  if (!grid) return { open: false }
  const r = grid.getBoundingClientRect()
  return {
    open: true,
    cells: grid.querySelectorAll('.gifcell, .gifgrid > button').length,
    height: Math.round(r.height),
    searching: /Searching/.test(grid.textContent || ''),
    firstDescription: (grid.querySelector('img, video') || {}).alt || '',
  }
})()`

module.exports = {
  name: 'gif-category-swap',
  width: 1280,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1200)

    await js(STUB(700))

    // ---- open the picker and let the first set land ----
    await js(`(() => {
      const b = document.querySelector('.cmp [aria-label="GIF"]')
      if (b) b.click()
      return 1 })()`)
    console.log('      button: ' + JSON.stringify(await js(
      `(() => { const b = document.querySelector('.cmp [aria-label="GIF"]')
        return { there: !!b, disabled: b ? b.disabled : null,
                 ics: [...document.querySelectorAll('.cmp .ic')].map((x) => x.getAttribute('aria-label')),
                 gifs: !!document.querySelector('.gifs') } })()`)))
    await until('the grid', `document.querySelectorAll('.gifgrid').length > 0`, 8000)
    await wait(1400)

    const first = await js(GRID)
    console.log('      first set:  ' + JSON.stringify(first))
    /*
     * The precondition. With an empty grid every claim below is true of a
     * panel that never had anything in it.
     */
    check('the panel has pictures in it', first.cells > 0, first)
    check('and a real height', first.height > 100, first)

    /*
     * ---- ask for a different set, and look DURING the wait ----
     *
     * By searching rather than by clicking a category: this picker offers a
     * box to type in rather than a row of chips. The question is the same
     * and is the one that was reported - what the panel does in the second
     * between asking for a new set and getting it.
     */
    await js(`(() => {
      const box = document.querySelector('.gifh input')
      if (!box) return 0
      const set = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set
      set.call(box, 'laugh')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      return 1 })()`)
    /* Well inside the 700ms the stub takes, so this is the middle of the swap. */
    await wait(220)

    const during = await js(GRID)
    console.log('      mid-swap:   ' + JSON.stringify(during))
    check('the pictures are still there while the next set is fetched',
      during.cells > 0, during)
    check('so the panel does not collapse and spring back',
      Math.abs(during.height - first.height) < 40,
      { before: first.height, during: during.height })
    check('and it never flashes "Searching"', during.searching === false, during)

    // ---- and the new set does arrive ----
    await wait(1200)
    const after = await js(GRID)
    console.log('      after:      ' + JSON.stringify(after))
    check('the new category is what is showing', after.cells > 0, after)
    check('and it really did fetch again',
      (await js(`window.__gifCalls`)) >= 2, await js(`window.__gifCalls`))
  },
}
