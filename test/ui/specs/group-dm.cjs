/**
 * Starting a conversation with several people at once.
 *
 * Asked as "how do we create group chats in DM's?" - and the answer was that
 * you could not. The server has taken a list of people since long before
 * anything sent it one: dm_members has always been a join table with no limit
 * of two, and the sidebar has had a "Group conversations" heading waiting for
 * something to put under it. The button was the missing part, so the button
 * is what this drives.
 *
 * Clicked rather than called, because a route that already worked is not what
 * was broken.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'group-dm',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy', 'Cami', 'Keeko'],
    })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(1500)

    // Onto the conversations list, where groups live.
    await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
    await until('the conversations list',
      `document.querySelectorAll('.chan').length >= 3`)
    await wait(1000)

    const before = await js(`(() => ({
      heading: !!document.querySelector('.sect'),
      button: !!document.querySelector('.sect .group-add'),
      groups: document.querySelectorAll('.chan.dm-group').length,
    }))()`)
    console.log('      before: ' + JSON.stringify(before))
    check('there is a heading for groups', before.heading === true, before)
    check('and a way to make one', before.button === true, before)

    // --- open the picker ---------------------------------------------------
    const opened = await js(`(() => {
      const b = document.querySelector('.sect .group-add')
      if (!b) return { found: false }
      const r = b.getBoundingClientRect()
      // Through elementFromPoint, so this cannot pass on a button that is
      // covered by something else.
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!el) return { found: false, why: 'nothing at that point' }
      // elementFromPoint lands on the <path> inside the button, and an SVG
      // element has no click() in Chromium - calling it threw, which read as
      // the button being dead. Hit testing still proves the point is inside
      // the button; the click goes to the button.
      if (!b.contains(el)) return { found: false, why: 'something else is on top' }
      b.click()
      return { found: true } })()`)
    check('the button can actually be clicked', opened.found === true, opened)

    await until('the picker', `!!document.querySelector('.ng-list')`)

    const picker = await js(`(() => ({
      people: [...document.querySelectorAll('.ng-row .ng-name')].map((n) => n.textContent.trim()),
      startDisabled: [...document.querySelectorAll('.mft button')]
        .find((b) => /start/i.test(b.textContent))?.disabled ?? null,
    }))()`)
    console.log('      picker: ' + JSON.stringify(picker))
    check('it lists the friends', picker.people.length >= 3, picker.people)
    /*
     * Two people and you is the smallest group. One is a one-to-one
     * conversation, which already has its own way in - offering "group" for
     * one would quietly make something else.
     */
    check('and will not start with nobody chosen', picker.startDisabled === true, picker)

    // --- one is not enough -------------------------------------------------
    await js(`(() => { document.querySelectorAll('.ng-row')[0]?.click(); return 1 })()`)
    await wait(300)
    const one = await js(`(() => ([...document.querySelectorAll('.mft button')]
      .find((b) => /start/i.test(b.textContent)) || {}).disabled)()`)
    check('one person is still not a group', one === true, one)

    // --- two is ------------------------------------------------------------
    await js(`(() => { document.querySelectorAll('.ng-row')[1]?.click(); return 1 })()`)
    await wait(300)
    const two = await js(`(() => ([...document.querySelectorAll('.mft button')]
      .find((b) => /start/i.test(b.textContent)) || {}).disabled)()`)
    check('two people and you is', two === false, two)

    await js(`(() => {
      const b = [...document.querySelectorAll('.mft button')]
        .find((x) => /start/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)

    // --- and it opens ------------------------------------------------------
    const landed = await until('the conversation to open',
      `!document.querySelector('.ng-list') && !!document.querySelector('.cmp')`, 12000)
    check('the picker closes and a conversation opens', landed === true)

    const after = await js(`(async () => {
      const token = ${JSON.stringify(setup.me?.token ?? '')}
      const r = await (await fetch('/api/dms', { headers: { authorization: 'Bearer ' + token } })).json()
      const groups = (r.dms || []).filter((d) => (d.members || []).length > 2)
      return {
        groups: groups.length,
        biggest: Math.max(0, ...groups.map((g) => (g.members || []).length)),
      } })()`)
    console.log('      after: ' + JSON.stringify(after))
    check('a group conversation really exists on the server', after.groups >= 1, after)
    check('and it holds three people - the two chosen and me',
      after.biggest === 3, after)

    /*
     * The group row, told apart from the one-to-one rows around it.
     *
     * A first attempt used "the rows after the heading", which matched every
     * ordinary conversation below it and passed while no group existed at
     * all. A group is the row whose title is several names.
     */
    const listed = await js(`(() => [...document.querySelectorAll('.chan .nm')]
      .map((n) => n.textContent.trim())
      .filter((t) => t.includes(',')))()`)
    console.log('      group rows in the sidebar: ' + JSON.stringify(listed))
    check('and it is listed under the heading that was waiting for it',
      listed.length >= 1, listed)
  },
}
