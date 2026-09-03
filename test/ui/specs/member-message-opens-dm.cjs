/**
 * "Message" on a person in a server's member list.
 *
 * It asked the server for the conversation and then set which channel was
 * open - and nothing else. Which channel is open is only half of where you
 * are: the other half is which server, and while that says a server the
 * conversation cannot resolve at all (`space ? null : chats.find(...)`), so
 * the id was set to something the screen had no way to render. The menu
 * closed, the member list stayed exactly where it was, and the middle of the
 * app said "Pick a channel to start reading."
 *
 * Every other way into a conversation is reached from the conversations
 * screen, where that half is already right - which is why this one item was
 * the only one that did nothing.
 *
 * Reported: "When right clicking someone in the members list and clicking
 * Message it should open the DM with them."
 *
 * From the member list of a server on purpose. Run from the Friends screen
 * this passes without the fix.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'member-message-opens-dm',
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
      await until('members', `document.querySelectorAll('.mrow').length >= 2`))

    /* The precondition, asserted rather than assumed: this has to start
       inside a server, or the bug cannot happen and the test proves nothing.
       `.rl.on` is the tile on the rail for wherever you are. */
    const started = await js(`(() => {
      const on = document.querySelector('.rl.on')
      return {
        inASpace: !!on && !/conversation/i.test(on.getAttribute('title') || ''),
        title: on ? on.getAttribute('title') : null,
      } })()`)
    check('and this starts inside a server, not on the conversations screen',
      started.inASpace === true, started)

    await js(`(() => {
      const row = [...document.querySelectorAll('.mrow')].find((m) => /Baileyyy/.test(m.textContent))
      if (!row) return { found: false }
      const r = row.getBoundingClientRect()
      const x = r.left + 40, y = r.top + r.height / 2
      /* Through elementFromPoint, so this is the thing a real right-click
         would actually land on. */
      document.elementFromPoint(x, y).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      return { found: true } })()`)
    await until('the member menu', `!!document.querySelector('.ctx')`)

    const items = await js(`(() => {
      const m = document.querySelector('.ctx')
      return m ? [...m.querySelectorAll('.mitem')].map((b) => b.textContent.trim()) : [] })()`)
    check('the menu offers Message', items.some((t) => /^Message$/i.test(t)), items)

    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')]
        .find((x) => /^Message$/i.test(x.textContent.trim()))
      if (b) b.click()
      return 1 })()`)

    /*
     * The whole of it. Waited for rather than slept through, because this
     * asks the server for the conversation before it can go anywhere.
     */
    const landed = await until('the conversation with them to open',
      `(() => {
        const head = document.querySelector('.chatpane .chd .tt')
        return !!head && /Baileyyy/.test(head.textContent || '')
      })()`, 12000)
    check('clicking Message opens the conversation with them', landed === true)

    const after = await js(`(() => {
      const on = document.querySelector('.rl.on')
      return {
        header: (document.querySelector('.chatpane .chd .tt') || {}).textContent || '',
        canType: !!document.querySelector('.cmp'),
        /* Nothing to read is what this looked like when it was broken. */
        emptyMiddle: /Pick a channel/i.test(document.body.textContent || ''),
        railTitle: on ? on.getAttribute('title') : null,
        /* And it is in the list beside it, not merely open - a conversation
           made this second is one the list has never been told about. */
        inTheList: [...document.querySelectorAll('.chan, .dmrow, .drow')]
          .some((n) => /Baileyyy/.test(n.textContent || '')),
      } })()`)
    console.log('      landed on: ' + JSON.stringify(after))

    check('with somewhere to write to them', after.canType === true, after)
    check('and not the empty middle it used to leave you on',
      after.emptyMiddle === false, after)
    /* The half that was missing: which server you are in had to move too. */
    check('and the rail moved to the conversations screen',
      /conversation/i.test(after.railTitle || ''), after.railTitle)
    check('and they are in the list beside it', after.inTheList === true, after)
  },
}
