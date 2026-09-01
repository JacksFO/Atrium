/**
 * Doing something about a person, from where you are looking at them.
 *
 * Reported as there being no way to remove a friend. There was one, in the
 * menu behind a right-click in a server's member list - so the only way to
 * stop being somebody's friend was to find a server you still shared with
 * them. The Friends page offered a card, which says who somebody is and
 * gives nothing to do about them, and a conversation row offered nothing at
 * all.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'person-menus',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(1500)

    // ---- the friends page ----------------------------------------------
    await js(`(() => {
      const h = document.querySelector('.rl[aria-label="Conversations"]')
      if (h) h.click()
      return 1 })()`)
    /* Waited for rather than guessed at: the two pages only appear once the
       conversations are showing, and clicking before they are there clicks
       nothing and looks exactly like the page being empty. */
    await until('the two pages', `document.querySelectorAll('.nrow').length > 1`, 8000)
    await js(`(() => {
      const b = [...document.querySelectorAll('.nrow')]
        .find((x) => /^friends$/i.test((x.textContent || '').trim()))
      if (b) b.click()
      return 1 })()`)
    /* On to All: the page opens on Online, and somebody who is not
       connected has no row there - which reads as an empty friends list. */
    await until('the tabs', `document.querySelectorAll('.ftab').length > 1`, 8000)
    await js(`(() => {
      const b = [...document.querySelectorAll('.ftab')]
        .find((x) => /^all$/i.test(x.textContent.trim()))
      if (b) b.click()
      return 1 })()`)
    await until('the friends list', `!!document.querySelector('.frow')`, 8000)
    await wait(500)

    const dots = await js(`(() => {
      const row = document.querySelector('.frow')
      if (!row) return { hit: false, why: 'no friend row' }
      const more = [...row.querySelectorAll('.fic')]
        .find((f) => /more/i.test(f.getAttribute('title') || ''))
      if (!more) return { hit: false, why: 'no more button' }
      const r = more.getBoundingClientRect()
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!at || !(more.contains(at) || at === more)) return { hit: false, why: 'covered' }
      /* Pressed on the control, not on whatever the point landed on: the
         thing under the pointer is the icon inside it, and an <svg> has no
         click() at all. Hit tested first, which is the part that matters -
         a press on something covered proves nothing. */
      more.click()
      return { hit: true } })()`)
    check('a friend offers something to press', dots.hit === true, dots)
    await until('the menu', `!!document.querySelector('.ctx')`, 6000)

    const onFriend = await js(`[...document.querySelectorAll('.ctx .mitem')]
      .map((b) => b.textContent.trim())`)
    console.log('      on a friend: ' + JSON.stringify(onFriend))
    check('and it offers to stop being their friend',
      onFriend.some((t) => /remove friend/i.test(t)), onFriend)
    check('and to look at who they are',
      onFriend.some((t) => /profile/i.test(t)), onFriend)

    await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 1 })()`)
    await wait(400)

    // ---- a conversation row ---------------------------------------------
    const opened = await js(`(() => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /baileyyy/i.test(r.textContent || ''))
      if (!row) return { hit: false, why: 'no conversation with them' }
      const r = row.getBoundingClientRect()
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
        clientX: Math.round(r.left + 30), clientY: Math.round(r.top + r.height / 2) }))
      return { hit: true } })()`)
    if (opened.hit) {
      await until('its menu', `!!document.querySelector('.ctx')`, 6000)
      const onChat = await js(`[...document.querySelectorAll('.ctx .mitem')]
        .map((b) => b.textContent.trim())`)
      console.log('      on a conversation: ' + JSON.stringify(onChat))
      check('a conversation can be marked read', onChat.some((t) => /mark as read/i.test(t)), onChat)
      check('and quietened', onChat.some((t) => /mute/i.test(t)), onChat)
      check('and closed', onChat.some((t) => /close conversation/i.test(t)), onChat)
    } else {
      check('there is a conversation to right-click', false, opened)
    }
  },
}
