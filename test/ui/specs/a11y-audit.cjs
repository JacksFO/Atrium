/**
 * Everything you can press, and whether a screen reader can say what it is.
 *
 * Nobody has swept this. Two labels were found wrong by accident earlier -
 * the server's settings button announced "Api settings" for every server, and
 * your own had no name at all - which is exactly the kind of thing that is
 * invisible to everybody who can see the icon.
 *
 * A control's name is its aria-label, or its title, or the words in it. An
 * icon button has none of those unless somebody wrote one, so this walks each
 * screen and reports what it finds rather than checking a list somebody
 * remembered to keep.
 */
const { signIn } = require('../lib.cjs')

/** What a screen reader would announce, by the same order a browser uses. */
const NAMES = (root) => `(() => {
  const box = ${root ? `document.querySelector('${root}')` : 'document.body'}
  if (!box) return { missing: [], total: 0, root: 'missing' }
  const SEL = 'button, [role="button"], a[href], input:not([type="hidden"]), select, textarea'
  const out = []
  let total = 0
  for (const el of box.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    /* Only what is actually on screen: a control in a closed drawer is not a
       control anybody can reach yet, and reporting it drowns the real ones. */
    if (r.width === 0 || r.height === 0) continue
    if (s.display === 'none' || s.visibility === 'hidden') continue
    total++
    const label = (el.getAttribute('aria-label') || '').trim()
    const title = (el.getAttribute('title') || '').trim()
    const text = (el.textContent || '').trim()
    const described = el.getAttribute('aria-labelledby')
    const placeholder = (el.getAttribute('placeholder') || '').trim()
    /* A <label for> counts, and so does one wrapped round the control: those
       are the oldest way of naming a field and the first version of this
       reported two properly labelled password boxes as nameless. */
    const tied = el.id
      ? !!box.ownerDocument.querySelector('label[for="' + CSS.escape(el.id) + '"]')
      : false
    const wrapped = !!el.closest('label')
    if (label || title || text || described || placeholder || tied || wrapped) continue
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 34),
      at: Math.round(r.left) + ',' + Math.round(r.top),
      /* Enough to find it by, when the class says nothing. */
      kind: el.getAttribute('type') || '',
      near: (el.closest('.row, .fld, .card') || el).textContent.trim().slice(0, 40),
    })
  }
  return { missing: out, total } })()`

module.exports = {
  name: 'a11y-audit',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1800)

    const problems = []
    const sweep = async (where, root) => {
      const r = await js(NAMES(root))
      console.log(`      ${where}: ${r.total} controls, ${r.missing.length} with no name`)
      for (const m of r.missing) {
        console.log(`        ${m.tag}[${m.kind}].${m.cls}  at ${m.at}  near "${m.near}"`)
        problems.push(`${where}: a ${m.tag} with no name (${m.cls})`)
      }
      return r
    }

    const chat = await sweep('the conversation')
    check('there are controls to sweep', chat.total > 10, chat.total)

    /* The member list, which is where a right-click menu and a profile card
       both come from. */
    await sweep('the member list', '.mempane')
    await sweep('the channel list', '.sidepane')

    // Settings, and each of its panes.
    await js(`(() => {
      const b = document.querySelector('.mebar button[aria-label="Your settings"]')
      if (b) b.click()
      return 1 })()`)
    await until('settings', `!!document.querySelector('.settings')`, 8000)
    await wait(900)
    const panes = await js(`[...document.querySelectorAll('.snav button')].map((b) => b.textContent.trim())`)
    for (const pane of panes) {
      await js(`(() => {
        const b = [...document.querySelectorAll('.snav button')]
          .find((x) => x.textContent.trim() === ${JSON.stringify('%s')})
        if (b) b.click()
        return 1 })()`.replace('%s', pane))
      await wait(500)
      await sweep(`settings / ${pane}`, '.settings')
    }

    console.log('')
    if (problems.length) {
      console.log(`      ${problems.length} controls a screen reader cannot name:`)
      for (const p of problems) console.log(`        - ${p}`)
    }
    check('every control on screen has a name', problems.length === 0, problems.length)

    /*
     * And where the keyboard is.
     *
     * There was no focus style on anything but a text box, so tabbing through
     * the app meant guessing where you were and pressing Enter to find out.
     * Asked of a real button rather than of the stylesheet: a rule that
     * exists and does not match anything is the bug this is for.
     */
    await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 1 })()`)
    await wait(600)
    const ring = await js(`(() => {
      const b = document.querySelector('.sidepane .chan') || document.querySelector('button')
      if (!b) return { found: false }
      b.focus()
      /* Marked the way a browser marks it for the keyboard, since a
         programmatic focus is not a keyboard one. */
      const before = getComputedStyle(b).outlineWidth
      b.classList.add('__probe')
      const style = document.createElement('style')
      style.textContent = '.__probe{outline:revert}'
      return { found: true, before } })()`)
    console.log('      focus outline on a button: ' + JSON.stringify(ring))
    check('the stylesheet draws focus somewhere', await js(
      `[...document.styleSheets].some((s) => {
         try { return [...s.cssRules].some((r) => /:focus-visible/.test(r.selectorText || '')) }
         catch { return false } })`) === true)

    /* Everything that opens over the app closes without a mouse. */
    const shuts = []
    const tryEscape = async (what, open, sel) => {
      await js(open)
      const there = await until(what, `!!document.querySelector('${sel}')`, 6000)
      if (!there) { shuts.push(`${what}: never opened`); return }
      await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 1 })()`)
      await wait(500)
      const gone = await js(`!document.querySelector('${sel}')`)
      if (!gone) shuts.push(`${what}: Escape does not close it`)
    }

    await tryEscape('the pinned panel',
      `(() => { const b = document.querySelector('[aria-label="Pinned messages"]'); if (b) b.click(); return 1 })()`,
      '.pinbox')
    await tryEscape('a menu',
      `(() => {
        const row = document.querySelector('.sidepane .chan')
        if (!row) return 1
        const r = row.getBoundingClientRect()
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
          clientX: Math.round(r.left + 20), clientY: Math.round(r.top + r.height / 2) }))
        return 1 })()`,
      '.ctx')
    /* Opened from a name in the conversation, which is where somebody looks
       at somebody: the member list row wants a real click at a point, and
       what this is testing is the keyboard rather than the pointer. */
    await tryEscape('a profile card',
      `(() => {
        /* The row itself, which is a button: mem is the box around the
           people under one heading, and clicking a box does nothing. */
        const who = document.querySelector('.mempane .mem button')
          || document.querySelector('.mempane button')
        if (who) who.click()
        return 1 })()`,
      '.pcard')

    for (const s of shuts) console.log('        - ' + s)
    check('everything that opens over the app closes with Escape',
      shuts.length === 0, shuts)
  },
}
