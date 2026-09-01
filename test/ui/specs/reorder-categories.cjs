/**
 * Moving the headings, and the channels under them.
 *
 * Asked for as "being able to move / re organize categories in servers aswell
 * as the channels". Channels were already draggable. Categories were not, and
 * had never been: the server has had `/api/categories/reorder` with a
 * permission check on it all along, and nothing in the app ever called it -
 * so the headings sat in the order they were made in, permanently.
 *
 * Dragging cannot be dispatched as a single synthetic event, so each step is
 * sent the way a browser sends it: dragstart on the thing being picked up,
 * dragover on what it is passing, then drop. A DataTransfer is built by hand
 * because a synthetic drag has none, and the whole mechanism turns on the
 * type it carries - a category dragged over a group is read as a category
 * only because it says so.
 *
 * The check that matters is the last one. An order that changed on screen and
 * not on the server looks exactly like one that worked, right up until the
 * next reload.
 */
const { signIn } = require('../lib.cjs')

/* A heading is its own text rather than a span inside one, and only the
   ones in the channel list count - the member roster groups people under
   headings of the same name. */
const HEADINGS = `(() => [...document.querySelectorAll('.sidepane .sect')]
  .map((s) => (s.textContent || '').trim()))()`

/**
 * Make a category by asking the channel list for one.
 *
 * There is no button under the list here: the empty space in it carries the
 * menu, which is where "New category" lives - the same place a right-click
 * gets you a new anything in this app. It opens a box to name it in.
 */
const MAKE_CATEGORY = (name) => `(async () => {
  const list = document.querySelector('.chlist')
  if (!list) return { ok: false, why: 'no channel list' }
  const r = list.getBoundingClientRect()
  list.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: Math.round(r.left + 20), clientY: Math.round(r.bottom - 10) }))
  /* The menu is drawn on the next render, not on the line after the event. */
  await new Promise((res) => setTimeout(res, 400))
  const item = [...document.querySelectorAll('.ctx .mitem')]
    .find((x) => /new category/i.test(x.textContent || ''))
  if (!item) return { ok: false, why: 'no way to make one',
    menu: !!document.querySelector('.ctx'),
    items: [...document.querySelectorAll('.ctx .mitem')].map((x) => x.textContent.trim()) }
  item.click()
  await new Promise((res) => setTimeout(res, 400))
  return { ok: true } })()`

const TYPE_CATEGORY = (name) => `(async () => {
  const i = document.querySelector('.modal input')
  if (!i) return { ok: false, why: 'no box appeared' }
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(i, ${JSON.stringify(name)})
  i.dispatchEvent(new Event('input', { bubbles: true }))
  /*
   * A frame before pressing it.
   *
   * The button is disabled until there is a name in the box, and it stops
   * being disabled on the render after the box changes - not on the line
   * after. Clicking in the same tick clicked a dead button and the category
   * was never made, while everything here reported that it had been.
   */
  await new Promise((res) => setTimeout(res, 300))
  const go = [...document.querySelectorAll('.modal .mft button')]
    .find((b) => !b.disabled && !/cancel/i.test(b.textContent))
  if (!go) return { ok: false, why: 'the button stayed dead',
    buttons: [...document.querySelectorAll('.modal .mft button')]
      .map((b) => b.textContent.trim() + (b.disabled ? ' (dead)' : '')) }
  const said = go.textContent.trim()
  go.click()
  await new Promise((res) => setTimeout(res, 900))
  return { ok: true, pressed: said,
    modalGone: !document.querySelector('.modal') } })()`

/**
 * Drag one heading onto another.
 *
 * A real DataTransfer, because the handlers read `types` to tell a category
 * apart from a channel - the same group accepts both and does different
 * things with them.
 */
