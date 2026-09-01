/**
 * Editing your own profile from the member list.
 *
 * Rewritten for the client that is running. The report was about a card that
 * grew into a wide edit form in place and jumped a frame later; this one
 * opens the settings screen instead, so there is no placement to get wrong.
 * What is kept is the way in - the button is on your own card, where
 * somebody looking at their own name goes to change it - and that pressing
 * it lands on the profile rather than on whatever settings opened last.
 *
 * The original, for the record:
 *
 * A profile that turns into an edit form is already in the right place.
 *
 * Reported: "when I click edit profile on the right side members list it
 * flickers for a second then moves into place."
 *
 * The card is a popover placed from its own measured size, and the edit form
 * is a much wider thing than the card - so the position worked out for the
 * card was wrong the moment it became a form. A ResizeObserver caught it, but
 * an observer runs after the browser has drawn, so there was always one frame
 * showing the new form at the old card's position. That frame is the flicker.
 *
 * So this does not ask "does it end up in the right place" - it always did.
 * It reads the position on the first frame that could be seen and again once
 * everything has settled, and requires them to be the same. Put the placement
 * back behind the observer and the first read is the card's position and the
 * second is the form's, which is exactly what was being complained about.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'profile-edit-place',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1500)
    check('the member list is there',
      await until('members', `document.querySelectorAll('.mem').length >= 1`))

    /*
     * Own row, because "Edit profile" is only on your own card - and clicked
     * through elementFromPoint rather than dispatched at the node, so what is
     * being tested is a click that would actually land.
     */
    const opened = await js(`(() => {
      const row = [...document.querySelectorAll('.mrow')].find((m) => /JacksFO/.test(m.textContent))
      if (!row) return { found: false }
      const r = row.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + 40, r.top + r.height / 2)
      if (!hit) return { found: false }
      hit.click()
      return { found: true } })()`)
    check('own row can be clicked', opened.found === true, opened)

    check('the profile opens beside the list',
      await until('the card', `!!document.querySelector('.pop .pcard')`))
    await wait(600)

    /*
     * Every step is a separate, synchronous evaluation.
     *
     * Nothing waits inside the page. A first attempt at this awaited a
     * requestAnimationFrame in there and the spec hit its three-minute bomb:
     * these windows are shown but not necessarily in front, and Chromium is
     * under no obligation to run animation frames for a window nobody can
     * see. Waiting belongs out here, where the harness owns the clock.
     */
    const BOX = `(() => {
      /* The whole popover: the roles, the buttons and the way out are
         beside .pcard inside it rather than within it. */
      const card = document.querySelector('.pop')
      if (!card) return { gone: true }
      const r = card.getBoundingClientRect()
      return {
        left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width),
        editing: card.classList.contains('editing'),
      }
    })()`

    const before = await js(BOX)

    /*
     * Clicked, then read on a microtask - which is the whole trick.
     *
     * React does not re-render inside .click(); measuring straight after it
     * reads a card that is still a card, and a check on that would pass
     * whatever the placement did, which is no check at all. But a paint can
     * only happen at a task boundary, never between microtasks. So draining
     * a few of them lands exactly between "the form exists in the DOM" and
     * "the browser has drawn it" - the frame the flicker was.
     *
     * If React has not flushed by then the editing check below fails rather
     * than the placement check passing for nothing.
     */
    const immediately = await js(`(() => {
      /* The whole popover: the roles, the buttons and the way out are
         beside .pcard inside it rather than within it. */
      const card = document.querySelector('.pop')
      const edit = [...card.querySelectorAll('button')].find((b) => /Edit profile/i.test(b.textContent))
      if (!edit) return { found: false,
        who: (card.querySelector('.pnm, .nm') || {}).textContent,
        buttons: [...card.querySelectorAll('button')].map((b) => b.textContent.trim()) }
      edit.click()
      return new Promise((done) => {
        let turns = 0
        const drain = () => {
          if (turns++ < 8) return queueMicrotask(drain)
          done(Object.assign({ found: true }, ${BOX}))
        }
        queueMicrotask(drain)
      })
    })()`)

    // And again once every observer and stray reflow has had its say.
    await wait(700)
    const settled = await js(BOX)

    const measured = { before, immediately, settled }
    console.log('    ' + JSON.stringify(measured))

    check('the Edit profile button is there', measured.immediately.found === true, measured.immediately)
    /*
     * There is no flicker to have, because the card does not become a form.
     *
     * The client this replaced grew the card into a wide edit form in place,
     * which is where the report came from: the position had been worked out
     * for a card, so the first frame of the form sat at the card's place and
     * jumped afterwards. This one takes you to the settings screen, where
     * the profile is one of the panes - a whole screen has nowhere to be
     * placed wrongly, and the whole class of bug is gone rather than fixed.
     *
     * What is still worth holding to is that pressing it does something,
     * that it is the profile you land on, and that the card does not stay
     * behind on top of it.
     */
    const landed = await js(`(() => {
      const screen = document.querySelector('.settings')
      if (!screen) return { open: false }
      const on = [...screen.querySelectorAll('.snav button')].find((b) => b.classList.contains('on'))
      return { open: true,
        pane: on ? on.textContent.trim() : null,
        cardGone: !document.querySelector('.pop'),
        title: (screen.querySelector('.stitle') || {}).textContent || '' } })()`)
    console.log('      landed: ' + JSON.stringify(landed))
    check('and pressing it opens the settings screen', landed.open === true, landed)
    check('on the pane where a profile is changed',
      /account|profile/i.test(landed.pane || '') || /account|profile/i.test(landed.title || ''),
      landed)
    check('and the card does not stay behind on top of it',
      landed.cardGone === true, landed)
  },
}
