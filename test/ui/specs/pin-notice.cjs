/**
 * The line that says somebody pinned something, and getting rid of it.
 *
 * Asked for directly: right-click the "X pinned a message" notice and delete
 * it, if you pinned it or hold the permission. The line was drawn as plain
 * furniture - no menu, no way to remove it - so a channel collected one of
 * them for ever, one per pin, in the middle of the conversation.
 *
 * The notice is not a message anybody wrote, so it gets its own one-item
 * menu rather than the message one: replying to it, editing it and reacting
 * to it are all meaningless, and a menu of five greyed-out things is worse
 * than a menu of one that works.
 *
 * Through the real menus rather than the API, because the server has always
 * allowed this delete - what was missing was anywhere to ask from.
 */
const { signIn, typeAndSend } = require('../lib.cjs')

module.exports = {
  name: 'pin-notice',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1800)

    await typeAndSend(js, 'worth keeping')
    check('there is a message to pin',
      await until('the message', `[...document.querySelectorAll('.msg')].some((m) => m.textContent.includes('worth keeping'))`))

    /* A real right-click at a real point, so a menu covered by something else
       would not answer. elementFromPoint rather than dispatching at the row:
       a synthetic event on the element itself proves the handler runs, not
       that a person could reach it. */
    const rightClick = (selector, text) => js(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      const row = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((m) => ${text === null ? 'true' : `m.textContent.includes(${JSON.stringify(text)})`})
      if (!row) return { found: false }
      const r = row.getBoundingClientRect()
      const x = r.left + Math.min(60, r.width / 2), y = r.top + r.height / 2
      const hit = document.elementFromPoint(x, y)
      if (!hit || !row.contains(hit)) return { found: true, covered: true, by: hit && hit.className }
      hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      return { found: true, covered: false } })()`)

    const opened = await rightClick('.msg', 'worth keeping')
    check('the message can be right-clicked', opened.found && !opened.covered, opened)
    await wait(600)

    const items = await js(`[...document.querySelectorAll('.ctx .mitem')].map((b) => b.textContent.trim())`)
    check('the menu offers pinning', items.includes('Pin'), items)

    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')].find((x) => /^pin$/i.test(x.textContent.trim()))
      if (b) b.click(); return 1 })()`)

    check('a line appears saying so',
      await until('the pin notice',
        `[...document.querySelectorAll('.sys-row')].some((r) => r.textContent.includes('pinned a message'))`))

    // And it is one line, not one per render.
    const before = await js(`document.querySelectorAll('.sys-row').length`)
    check('exactly one of them', before === 1, before)

    const onNotice = await rightClick('.sys-row', 'pinned a message')
    check('the notice can be right-clicked', onNotice.found && !onNotice.covered, onNotice)
    await wait(600)

    const menu = await js(`(() => {
      const m = document.querySelector('.ctx')
      if (!m) return { open: false }
      const r = m.getBoundingClientRect()
      return { open: true,
        items: [...m.querySelectorAll('.mitem')].map((b) => b.textContent.trim()),
        onScreen: r.left >= 0 && r.right <= window.innerWidth + 1
          && r.top >= 0 && r.bottom <= window.innerHeight + 1 } })()`)
    check('a menu opens on it', menu.open === true, menu)
    check('offering only the delete', menu.open && menu.items.length === 1
      && menu.items[0] === 'Delete this line', menu.items)
    check('and it fits on the screen', menu.onScreen === true, menu)

    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')].find((x) => x.textContent.trim() === 'Delete this line')
      if (b) b.click(); return 1 })()`)

    check('the line goes',
      await until('no pin notice',
        `[...document.querySelectorAll('.sys-row')].every((r) => !r.textContent.includes('pinned a message'))`))

    /* And the pin itself survives it. Deleting the announcement is tidying
       the conversation up, not unpinning - those are two different things
       and sharing one action would surprise somebody exactly once. */
    const stillPinned = await js(`(() => {
      const m = [...document.querySelectorAll('.msg')].find((x) => x.textContent.includes('worth keeping'))
      return { there: !!m, marked: !!(m && m.querySelector('.msg-pinned, .pin-mark')) } })()`)
    check('while the message stays', stillPinned.there === true, stillPinned)
  },
}