const DRAG = (from, to) => `(async () => {
  /* The heading is the handle itself, not a box with one inside it. */
  const heads = [...document.querySelectorAll('.sidepane .sect')]
  const named = (w) => heads.find((g) => (g.textContent || '').trim() === w)
  const src = named(${JSON.stringify(from)})
  const dst = named(${JSON.stringify(to)})
  if (!src || !dst) return { ok: false, why: 'one of them is not on screen',
    saw: heads.map((g) => (g.textContent || '').trim()) }
  const head = src
  if (!head.draggable) return { ok: false, why: 'the heading is not draggable' }

  const dt = new DataTransfer()
  const fire = (el, type) => {
    const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
    el.dispatchEvent(ev)
    return ev
  }
  fire(head, 'dragstart')
  /*
   * A frame between picking it up and moving it over something.
   *
   * What is being dragged is held as state and read by the handler on the
   * thing underneath, so it is only known from the render after the drag
   * starts. Firing both in the same tick asked "will you take this" before
   * anything knew what "this" was, and the answer was no - which reads
   * exactly like a drop the app refuses.
   */
  await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 60)))
  const over = fire(dst, 'dragover')
  fire(dst, 'drop')
  return { ok: true, carried: [...dt.types], tookOver: over.defaultPrevented } })()`

