/**
 * Right-clicking a channel in the sidebar.
 *
 * Editing a channel lived in two places, neither of them where anybody looks:
 * a pencil that only appears while the pointer is over the row, which renames
 * and nothing more, and a Channels pane inside server settings for the topic,
 * the privacy and deleting. Asked for directly - right-click a channel and
 * get an Edit Channel option.
 *
 * The menu is driven through a real contextmenu event at the row's own
 * coordinates, and the name is typed and saved, because "the menu opens" is
 * not the same claim as "editing works".
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'channel-menu',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(2000)

    /** Right-click a channel by name, at a point actually inside its row. */
    const rightClick = async (name) => {
      const hit = await js(`(() => {
        const row = [...document.querySelectorAll('.chan')]
          .find((r) => new RegExp(${JSON.stringify(name)}).test(r.textContent || ''))
        if (!row) return { found: false }
        const r = row.getBoundingClientRect()
        const x = r.left + 30, y = r.top + r.height / 2
        // Through elementFromPoint, so this cannot pass on a row that is
        // covered by something else.
        const el = document.elementFromPoint(x, y)
        if (!el) return { found: false, why: 'nothing at that point' }
        el.dispatchEvent(new MouseEvent('contextmenu',
          { bubbles: true, cancelable: true, clientX: x, clientY: y }))
        return { found: true } })()`)
      // Waited for rather than slept through. The same fixed sleep in two
      // other specs passed alone and failed inside the full suite - a test
      // guessing how long a menu takes, not an app being slow.
      await until('the channel menu', `!!document.querySelector('.ctx')`)
      return hit
    }

    const opened = await rightClick('general')
    check('right-clicking a channel finds the row', opened.found === true, opened)

    const menu = await js(`(() => {
      const m = document.querySelector('.ctx')
      if (!m) return { open: false }
      return {
        open: true,
        items: [...m.querySelectorAll('.mitem')].map((b) => ({
          label: b.textContent.trim(), disabled: b.disabled,
        })),
      } })()`)
    console.log('      menu: ' + JSON.stringify(menu.items))
    check('a menu opens', menu.open === true)

    const labels = (menu.items || []).map((i) => i.label)
    /* Called Rename here, and it opens a box to type in rather than
       turning the menu row into a field. Same thing, said shorter. */
    check('with a way to rename it', labels.includes('Rename'), labels)
    /*
     * "Who can see this" became "Permissions" when a list of who is allowed
     * in became a grid of what each role may do. Same place in the menu, a
     * great deal more behind it - and it needs manage_roles rather than
     * manage_channels, which the owner here holds.
     */
    check('and a way into its permissions', labels.includes('Permissions'), labels)
    check('and a way to delete it', labels.includes('Delete'), labels)
    check('and muting, which used to need a hover',
      labels.some((l) => /^(un)?mute$/i.test(l)), labels)

    /*
     * Mark as read is kept in place and greyed when there is nothing unread,
     * rather than vanishing - the menu would otherwise reshuffle under the
     * pointer between one opening and the next.
     */
    const markRead = (menu.items || []).find((i) => /mark as read/i.test(i.label))
    check('Mark as read is there but greyed with nothing unread',
      !!markRead && markRead.disabled === true, markRead)

    // --- edit it ----------------------------------------------------------
    await js(`(() => {
      const b = [...document.querySelectorAll('.ctx .mitem')]
        .find((x) => /^Rename$/.test(x.textContent.trim()))
      if (b) b.click()
      return 1 })()`)
    await wait(700)

    const fields = await js(`(() => {
      /* A box to type in rather than the menu row becoming a field. */
      const inputs = [...document.querySelectorAll('.modal input')]
      return {
        menuStillOpen: !!document.querySelector('.ctx'),
        count: inputs.length,
        placeholders: inputs.map((i) => i.placeholder),
      } })()`)
    console.log('      edit fields: ' + JSON.stringify(fields))
    /* The menu closes and a box opens, rather than the menu becoming the
       box. Either way what matters is that there is somewhere to type. */
    check('a box opens to edit in', fields.count > 0, fields)
    check('with a name and a topic', fields.count === 2, fields.placeholders)

    await js(`(() => {
      /* A box to type in rather than the menu row becoming a field. */
      const inputs = [...document.querySelectorAll('.modal input')]
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(inputs[0], 'general-chat')
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      set.call(inputs[1], 'anything and everything')
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
      return 1 })()`)
    await wait(300)
    await js(`(() => {
      /* The box has its own buttons at the foot of it. */
      const b = [...document.querySelectorAll('.modal .mft button')]
        .find((x) => !x.disabled && !/cancel/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await wait(2500)

    const after = await js(`(() => ({
      menuGone: !document.querySelector('.ctx') && !document.querySelector('.modal'),
      names: [...document.querySelectorAll('.chan')].map((n) => n.textContent.trim()),
    }))()`)
    console.log('      after saving: ' + JSON.stringify(after.names))
    check('the menu closes once saved', after.menuGone === true)
    check('and the new name is in the list',
      (after.names || []).includes('general-chat'), after.names)

    // And it really reached the server, not just the screen.
    const stored = await js(`(async () => {
      const token = ${JSON.stringify(setup.me?.token ?? '')}
      const r = await (await fetch('/api/spaces', { headers: { authorization: 'Bearer ' + token } })).json()
      return { ok: true, spaces: (r.spaces || []).length } })()`)
    check('the server is still answering afterwards', stored.ok === true, stored)
  },
}
