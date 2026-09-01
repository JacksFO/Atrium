/**
 * Inviting a friend to a server.
 *
 * The Invite button took 350px of a 418px row and left the name beside it
 * 0px wide, so the cramped text in the screenshot was overflow from a
 * collapsed box rather than anything to do with fonts or padding. The cause
 * was a bare .primary carrying width: 100% for the sign-in button, which
 * everything adding "primary" for the colour inherited.
 *
 * That trap had already been patched once for .btn.primary and came back
 * somewhere else, so the last check here is about the shape of the bug
 * rather than the one class: no button anywhere in this dialog has taken
 * over the row it sits in.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'invite-dialog',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy', 'Camotoes', 'dumbass', 'Keeko'],
    })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1800)

    await js(`(() => {
      const b = document.querySelector('[aria-label="Invite people"]')
      if (b) b.click()
      return 1 })()`)
    await wait(1600)

    const seen = await js(`(() => {
      const rows = [...document.querySelectorAll('.as-friend')]
      if (!rows.length) return { rows: 0 }
      const row = rows[0]
      const who = row.querySelector('.as-friend-who')
      const btn = row.querySelector('.fr-act')
      const w = (e) => Math.round(e.getBoundingClientRect().width)
      return { rows: rows.length,
        rowWidth: w(row), whoWidth: w(who), buttonWidth: w(btn),
        whoScroll: who.scrollHeight, whoClient: who.clientHeight,
        rowScroll: row.scrollHeight, rowClient: row.clientHeight } })()`)

    check('the dialog lists the friends', seen.rows === 4, seen.rows)
    check('the button is a button, not half the row',
      seen.buttonWidth > 0 && seen.buttonWidth <= 110, seen.buttonWidth)
    check('the name has the room instead',
      seen.whoWidth > seen.buttonWidth, { name: seen.whoWidth, button: seen.buttonWidth })
    check('the name and handle are not clipped',
      seen.whoScroll <= seen.whoClient + 1, { scroll: seen.whoScroll, box: seen.whoClient })
    check('and the row is tall enough for both lines',
      seen.rowScroll <= seen.rowClient + 1, { scroll: seen.rowScroll, box: seen.rowClient })

    /*
     * The general form of it: any button in a flex row that has taken almost
     * the whole row is the same bug wearing a different class name.
     */
    const greedy = await js(`(() => {
      const bad = []
      for (const el of document.querySelectorAll('.addspace button, .as-friend button')) {
        const parent = el.parentElement
        if (!parent) continue
        const ps = getComputedStyle(parent)
        if (!ps.display.includes('flex') || ps.flexDirection !== 'row') continue
        if (parent.children.length < 2) continue
        const pw = parent.getBoundingClientRect().width
        const w = el.getBoundingClientRect().width
        if (pw > 0 && w / pw > 0.85) {
          bad.push({ cls: el.className, w: Math.round(w), of: Math.round(pw) })
        }
      }
      return bad })()`)
    check('no button in the dialog has swallowed its row',
      Array.isArray(greedy) && greedy.length === 0, greedy)
  },
}
