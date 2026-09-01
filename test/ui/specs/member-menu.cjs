/**
 * Right-clicking a person, and setting a nickname.
 *
 * "Set nickname" did nothing at all. The menu's item() helper runs the
 * action and then closes the menu, which is right for every other line -
 * they do their thing and there is nothing left to look at. This one only
 * opens a box to type in, and the menu closed in the same click, unmounting
 * the box before it could render.
 *
 * So this does not stop at "the box appears": it types a name and saves it,
 * because the bug sat one step earlier than where it showed.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'member-menu',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy', 'Keeko'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1500)
    check('the member list is there',
      await until('members', `document.querySelectorAll('.mrow').length >= 2`))

    await js(`(() => {
      const row = [...document.querySelectorAll('.mrow')].find((m) => /Baileyyy/.test(m.textContent))
      if (!row) return { found: false }
      const r = row.getBoundingClientRect()
      const x = r.left + 40, y = r.top + r.height / 2
      document.elementFromPoint(x, y).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      return { found: true } })()`)
    /*
     * Waited for, not slept through.
     *
     * A fixed sleep here passed on its own and failed inside the full suite,
     * where the machine is busy with sixteen other specs - which is not
     * flakiness in the app, it is a test guessing how long a menu takes to
     * appear. This asks.
     */
    await until('the member menu', `!!document.querySelector('.ctx')`)

    const menu = await js(`(() => {
      const m = document.querySelector('.ctx')
      return m
        ? { open: true, items: [...m.querySelectorAll('.mitem')].map((b) => b.textContent.trim()) }
        : { open: false } })()`)
    check('right-clicking somebody opens a menu', menu.open === true)
    check('it offers a nickname', (menu.items || []).some((t) => /nickname/i.test(t)), menu.items)

    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')]
        .find((x) => /nickname/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await wait(800)

    const box = await js(`(() => ({
      menuStillOpen: !!document.querySelector('.modal'),
      input: !!document.querySelector('.modal input'),
      buttons: [...document.querySelectorAll('.modal .mft button')].map((b) => b.textContent.trim())
    }))()`)
    check('the menu stays open', box.menuStillOpen === true)
    check('and a box to type in appears', box.input === true)
    /* Called Rename here, which is what the box does to a name. */
    check('with a way to save it',
      (box.buttons || []).some((b) => /save|rename|create/i.test(b)), box.buttons)

    await js(`(() => {
      const inp = document.querySelector('.modal input')
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(inp, 'Bailey the Dictator')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      return 1 })()`)
    await wait(300)
    await js(`(() => {
      const b = [...document.querySelectorAll('.modal .mft button')]
        /* Whatever the box calls the thing that keeps it - Save here,
           Rename in this client. Not Cancel. */
        .find((x) => !x.disabled && !/cancel/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await wait(2500)

    const after = await js(`(() => ({
      names: [...document.querySelectorAll('.mrow')].map((m) => m.textContent.trim()),
      menuGone: !document.querySelector('.ctx') }))()`)
    check('the nickname is applied',
      (after.names || []).some((t) => /Bailey the Dictator/.test(t)), after.names)

    /*
     * What the menu says about friendship.
     *
     * Reported from inside a server: "me and baileyyy are friends but in his
     * server when he right clicks my name it says Add Friend". The menu had
     * no idea friendship existed and offered to add everybody, for ever - so
     * it said that to people you have been friends with for months.
     *
     * Friendship is between two people and belongs to no server. That is
     * exactly why the menu inside a server has to be told: there is nothing
     * about the server it could work it out from.
     *
     * signIn already makes the owner and their friends friends, which is why
     * this reproduces here at all.
     */
    const openOn = async (who) => {
      await js(`(() => { document.body.click(); return 1 })()`)
      await wait(300)
      await js(`(() => {
        const row = [...document.querySelectorAll('.mrow')].find((m) => /${who}/.test(m.textContent))
        if (!row) return { found: false }
        const r = row.getBoundingClientRect()
        const x = r.left + 40, y = r.top + r.height / 2
        document.elementFromPoint(x, y).dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
        return { found: true } })()`)
      await until('the member menu', `!!document.querySelector('.ctx')`)
      return js(`(() => {
        const m = document.querySelector('.ctx')
        return m ? [...m.querySelectorAll('.mitem, .ctx .hint')].map((b) => b.textContent.trim()) : [] })()`)
    }

    // Renamed earlier in this spec, so match on what the row says now.
    const asFriend = await openOn('Bailey')
    check('a friend is not offered "Add friend"',
      !asFriend.some((t) => /^Add friend$/i.test(t)), asFriend)
    check('and is offered "Remove friend" instead',
      asFriend.some((t) => /^Remove friend$/i.test(t)), asFriend)

    /*
     * And somebody who is only in the server with you still is offered it,
     * or this would pass by never offering the item to anybody.
     */
    const joined = await js(`(async () => {
      const invite = ${JSON.stringify(setup.invite ?? '')}
      const r = await fetch('/api/register', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'Stranger', password: 'password123',
          displayName: 'Stranger', invite }) })
      const b = await r.json().catch(() => null)
      return { ok: !!(b && b.token) } })()`)
    check('somebody can join the server without being a friend', joined.ok === true, joined)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(2000)

    const asStranger = await openOn('Stranger')
    check('somebody you are not friends with IS offered "Add friend"',
      asStranger.some((t) => /^Add friend$/i.test(t)), asStranger)
  },
}
