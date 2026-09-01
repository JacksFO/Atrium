/**
 * The permissions panel on a phone.
 *
 * Found by photographing the app rather than by measuring it: at 390px the
 * card ran off the right of the screen and took the allow/deny buttons with
 * it, so the one control the panel exists for could not be seen or reached.
 * Nothing in the suite was looking, because every check written for this
 * panel had been written at desktop width.
 *
 * Measured, not eyeballed. The screenshot is what found it; a number is what
 * says it is fixed and stays fixed.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'permissions-phone',
  width: 390,
  height: 844,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `!!document.querySelector('.navtog')`)
    await wait(1800)

    /*
     * The channel list is a drawer at this width, so it has to be opened
     * before a channel can be right-clicked. .nav-toggle is the button
     * phone-layout already proves is there and hittable.
     */
    await js(`(() => { document.querySelector('.navtog').click(); return 1 })()`)
    await wait(900)
    check('the drawer opens',
      await js(`!!document.querySelector('.shell[data-slid="nav"]')`) === true)

    const opened = await js(`(() => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /general/.test(r.textContent || ''))
      if (!row) return { hit: false, why: 'no channel row on screen' }
      const r = row.getBoundingClientRect()
      if (r.width === 0) return { hit: false, why: 'the row has no size' }
      const x = r.left + Math.min(30, r.width / 2), y = r.top + r.height / 2
      const el = document.elementFromPoint(x, y)
      if (!el) return { hit: false, why: 'nothing at that point' }
      el.dispatchEvent(new MouseEvent('contextmenu',
        { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      return { hit: true } })()`)
    check('a channel can be right-clicked on a phone', opened.hit === true, opened)
    await until('the menu', `!!document.querySelector('.ctx')`)

    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')]
        .find((x) => /^Permissions$/.test(x.textContent.trim()))
      if (b) b.click()
      return 1 })()`)
    await until('the panel', `document.querySelector('.modal.wide')?.dataset.loaded === '1'`)
    await wait(500)

    const box = await js(`(() => {
      const card = document.querySelector('.modal.wide')
      if (!card) return { open: false }
      const r = card.getBoundingClientRect()
      /* Whatever inside it is widest, so a failure names the culprit rather
         than only the symptom. */
      let worst = { cls: '', right: 0 }
      for (const el of card.querySelectorAll('*')) {
        const b = el.getBoundingClientRect()
        if (b.width > 0 && b.right > worst.right) {
          worst = { cls: (el.className || el.tagName).toString().slice(0, 40), right: Math.round(b.right) }
        }
      }
      return {
        open: true,
        vw: window.innerWidth,
        card: { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) },
        worst,
        pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
      } })()`)
    console.log('      card: ' + JSON.stringify(box))

    /*
     * The reason it used to overflow, pinned so it cannot come back.
     *
     * The card asked for a width and got it whatever the screen was, so a
     * panel written at desktop width ran off the right of a phone and took
     * the buttons it exists for with it. What stops that is the width the
     * card asks for being bounded by the window - read off the card rather
     * than off the stylesheet, so the rule that does it can change.
     */
    const track = await js(`(() => {
      const card = document.querySelector('.modal.wide')
      return {
        asked: getComputedStyle(card).width,
        vw: window.innerWidth,
      } })()`)
    console.log('      card width: ' + JSON.stringify(track))
    check('the card sizes itself to the screen, not to a desktop',
      parseFloat(track.asked) <= track.vw, track)
    check('the panel opens', box.open === true, box)
    check('the card fits the screen',
      box.card && box.card.left >= 0 && box.card.right <= box.vw, box.card)
    check('and nothing inside it is drawn off the edge',
      box.worst && box.worst.right <= box.vw, box.worst)
    check('and the page does not scroll sideways', box.pageScrollsSideways === false)

    /*
     * The buttons are the whole point of the panel. A row of text with its
     * three-state control off screen is a panel that cannot be used.
     */
    const tri = await js(`(() => {
      const row = [...document.querySelectorAll('.chlist .row')]
        .find((r) => /Send messages/.test(r.textContent || ''))
      if (!row) return { found: false }
      row.scrollIntoView({ block: 'center' })
      const group = row.querySelector('.tri')
      if (!group) return { found: false, why: 'no tri group' }
      const r = group.getBoundingClientRect()
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return {
        found: true,
        vw: window.innerWidth,
        left: Math.round(r.left), right: Math.round(r.right),
        width: Math.round(r.width), height: Math.round(r.height),
        reachable: Boolean(at && group.contains(at)),
      } })()`)
    console.log('      allow/deny: ' + JSON.stringify(tri))
    check('the allow/deny buttons are on screen', tri.found === true && tri.right <= tri.vw, tri)
    check('and a finger lands on them', tri.reachable === true, tri)
    // Forty is the number the rest of the phone layout uses.
    check('and they are big enough to hit', tri.height >= 40 && tri.width >= 40, tri)

    /* The scrim is meant to cover the window, header included. */
    const scrim = await js(`(() => {
      const s = document.querySelector('.scrim')
      if (!s) return { found: false }
      const r = s.getBoundingClientRect()
      return {
        found: true,
        covers: r.top <= 0 && r.left <= 0
          && r.right >= window.innerWidth && r.bottom >= window.innerHeight,
        top: Math.round(r.top), height: Math.round(r.height), vh: window.innerHeight,
      } })()`)
    check('the panel covers the window rather than sitting inside it',
      scrim.found === true && scrim.covers === true, scrim)
  },
}
