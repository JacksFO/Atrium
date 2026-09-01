/**
 * Right-clicking the empty space under the channels offers a new heading.
 *
 * Reported as working between two categories and nowhere else: the list was
 * only as tall as its rows, so everything between the last channel and your
 * own name at the bottom belonged to the scroller behind it and the menu was
 * asked of nothing.
 *
 * Measured at a point far below the last channel rather than at the list's
 * own edge, because the whole bug was about the gap between those two.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'channel-blank-space',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)

    const where = await js(`(() => {
      /* Every kind of row, not just text channels: a voice room is a card
         and sits after them, so "below the last .chan" is halfway up the
         list. */
      const rows = [...document.querySelectorAll('.sidepane .chan, .sidepane .vcard, .sidepane .sect')]
      const bottom = Math.max(...rows.map((r) => r.getBoundingClientRect().bottom))
      const last = { bottom }
      const list = document.querySelector('.sidepane .scroll').getBoundingClientRect()
      /* Halfway between the last channel and the bottom of the column: the
         gap the report was about. */
      const y = Math.round((last.bottom + list.bottom) / 2)
      const x = Math.round(list.left + list.width / 2)
      const at = document.elementFromPoint(x, y)
      return { x, y, gap: Math.round(list.bottom - last.bottom),
        on: at ? at.className.toString().slice(0, 40) : 'nothing' } })()`)
    console.log('      the gap: ' + JSON.stringify(where))
    console.log('      cards: ' + JSON.stringify(await js(`
      [...document.querySelectorAll('.sidepane .vcard')].map((v) => {
        const r = v.getBoundingClientRect()
        return { cls: v.className, top: Math.round(r.top), h: Math.round(r.height) }
      })`)))
    check('there is empty space under the channels to aim at', where.gap > 20, where)

    const opened = await js(`(() => {
      const at = document.elementFromPoint(${where.x}, ${where.y})
      if (!at) return { hit: false, why: 'nothing at that point' }
      at.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
        clientX: ${where.x}, clientY: ${where.y} }))
      return { hit: true, on: at.className.toString().slice(0, 40) } })()`)
    check('it can be right-clicked', opened.hit === true, opened)
    await until('the menu', `!!document.querySelector('.ctx')`, 6000)

    const items = await js(`[...document.querySelectorAll('.ctx .mitem')].map((b) => b.textContent.trim())`)
    console.log('      items: ' + JSON.stringify(items))
    check('and it offers a new category', items.some((t) => /new category/i.test(t)), items)
    check('and a new channel, which is the commoner half of the pair',
      items.some((t) => /new channel/i.test(t)), items)

    /*
     * Where a channel with no heading lands.
     *
     * At the top, because one made from the empty space belongs to nothing
     * yet and the bottom of a long server is the one place its author will
     * not think to look. Asked of the list on screen rather than of the
     * server, since that is where somebody has to find it.
     */
    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')]
        .find((x) => /new channel/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await until('a box to name it in', `!!document.querySelector('.modal input')`)
    await js(`(async () => {
      const i = document.querySelector('.modal input')
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(i, 'from-the-gap')
      i.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 300))
      const go = [...document.querySelectorAll('.modal .mft button')]
        .find((x) => !x.disabled && !/cancel/i.test(x.textContent))
      if (go) go.click()
      await new Promise((r) => setTimeout(r, 900))
      return 1 })()`)
    await until('the channel', `[...document.querySelectorAll('.chan')]
      .some((n) => /from-the-gap/.test(n.textContent))`, 15000)

    const placed = await js(`(() => {
      const names = [...document.querySelectorAll('.sidepane .chan')]
        .map((n) => (n.querySelector('.nm') || n).textContent.trim())
      return { names, at: names.indexOf('from-the-gap') } })()`)
    console.log('      channels now: ' + JSON.stringify(placed))
    check('a channel made from the gap goes to the top, not the bottom',
      placed.at === 0, placed)
  },
}
