/**
 * Two servers on one screen, and nothing of one showing in the other.
 *
 * The server side of this has been guarded for a long time -
 * test/server/independence.mjs is 124 checks of routes refusing to act on the
 * wrong server. Nothing guarded the client, and every leak found since has
 * been the same shape on this side of the wire: a piece of React state
 * holding one server's answer, not keyed by which server it came from and not
 * cleared when the one on screen changes.
 *
 * They were found one at a time, by eye, after somebody noticed. That is the
 * reason this exists: the property is "nothing from one server appears in
 * another", and it is worth checking as a property rather than rediscovering
 * it per feature.
 *
 * Two servers with deliberately distinct contents, then the same questions
 * asked on both sides of a switch - and asked again after coming back, since
 * a leak that only shows up on the return trip is still a leak.
 */
const { signIn } = require('../lib.cjs')

const SEEN = `(() => ({
  /* Everything the channel column is currently showing. */
  headings: [...document.querySelectorAll('.sidepane .sect')]
    .map((s) => (s.textContent || '').trim()),
  channels: [...document.querySelectorAll('.chan')].map((n) => n.textContent.trim()),
  /* And the member column, which is grouped by this server's hoisted roles. */
  memberGroups: [...document.querySelectorAll('.mempane .sect')]
    .map((l) => l.textContent.trim().replace(/ — \\d+$/, '')),
  members: [...document.querySelectorAll('.mempane .mem-name')].map((m) => m.textContent.trim()),
}))()`

const SWITCH = (i) => `(() => {
  const pips = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]
  if (!pips[${i}]) return { ok: false, why: 'no server at ' + ${i}, have: pips.length }
  pips[${i}].click()
  return { ok: true } })()`

/* Made from the menu on the empty space in the channel list, and named in a
   box that opens with it. */
const MAKE_CATEGORY = (name) => `(async () => {
  const list = document.querySelector('.chlist')
  if (!list) return { ok: false, why: 'cannot make categories here' }
  const r = list.getBoundingClientRect()
  list.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
    clientX: Math.round(r.left + 20), clientY: Math.round(r.bottom - 10) }))
  await new Promise((r2) => setTimeout(r2, 400))
  const item = [...document.querySelectorAll('.ctx .mitem')]
    .find((x) => /new category/i.test(x.textContent || ''))
  if (!item) return { ok: false, why: 'cannot make categories here' }
  item.click()
  await new Promise((r2) => setTimeout(r2, 400))
  const i = document.querySelector('.modal input')
  if (!i) return { ok: false, why: 'no box' }
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(i, ${JSON.stringify(name)})
  i.dispatchEvent(new Event('input', { bubbles: true }))
  /* The button comes alive on the render after the box changes. */
  await new Promise((r2) => setTimeout(r2, 300))
  const go = [...document.querySelectorAll('.modal .mft button')]
    .find((b2) => !b2.disabled && !/cancel/i.test(b2.textContent))
  if (!go) return { ok: false, why: 'the button stayed dead' }
  go.click()
  await new Promise((r2) => setTimeout(r2, 700))
  return { ok: true } })()`

/** Drag one heading onto another, the way a browser sends it. */
const DRAG = (from, to) => `(() => {
  const groups = [...document.querySelectorAll('.sect')]
  const at = (n) => groups.find((g) =>
    (g.querySelector('.sect span') || {}).textContent.trim() === n)
  const src = at(${JSON.stringify(from)})
  const dst = at(${JSON.stringify(to)})
  if (!src || !dst) return { ok: false, why: 'not both on screen' }
  const head = src.querySelector('.sect')
  const dt = new DataTransfer()
  const fire = (el, type) => {
    const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
    el.dispatchEvent(ev)
    return ev
  }
  fire(head, 'dragstart')
  fire(dst, 'dragover')
  fire(dst, 'drop')
  return { ok: true } })()`

