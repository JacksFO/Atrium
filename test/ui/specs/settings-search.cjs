/**
 * Finding a setting without knowing which drawer it is in.
 *
 * Nine panes is small enough to hunt through and large enough to be annoying.
 * Taken from settings-layout, which asked for this alongside a rebuild of the
 * whole screen: the search is the half that is a feature rather than a
 * rearrangement.
 */
const { signIn } = require('../lib.cjs')
const W = require('../where.cjs')

const SEARCH = (q) => `(() => {
  const box = document.querySelector('${W.SETTINGS_FIND}')
  if (!box) return { ok: false, why: 'no search box' }
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(box, ${JSON.stringify(q)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  return { ok: true } })()`

const RESULTS = `(() => {
  const rows = [...document.querySelectorAll('${W.SETTINGS_HIT}')]
  return {
    count: rows.length,
    titles: rows.map((r) => r.querySelector('b')?.textContent.trim()),
    wheres: rows.map((r) => r.querySelector('span')?.textContent.trim()),
  } })()`

module.exports = {
  name: 'settings-search',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1500)
    await js(`(() => {
      const b = document.querySelector('.mebar button[aria-label="Your settings"]')
      if (b) b.click()
      return 1 })()`)
    await until('settings', `!!document.querySelector('.settings')`, 8000)
    await wait(600)

    check('there is a search box',
      await js(`!!document.querySelector('${W.SETTINGS_FIND}')`) === true)

    // ---- it finds the setting, and says where it lives -------------------
    await js(SEARCH('noise'))
    await wait(400)
    const found = await js(RESULTS)
    console.log('      for "noise": ' + JSON.stringify(found))
    check('searching finds something', found.count > 0, found)
    check('and it is the setting itself, with where it lives',
      found.titles[0] === 'Noise suppression' && /Voice/.test(found.wheres[0] ?? ''), found)

    // ---- choosing one opens the pane it is on ----------------------------
    await js(`(() => { const r = document.querySelector('${W.SETTINGS_HIT}'); if (r) r.click(); return 1 })()`)
    await wait(800)
    const landed = await js(`(() => ({
      heading: (document.querySelector('${W.SETTINGS_PANE} .stitle') || {}).textContent || null,
      rows: [...document.querySelectorAll('${W.SETTINGS_PANE} [data-row]')].map((r) => r.dataset.row),
      lit: [...document.querySelectorAll('${W.SETTINGS_PANE} .row.lit')].map((r) => r.dataset.row),
      stillTyped: (document.querySelector('${W.SETTINGS_FIND}') || {}).value || '',
      dropdown: document.querySelectorAll('${W.SETTINGS_HIT}').length,
    }))()`)
    console.log('      landed: ' + JSON.stringify({ heading: landed.heading, lit: landed.lit }))
    check('choosing it opens the pane it is on', landed.heading === 'Voice & video', landed.heading)
    check('and the row it was about is there',
      (landed.rows || []).includes('noise suppression'), landed.rows)
    /* Opening the pane is half an answer: a row eight down a scrolling pane
       is still somewhere to hunt for. */
    check('and it is pointed at', (landed.lit || []).includes('noise suppression'), landed.lit)
    /* The words stay in the box: somebody who landed on the wrong one of two
       results wants the other still listed, not a list to type again. The
       list itself gets out of the way, because it hangs over the pane that
       was just opened. */
    check('the words are still in the box', landed.stillTyped === 'noise', landed.stillTyped)
    check('and the list is out of the way of the pane it opened',
      landed.dropdown === 0, landed.dropdown)

    // ---- a word people use instead of the label --------------------------
    await js(SEARCH('ptt'))
    await wait(400)
    const other = await js(RESULTS)
    console.log('      for "ptt": ' + JSON.stringify(other.titles))
    check('and a word people use instead of the label still finds it',
      (other.titles ?? []).includes('Hold a key to talk'), other)

    await js(SEARCH('spotify'))
    await wait(400)
    const music = await js(RESULTS)
    check('and another one', (music.titles ?? [])[0] === 'Show what you are listening to', music)

    // ---- and the two ends ------------------------------------------------
    await js(SEARCH('xyzzy'))
    await wait(400)
    const none = await js(RESULTS)
    check('something that matches nothing offers nothing', none.count === 0, none)

    /* The pane list used to be replaced by the results, because both were in
       the same column. The results are their own thing now, so the list is
       never taken away - which is what makes a search that matches nothing
       harmless. */
    const during = await js(`[...document.querySelectorAll('${W.SETTINGS_ITEM}')].map((b) => b.textContent.trim())`)
    check('the pane list is still there while searching',
      during.includes('Appearance') && during.includes('About'), during)

    await js(SEARCH(''))
    await wait(400)
    const back = await js(`(() => ({
      panes: [...document.querySelectorAll('${W.SETTINGS_ITEM}')].map((b) => b.textContent.trim()),
      hits: document.querySelectorAll('${W.SETTINGS_HIT}').length,
    }))()`)
    check('and clearing it takes the results away',
      back.hits === 0 && back.panes.includes('Appearance'), back)
  },
}
