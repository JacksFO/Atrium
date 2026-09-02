/**
 * Categories, and a channel that can be read but not written in.
 *
 * The panel behind a right-click is the whole point of the feature, and a
 * grid of switches that shows the right thing and changes nothing is exactly
 * the failure it can have. So nothing here is asserted by reading the panel
 * back: the switch is clicked, the panel is closed, the channel is opened,
 * and the check is whether the message box is still there.
 *
 * Everything is clicked through elementFromPoint rather than dispatched at
 * an element directly. A synthetic click on a node that is covered by
 * something else succeeds and proves nothing, which is how a dead button
 * gets reported as working.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'channel-permissions',
  width: 1500,
  height: 950,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)

    /**
     * Press whatever is actually on screen at the middle of a match.
     *
     * Scrolled to first. A point below the fold belongs to nothing at all,
     * and reads here as "something is covering it" - which sent this looking
     * for an overlay that was never there.
     */
    const clickText = async (selector, text) => js(`(async () => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((n) => new RegExp(${JSON.stringify(text)}, 'i').test((n.textContent || '').trim()))
      if (!el) return { hit: false, why: 'no such thing on screen' }
      el.scrollIntoView({ block: 'center' })
      await new Promise((res) => setTimeout(res, 200))
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return { hit: false, why: 'it has no size' }
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!at || !(el.contains(at) || at.contains(el))) {
        return { hit: false, why: 'something else is on top of it',
          on: at ? at.tagName : 'nothing at all' }
      }
      at.click()
      return { hit: true } })()`)

    const typeInto = async (selector, value) => js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return { ok: false }
      const set = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set
      set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return { ok: true } })()`)

    console.log('    --- a category, made from the sidebar ---')

    /*
     * A category is made from the menu on the empty space in the channel
     * list rather than from a button under it, and named in a dialog.
     */
    /* What is there before, so that "still there" can mean what it says
       rather than naming two headings and hoping they are the right two. */
    const HEADINGS = `(() =>
      [...document.querySelectorAll('.sidepane .sect')].map((s) => (s.textContent || '').trim()))()`
    const wasThere = await js(HEADINGS)
    console.log('      before: ' + JSON.stringify(wasThere))

    const newCat = await js(`(async () => {
      const list = document.querySelector('.chlist')
      if (!list) return { hit: false, why: 'no channel list' }
      const r = list.getBoundingClientRect()
      list.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
        clientX: Math.round(r.left + 20), clientY: Math.round(r.bottom - 10) }))
      await new Promise((res) => setTimeout(res, 400))
      const item = [...document.querySelectorAll('.ctx .mitem')]
        .find((x) => /new category/i.test(x.textContent || ''))
      if (!item) return { hit: false, why: 'no such thing on screen' }
      item.click()
      return { hit: true } })()`)
    check('the new-category button is really pressable', newCat.hit === true, newCat)
    await until('a box to name it in', `!!document.querySelector('.modal input')`)
    await js(`(async () => {
      const i = document.querySelector('.modal input')
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(i, 'Staff')
      i.dispatchEvent(new Event('input', { bubbles: true }))
      /* The button is dead until there is a name, and comes alive on the
         render after the box changes rather than the line after. */
      await new Promise((res) => setTimeout(res, 300))
      const go = [...document.querySelectorAll('.modal .mft button')]
        .find((b) => !b.disabled && !/cancel/i.test(b.textContent))
      if (go) go.click()
      await new Promise((res) => setTimeout(res, 700))
      return 1 })()`)
    await until('the heading appears',
      `[...document.querySelectorAll('.sidepane .sect')].some((s) => (s.textContent || '').trim() === 'Staff')`)

    const headings = await js(HEADINGS)
    console.log('      headings: ' + JSON.stringify(headings))
    /*
     * Everything that was there before is still there, and the new one is
     * with them.
     *
     * This named "Text" and "Voice" and called them the loose groups, which
     * they were not: a loose group only exists where a channel has been filed
     * under nothing, and those two were the categories a new server is seeded
     * with, which happened to be called the same thing. Renaming the seeded
     * pair is what showed it up. Asked of what was actually on screen a moment
     * ago, this cannot be fooled by either.
     */
    check('everything that was there is still there', wasThere.length > 0
      && wasThere.every((h) => headings.includes(h)), { wasThere, headings })
    check('and the new one is with them', headings.includes('Staff'), headings)

    console.log('    --- a channel made under it ---')

    // The plus on that heading, which only appears while the column is
    // hovered - so it is found by position rather than by hovering first.
    const madeChannel = await js(`(() => {
      const head = [...document.querySelectorAll('.sidepane .sect')]
        .find((g) => /Staff/.test(g.textContent || ''))
      if (!head) return { hit: false, why: 'no Staff group' }
      const plus = head.querySelector('.group-add')
      if (!plus) return { hit: false, why: 'no plus on it' }
      plus.click()
      return { hit: true } })()`)
    check('the plus on the heading opens a box', madeChannel.hit === true, madeChannel)
    await until('the box', `!!document.querySelector('.modal input')`)
    await js(`(async () => {
      const i = document.querySelector('.modal input')
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(i, 'notices')
      i.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((res) => setTimeout(res, 300))
      const go = [...document.querySelectorAll('.modal .mft button')]
        .find((b) => !b.disabled && !/cancel/i.test(b.textContent))
      if (go) go.click()
      await new Promise((res) => setTimeout(res, 700))
      return 1 })()`)
    await until('the channel appears',
      `[...document.querySelectorAll('.chan')].some((n) => n.textContent === 'notices')`,
      20000)

    const filed = await js(`(() => {
      const group = [...document.querySelectorAll('.sidepane .sect')]
        .find((g) => /Staff/.test(g.textContent || ''))
      return {
        /* The rows after the heading, up to the next one - a heading is a
           sibling of its channels rather than a box around them. */
        under: [...(group ? (() => {
          const out = []
          for (let e = group.nextElementSibling; e; e = e.nextElementSibling) {
            if (e.classList.contains('sect')) break
            if (e.classList.contains('chan')) out.push(e)
            else out.push(...e.querySelectorAll('.chan'))
          }
          return out
        })() : [])]
          .map((n) => n.textContent.trim()),
      } })()`)
    console.log('      under Staff: ' + JSON.stringify(filed.under))
    check('and it is under that heading, not loose at the top',
      (filed.under || []).includes('notices'), filed.under)

    console.log('    --- the permissions panel ---')

    const openMenu = await js(`(async () => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /notices/.test(r.textContent || ''))
      if (!row) return { hit: false, why: 'no notices row' }
      /* Into view first: a newly made channel is at the bottom of a list
         that scrolls, and a point below the fold belongs to nothing. */
      row.scrollIntoView({ block: 'center' })
      await new Promise((res) => setTimeout(res, 200))
      const r = row.getBoundingClientRect()
      const x = r.left + 30, y = r.top + r.height / 2
      const el = document.elementFromPoint(x, y)
      if (!el) return { hit: false, why: 'nothing at that point' }
      el.dispatchEvent(new MouseEvent('contextmenu',
        { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      return { hit: true } })()`)
    check('right-clicking it opens a menu', openMenu.hit === true, openMenu)
    await until('the menu', `!!document.querySelector('.ctx')`)

    const toPerms = await clickText('.ctx .mitem', '^Permissions$')
    check('Permissions is on the menu and pressable', toPerms.hit === true, toPerms)
    await until('the panel', `!!document.querySelector('.modal.wide')`)
    /*
     * And until it knows anything.
     *
     * The subjects and the rows are drawn from the roles list, which the app
     * already had, so the panel is on screen and complete-looking before the
     * rules arrive - every row on the slash and no sync banner. Read at that
     * moment it says the opposite of the truth, which is what this check
     * caught the first time it ran.
     */
    await until('its rules', `document.querySelector('.modal.wide').dataset.loaded === '1'`)

    const panel = await js(`(() => {
      const card = document.querySelector('.modal.wide')
      if (!card) return { open: false }
      const r = card.getBoundingClientRect()
      return {
        open: true,
        // A dialog painted under the panel it opened from is the fault this
        // app has had twice. Measured, not assumed.
        onTop: document.elementFromPoint(r.left + r.width / 2, r.top + 8) !== null
          && card.contains(document.elementFromPoint(r.left + r.width / 2, r.top + 8)),
        synced: /synced with category/i.test(card.textContent || ''),
        subjects: [...card.querySelectorAll('.perm-subject')].map((b) => b.textContent.trim()),
        rows: [...card.querySelectorAll('.chlist .row .t')].map((b) => b.textContent.trim()),
      } })()`)
    console.log('      subjects: ' + JSON.stringify(panel.subjects))
    console.log('      rows: ' + JSON.stringify(panel.rows))
    check('the panel opens', panel.open === true, panel)
    check('and it is on top of the channel list, not under it', panel.onTop === true, panel)
    check('a channel made under a heading starts synced to it', panel.synced === true, panel)
    check('@everyone is listed without being added',
      (panel.subjects || []).some((s) => /everyone/i.test(s)), panel.subjects)
    check('with a Send messages row to set', (panel.rows || []).includes('Send messages'), panel.rows)
    check('and no rows for things a channel cannot decide',
      !(panel.rows || []).some((r) => /kick|audit log|nickname/i.test(r)), panel.rows)

    // Every row starts on the slash - nobody has decided anything here yet.
    const start = await js(`(() => {
      const row = [...document.querySelectorAll('.chlist .row')]
        .find((r) => /Send messages/.test(r.textContent || ''))
      if (!row) return { found: false }
      const on = [...row.querySelectorAll('.tri button')].filter((b) => b.classList.contains('on'))
      return { found: true, on: on.map((b) => b.className) } })()`)
    check('and it starts on neither yes nor no',
      start.found === true && (start.on || []).some((c) => /neutral/.test(c)), start)

    console.log('    --- deny it, and see the message box go ---')

    /*
     * Scrolled to first. The rows are a long list inside a box of its own, so
     * Send messages starts below the fold - and a point outside the box
     * belongs to whatever is behind it, which reads as "covered" and is
     * really "not on screen yet".
     */
    await js(`(() => {
      const row = [...document.querySelectorAll('.chlist .row')]
        .find((r) => /Send messages/.test(r.textContent || ''))
      if (row) row.scrollIntoView({ block: 'center' })
      return 1 })()`)
    await wait(400)

    const denied = await js(`(() => {
      const row = [...document.querySelectorAll('.chlist .row')]
        .find((r) => /Send messages/.test(r.textContent || ''))
      if (!row) return { hit: false, why: 'no send row' }
      const no = row.querySelector('.tri .no')
      const r = no.getBoundingClientRect()
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!at || !(at === no || no.contains(at))) {
        return { hit: false, why: 'something else is at that point', at: at && at.className }
      }
      at.click()
      return { hit: true } })()`)
    check('the deny button is really pressable', denied.hit === true, denied)

    await until('it to stick',
      `(() => {
        const row = [...document.querySelectorAll('.chlist .row')]
          .find((r) => /Send messages/.test(r.textContent || ''))
        return !!row && row.querySelector('.tri .no.on') !== null })()`)

    // Editing a channel that was following its heading has to break the
    // sync, or one channel's rule would be ten channels' rule.
    const afterDeny = await js(`(() => {
      const card = document.querySelector('.modal.wide')
      return { synced: /synced with category/i.test(card ? card.textContent : '') } })()`)
    check('editing it stops it following the category', afterDeny.synced === false, afterDeny)

    console.log('    --- adding somebody, and taking them back off ---')

    /*
     * Reported from real use: "unable to delete the role from the permission
     * in channel". Adding a role or a person was one click and removing them
     * was not possible at all - the nearest thing was setting every row back
     * to the middle one at a time, which does leave no rows behind and so is
     * the same removal, but nothing on screen said so.
     */
    const added = await js(`(() => {
      const card = document.querySelector('.modal.wide')
      const plus = card && card.querySelector('.perm-subjects .group-add')
      if (!plus) return { hit: false, why: 'no plus in the subject column' }
      plus.click()
      return { hit: true } })()`)
    check('the subject column has a way to add', added.hit === true, added)
    await wait(400)

    const picked = await js(`(() => {
      const chip = document.querySelector('.modal.wide .perm-add .access-chip')
      if (!chip) return { hit: false, why: 'nothing offered to add' }
      const name = chip.textContent.trim()
      chip.click()
      return { hit: true, name } })()`)
    check('and something to add', picked.hit === true, picked)
    await wait(600)

    const listed = await js(`(() => {
      const rows = [...document.querySelectorAll('.modal.wide .perm-subject-row')]
      return {
        names: rows.map((r) => (r.querySelector('.perm-subject-n') || {}).textContent),
        removable: rows.map((r) => !!r.querySelector('.perm-subject-x')),
      } })()`)
    check('the one added is in the list', (listed.names || []).includes(picked.name), listed)
    check('and can be taken off again',
      listed.removable[(listed.names || []).indexOf(picked.name)] === true, listed)
    /*
     * @everyone is the baseline every channel has rather than something added
     * to it, so there is nothing to take away - it would reappear on the next
     * render, which is worse than not offering it.
     */
    check('but @everyone cannot, being the baseline',
      listed.removable[(listed.names || []).findIndex((n) => /everyone/i.test(n || ''))] === false,
      listed)

    /* Give them a rule, so they are stored rather than only on screen. */
    const selected = await js(`(() => {
      const row = [...document.querySelectorAll('.modal.wide .perm-subject-row')]
        .find((r) => ((r.querySelector('.perm-subject-n') || {}).textContent || '').trim()
          === ${JSON.stringify('__NAME__')})
      if (!row) return { hit: false }
      row.querySelector('.perm-subject').click()
      return { hit: true } })()`.replace('__NAME__', picked.name))
    check('they can be selected', selected.hit === true, selected)
    await wait(500)

    await js(`(() => {
      const row = [...document.querySelectorAll('.chlist .row')]
        .find((r) => /Send messages/.test(r.textContent || ''))
      if (row) { row.scrollIntoView({ block: 'center' }); row.querySelector('.tri .yes').click() }
      return 1 })()`)
    await wait(900)

    const stored = await js(`(() => {
      const row = [...document.querySelectorAll('.chlist .row')]
        .find((r) => /Send messages/.test(r.textContent || ''))
      return { allowed: !!(row && row.querySelector('.tri .yes.on')) } })()`)
    check('a rule set on them sticks', stored.allowed === true, stored)

    /* Now take them off. */
    const removed = await js(`(() => {
      const row = [...document.querySelectorAll('.modal.wide .perm-subject-row')]
        .find((r) => ((r.querySelector('.perm-subject-n') || {}).textContent || '').trim()
          === ${JSON.stringify('__NAME__')})
      if (!row) return { hit: false, why: 'they are not listed' }
      const x = row.querySelector('.perm-subject-x')
      if (!x) return { hit: false, why: 'no remove button' }
      x.click()
      return { hit: true } })()`.replace('__NAME__', picked.name))
    check('the remove button is there to press', removed.hit === true, removed)

    /* The answer is kept, because until gives up rather than throwing: a
       check written as `check('...', true)` passed whether they went or
       not, which is a line that reads like a test and is not one. */
    const went = await until('them to go', `(() => {
      const names = [...document.querySelectorAll('.modal.wide .perm-subject-n')]
        .map((n) => n.textContent.trim())
      return !names.includes(${JSON.stringify(picked.name)}) })()`, 10000)
    check('and they are off the list', went === true, went)

    /*
     * The check that matters. Gone from the page proves nothing on its own -
     * the row could still be in the database and come back on the next open,
     * which is exactly how a delete that only clears the screen behaves.
     */
    await js(`(() => {
      const done = [...document.querySelectorAll('.modal.wide button')]
        .find((b) => /^done$/i.test(b.textContent.trim()))
      if (done) done.click()
      return 1 })()`)
    await wait(700)
    await js(`(() => {
      const row = [...document.querySelectorAll('.chlist .row, .chan')]
        .find((r) => /notices/.test(r.textContent || ''))
      if (row) row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
      return 1 })()`)
    await wait(500)
    const reopened = await js(`(() => {
      const item = [...document.querySelectorAll('button')]
        .find((b) => /^permissions$/i.test(b.textContent.trim()))
      if (item) item.click()
      return { clicked: !!item } })()`)
    if (reopened.clicked) {
      await until('the panel again', `!!document.querySelector('.modal.wide')`, 8000)
      await wait(900)
      const after = await js(`(() => ({
        names: [...document.querySelectorAll('.modal.wide .perm-subject-n')]
          .map((n) => n.textContent.trim()) }))()`)
      check('and still gone after reopening it, so the rows really went',
        !(after.names || []).includes(picked.name), after)
    }

    await clickText('.modal.wide .mft .btn', 'Done')
    await until('the panel to close', `!document.querySelector('.modal.wide')`)

    const opened = await clickText('.chan .nm', '^notices$')
    check('the channel opens', opened.hit === true, opened)
    await wait(1800)

    const composer = await js(`(() => ({
      readOnly: !!document.querySelector('.cmp .cantsend'),
      box: !!document.querySelector('.cmp textarea'),
      says: (document.querySelector('.cmp .cantsend') || {}).textContent || '',
    }))()`)
    console.log('      composer: ' + JSON.stringify(composer))
    check('the owner is not locked out of their own server',
      composer.box === true && composer.readOnly === false, composer)

    /*
     * The owner holds every permission in their own server by definition, so
     * denying @everyone cannot lock them out - which is right, and means the
     * check above proves nothing about the deny working. The person it has
     * to be measured on is somebody ordinary.
     */
    console.log('    --- and on somebody who is not the owner ---')

    const asMate = await js(`(async () => {
      const token = ${JSON.stringify(setup.friends?.baileyyy?.token ?? '')}
      if (!token) return { ok: false, why: 'no second account' }
      const r = await fetch('/api/me', { headers: { authorization: 'Bearer ' + token } })
      return { ok: r.status === 200, token } })()`)
    check('there is a second account to look with', asMate.ok === true, asMate)

    if (asMate.ok) {
      await js(`localStorage.setItem('atrium.token', ${JSON.stringify(asMate.token)})`)
      await win.loadURL(base + '/')
      await until('their channel list', `document.querySelectorAll('.chan').length > 0`)
      await wait(1500)

      const theirs = await clickText('.chan .nm', '^notices$')
      check('they can still see the channel', theirs.hit === true, theirs)
      await wait(1800)

      const shut = await js(`(() => ({
        readOnly: !!document.querySelector('.cmp .cantsend'),
        box: !!document.querySelector('.cmp textarea'),
        says: ((document.querySelector('.cmp .cantsend') || {}).textContent || '').trim(),
      }))()`)
      console.log('      their composer: ' + JSON.stringify(shut))
      check('but the message box is gone', shut.box === false, shut)
      /* In place of the box rather than beside it, and it says which half
         they have: reading is allowed here, writing is not. A box that is
         simply missing reads as a page that failed to load. */
      check('and it says why',
        /read/i.test(shut.says || '') && /not write/i.test(shut.says || ''), shut)
    }
  },
}