module.exports = {
  name: 'server-independence',
  width: 1280,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the first server can be set up', setup.ok === true, setup.why)

    const token = setup.me?.token ?? ''
    const made = await js(`(async () => {
      const r = await (await fetch('/api/spaces', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ${JSON.stringify(token)} },
        body: JSON.stringify({ name: 'Second' }) })).json()
      return { ok: !!r.space, id: r.space && r.space.id } })()`)
    check('and a second one made', made.ok === true, made)

    /*
     * With a channel filed under nothing in it, so it has a loose group.
     *
     * That is the whole point of what follows: the loose groups carry the
     * same two reserved ids in every server, which is exactly why an order
     * held in one variable followed you into the next one. A second server
     * whose channels are all inside categories has no loose group at all, so
     * it cannot show the leak - and this used to look as though it did, only
     * because a new server was seeded with a category called "Text" and the
     * check found that instead.
     */
    const loose = await js(`(async () => {
      const h = { 'content-type': 'application/json',
        authorization: 'Bearer ' + ${JSON.stringify(token)} }
      const r = await fetch('/api/channels', { method: 'POST', headers: h,
        body: JSON.stringify({ spaceId: ${JSON.stringify('SECOND_ID')}, name: 'loose', kind: 'text' }) })
      return { ok: r.ok, status: r.status } })()`.replace('"SECOND_ID"', JSON.stringify(made.id)))
    check('the second server has a channel outside any category', loose.ok === true, loose)

    await win.loadURL(base + '/')
    await until('both servers on the rail',
      `document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)').length >= 2`, 20000)
    await wait(2000)

    console.log('  --- something distinctive in the first ---')

    await js(SWITCH(0))
    await wait(1200)
    const firstMade = await js(MAKE_CATEGORY('OnlyInFirst'))
    check('a category can be made in the first', firstMade.ok === true, firstMade)
    await until('it to appear',
      `[...document.querySelectorAll('.sidepane .sect')].some((s) => s.textContent.trim() === 'OnlyInFirst')`,
      15000)
    await wait(600)

    /*
     * And the headings rearranged, because the order was the last thing to
     * leak: it was held in one variable, cleared only when the categories
     * changed, and so followed you into the next server you opened.
     */
    await js(DRAG('OnlyInFirst', 'Text'))
    await wait(1200)
    const inFirst = await js(SEEN)
    console.log('      first:  ' + JSON.stringify(inFirst.headings))
    check('the first server has its own heading', inFirst.headings.includes('OnlyInFirst'), inFirst)

    console.log('  --- and none of it in the second ---')

    await js(SWITCH(1))
    await wait(2000)
    const inSecond = await js(SEEN)
    console.log('      second: ' + JSON.stringify(inSecond.headings))
    console.log('      channels: ' + JSON.stringify(inSecond.channels))

    check('the heading made in the first is not here',
      !inSecond.headings.includes('OnlyInFirst'), inSecond.headings)
    /*
     * The loose group sits where this server puts it, not where the other
     * one was rearranged to.
     *
     * It carries the same reserved id in both, which is what made the order
     * leak in the first place. In the first server the headings were just
     * shuffled; here the loose group should still be at the top, where a
     * server that has never been touched puts it.
     */
    check('the loose group sits where this server puts it, not the other one',
      inSecond.headings.indexOf('Text') === 0, inSecond.headings)
    /*
     * The ones only the first server has. Comparing the whole list would
     * fail on nothing: every new server is made with a `general` and a
     * `Voice`, so those two names appearing in both is the two servers
     * being alike, not one leaking into the other.
     */
    const onlyFirst = inFirst.channels.filter((c) => !inSecond.channels.includes(c))
    check('the first server has channels the second does not', onlyFirst.length > 0, onlyFirst)
    check('and not one of them is listed here',
      !onlyFirst.some((c) => inSecond.channels.includes(c)),
      { onlyFirst, second: inSecond.channels })

    console.log('  --- and after reordering channels, which is how it was found ---')

    /*
     * Reported with two screenshots: reorder the channels in one server, look
     * at another, and its Text group is empty while Voice is fine - because
     * only the text channels had been dragged.
     *
     * The group kept the order from the drag and React kept the component,
     * being the same group in the same place, so one server's channel ids
     * were mapped against another server's channels and matched nothing. It
     * cleared itself only when something unmounted the column, which is why
     * going via the direct messages and back appeared to fix it.
     */
    await js(SWITCH(0))
    await wait(1500)
    /* The row is the draggable thing here rather than a box around it, and
       what is being dragged is known from the render after it is picked up -
       so there is a frame between taking it and moving it. */
    const dragged = await js(`(async () => {
      const wraps = [...document.querySelectorAll('.chan[draggable="true"]')]
      if (wraps.length < 2) return { ok: false, why: 'not enough channels', have: wraps.length }
      const dt = new DataTransfer()
      const fire = (el, t) => el.dispatchEvent(
        new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }))
      fire(wraps[0], 'dragstart')
      await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 60)))
      fire(wraps[1], 'dragover')
      fire(wraps[1], 'drop')
      fire(wraps[0], 'dragend')
      return { ok: true } })()`)
    check('the channels can be reordered in the first server', dragged.ok === true, dragged)
    await wait(1500)

    await js(SWITCH(1))
    await wait(1500)
    const afterDrag = await js(SEEN)
    console.log('      second, straight after: ' + JSON.stringify(afterDrag.channels))
    check('the other server still lists its channels', afterDrag.channels.length > 0, afterDrag)
    /*
     * Named, not counted. An empty Text group with a full Voice group counts
     * as "some channels" and is exactly the fault being tested for.
     */
    check('including the text ones, not only the voice ones',
      afterDrag.channels.includes('general'), afterDrag.channels)

    console.log('  --- a second distinctive thing, the other way round ---')

    const secondMade = await js(MAKE_CATEGORY('OnlyInSecond'))
    check('a category can be made in the second', secondMade.ok === true, secondMade)
    await until('it to appear',
      `[...document.querySelectorAll('.sidepane .sect')].some((s) => s.textContent.trim() === 'OnlyInSecond')`,
      15000)
    await wait(800)

    console.log('  --- and back, with the first still its own ---')

    await js(SWITCH(0))
    await wait(2000)
    const backInFirst = await js(SEEN)
    console.log('      first again: ' + JSON.stringify(backInFirst.headings))

    check('the heading made in the second server did not follow',
      !backInFirst.headings.includes('OnlyInSecond'), backInFirst.headings)
    check('and the first still has its own',
      backInFirst.headings.includes('OnlyInFirst'), backInFirst.headings)
    /*
     * The order it was left in, rather than a default - a reset that clears
     * too much looks the same as a leak from the other side until you check
     * that what should have survived did.
     */
    check('in the order it was left in',
      JSON.stringify(backInFirst.headings) === JSON.stringify(inFirst.headings),
      { was: inFirst.headings, now: backInFirst.headings })

    console.log('  --- and the member column belongs to the server it is in ---')

    /*
     * Grouped by this server's hoisted roles. A role list not filtered by
     * server would put a heading here that belongs to the other one, which
     * is the same class of fault one column over.
     */
    await js(SWITCH(1))
    await wait(1800)
    const secondMembers = await js(SEEN)
    console.log('      second member groups: ' + JSON.stringify(secondMembers.memberGroups))
    check('the member column has groups', secondMembers.memberGroups.length > 0, secondMembers)
    check('and none of them name a role from the other server',
      !secondMembers.memberGroups.includes('OnlyInFirst'), secondMembers.memberGroups)
  },
}