module.exports = {
  name: 'reorder-categories',
  width: 1280,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1200)

    console.log('  --- three headings to shuffle ---')

    for (const name of ['Alpha', 'Bravo', 'Charlie']) {
      /*
       * Waited for rather than slept through. A fixed pause was enough for
       * the first one and not the second, so Bravo was never made and every
       * later step referred to a heading that did not exist.
       */
      /* The list, which is what carries the menu that makes one. */
      await until(`the channel list for ${name}`, `!!document.querySelector('.chlist')`, 10000)
      const opened = await js(MAKE_CATEGORY(name))
      check(`the box opens for ${name}`, opened.ok === true, opened)
      await until(`the box for ${name}`, `!!document.querySelector('.modal input')`, 10000)
      const typed = await js(TYPE_CATEGORY(name))
      check(`${name} can be named`, typed.ok === true, typed)
      await until(`${name} to appear`,
        `[...document.querySelectorAll('.sidepane .sect')].some((s) => (s.textContent || '').trim() === ${JSON.stringify(name)})`,
        15000)
      await wait(400)
    }

    const start = await js(HEADINGS)
    console.log('      headings: ' + JSON.stringify(start))
    check('all three are there, below the ones the server came with',
      ['Alpha', 'Bravo', 'Charlie'].every((n) => start.includes(n)), start)

    console.log('  --- a heading can be picked up ---')

    const dragged = await js(DRAG('Charlie', 'Alpha'))
    check('the heading is draggable at all', dragged.ok === true, dragged)
    /*
     * It carries which heading is being moved.
     *
     * The client this replaced used a MIME type per kind so one group could
     * tell a category apart from a channel. Here the two are separate lists
     * with separate handlers, and a heading only ever offers itself to other
     * headings - so what has to be true is that something is being carried
     * at all, and the check that it lands in the right place is below.
     */
    check('and it carries the heading being moved',
      (dragged.carried || []).length > 0, dragged)
    /*
     * The group has to accept it. Without preventDefault on dragover the
     * browser refuses the drop and nothing at all happens - which is exactly
     * how this looked before, so it is worth asserting rather than inferring
     * from the order afterwards.
     */
    check('and the group it is over accepts it', dragged.tookOver === true, dragged)

    await wait(900)
    const moved = await js(HEADINGS)
    console.log('      after: ' + JSON.stringify(moved))
    check('Charlie moved above Alpha',
      moved.indexOf('Charlie') < moved.indexOf('Alpha'), moved)

    console.log('  --- and it is the server that remembers, not the page ---')

    /*
     * The whole point. An order held in a component looks identical to one
     * that was saved, until something reloads - which is how a reorder that
     * never reached the server goes unnoticed.
     */
    await win.loadURL(base + '/')
    await until('the list again', `document.querySelectorAll('.sect').length > 2`, 15000)
    await wait(1500)

    const after = await js(HEADINGS)
    console.log('      reloaded: ' + JSON.stringify(after))
    check('the new order survived a reload',
      after.indexOf('Charlie') < after.indexOf('Alpha'), after)

    console.log('  --- Text and Voice move too ---')

    /*
     * They hold whatever nobody has filed and are not rows in the categories
     * table, so they had no position at all - they were drawn above the loop
     * over categories and could never be moved. Their place is kept on the
     * space now, and they are entries in the same order as everything else.
     */
    /*
     * A voice room filed under nothing, so that there is a loose Voice group
     * at all.
     *
     * There was not one before, and this passed anyway - because a new server
     * used to be seeded with a category called "Voice", and a check for a
     * heading of that name found the category rather than the group it meant.
     * The two are different things and were only ever told apart by sharing a
     * name. The seeded pair is called "Voice Channels" now, so the group has
     * to be made rather than assumed.
     */
    const loose = await js(`(async () => {
      const token = localStorage.getItem('atrium.token')
      const h = { 'content-type': 'application/json', authorization: 'Bearer ' + token }
      const got = await (await fetch('/api/spaces', { headers: h })).json()
      const space = (got.spaces || [])[0]
      if (!space) return { ok: false, why: 'no server' }
      const r = await fetch('/api/channels', { method: 'POST', headers: h,
        body: JSON.stringify({ spaceId: space.id, name: 'lobby', kind: 'voice' }) })
      return { ok: r.ok, status: r.status } })()`)
    check('a voice room can be made outside any category', loose.ok === true, loose)
    await win.loadURL(base + '/')
    await until('the list once more', `document.querySelectorAll('.sect').length > 2`, 15000)
    await wait(1500)

    const all = await js(`(() => {
      const out = {}
      for (const g of document.querySelectorAll('.sidepane .sect')) {
        const name = (g.textContent || '').trim()
        out[name] = !!g.draggable
      }
      return out })()`)
    console.log('      draggable: ' + JSON.stringify(all))
    check('Text can be dragged now', all.Text === true, all)
    check('and Voice', all.Voice === true, all)

    const before = await js(HEADINGS)
    const sank = await js(DRAG('Text', 'Charlie'))
    check('Text can be picked up', sank.ok === true, sank)
    await wait(900)
    const afterText = await js(HEADINGS)
    console.log('      ' + JSON.stringify(before) + ' -> ' + JSON.stringify(afterText))
    /*
     * By the last one of that name rather than the first, which used to
     * matter and now only guards.
     *
     * This server once held two headings called "Text" - the category a new
     * server was seeded with, and the one the client invents for channels
     * filed under nothing - so indexOf answered 0 before the drag and 0
     * after it, and reported a heading that had plainly moved as one that
     * had not:
     *
     *   ["Text","Text","Voice","Charlie",...]  ->  ["Text","Voice","Charlie","Text",...]
     *
     * The seeded pair is called "Text Channels" and "Voice Channels" now, so
     * the name is unique again. lastIndexOf is kept because it is right
     * either way, and this assertion should not quietly go blind if two
     * headings ever share a name again.
     */
    check('and it moved down past the headings',
      afterText.lastIndexOf('Text') > before.lastIndexOf('Text'), { before, afterText })

    /* The one that matters: their position is kept on the server, not here. */
    await win.loadURL(base + '/')
    await until('the list again', `document.querySelectorAll('.sect').length > 2`, 15000)
    await wait(1500)
    const kept = await js(HEADINGS)
    console.log('      reloaded: ' + JSON.stringify(kept))
    /* The whole order, not one name's place in it: with two headings of the
       same name, comparing a single index passes on arrangements that are
       not the same arrangement at all. */
    check('and it is still there after a reload',
      kept.join('|') === afterText.join('|'), { afterText, kept })

    /* And the channels under it went with it rather than being left behind. */
    /* The rows after the heading and before the next one: a heading is a
       sibling of its channels here, not a box around them. */
    const under = await js(`(() => {
      const g = [...document.querySelectorAll('.sidepane .sect')]
        .find((x) => (x.textContent || '').trim() === 'Text')
      if (!g) return { channels: [] }
      const out = []
      for (let e = g.nextElementSibling; e; e = e.nextElementSibling) {
        if (e.classList.contains('sect')) break
        if (e.classList.contains('chan') || e.classList.contains('vcard')) {
          out.push((e.textContent || '').trim())
        } else {
          for (const c of e.querySelectorAll('.chan, .vcard')) out.push((c.textContent || '').trim())
        }
      }
      return { channels: out } })()`)
    console.log('      under Text: ' + JSON.stringify(under.channels))
    check('the channels moved with the heading', under.channels.length > 0, under)
  },
}
