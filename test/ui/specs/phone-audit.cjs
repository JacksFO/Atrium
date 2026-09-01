/**
 * Every control on a phone, swept rather than sampled.
 *
 * Asked for as "do a full audit of the phone app make sures all buttons and
 * layout all works, everything is accessilbe etc and things dont get
 * overlapped etc".
 *
 * phone-layout checks the handful of controls that were reported broken.
 * This one does not know which those are: it walks each screen, finds
 * everything that can be pressed, and asks the same three questions of all of
 * it. Does a finger land on it, or is something else on top. Is it inside the
 * screen. Is it big enough to hit.
 *
 * Written to survive the app growing. A control added next month is swept
 * without anybody remembering to add it here, which is the whole reason for
 * doing it this way round.
 */
const { signIn } = require('../lib.cjs')

/** The settings window covers the app, so it is its own layer. */
const SETTINGS_ROOT = '.settings'

/**
 * What counts as a target, and what is allowed to be small.
 *
 * Forty is the number both Apple and Google land near, and it is about the
 * width of a fingertip. The exceptions are things that are not really
 * targets: a control inside a scrolling row of them, where the row is the
 * target and the thumb, and text links inside a paragraph, which are read
 * rather than aimed at.
 */
const SWEEP = (root) => `(() => {
  const SEL = 'button, [role="button"], a[href], input, select, textarea, .chan, .mem, .rail-pip, .rail-home'
  /*
   * Only the layer somebody is actually looking at.
   *
   * With a drawer open the chat behind it is covered, correctly and on
   * purpose - reporting all of it drowned the two controls that were really
   * in the way. So each screen names the thing that is on top, and the sweep
   * asks about what is inside it.
   */
  const cxOf = (r) => r.left + r.width / 2
  const cyOf = (r) => r.top + r.height / 2
  const scope = ${JSON.stringify(root)} ? document.querySelector(${JSON.stringify(root)}) : document
  if (!scope) return { controls: [], missingRoot: true }
  const out = []
  for (const el of scope.querySelectorAll(SEL)) {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden') continue
    /*
     * Invisible is its own fault, not a reason to skip.
     *
     * A control at zero opacity still answers a tap - so it is not hidden,
     * it is a button nobody can see, which is worse than one that is not
     * there. This is how the whole row of screen-share controls came to be
     * unusable on a phone: they fade in on hover, and a phone never hovers.
     */
    const invisible = Number(s.opacity) === 0
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    /*
     * Entirely off screen is not a fault, in any direction.
     *
     * A drawer is parked off the left until it is opened and a list carries
     * on below the fold - both deliberate. Asking about those reported the
     * whole closed drawer as covered, by nothing, which drowned the two
     * things that were actually wrong. What is left is what somebody can
     * see right now, and crossing an edge while partly visible is the real
     * complaint.
     */
    if (r.right < 0 || r.left > window.innerWidth) continue
    if (r.bottom < 0 || r.top > window.innerHeight) continue
    // Half off the edge of a scrolling pane is a thing you scroll to, not a
    // thing that is broken. Its middle has to be visible to be asked about.
    if (cxOf(r) < 0 || cxOf(r) > window.innerWidth) continue
    if (cyOf(r) < 0 || cyOf(r) > window.innerHeight) continue

    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const at = document.elementFromPoint(cx, cy)

    /*
     * Can a fingertip land on it, rather than is its box forty pixels.
     *
     * The box is a proxy and a poor one in both directions. A control drawn
     * small can carry a generous hit area around it, which is how a toggle
     * stays a toggle and still gets caught; and a control drawn large can be
     * covered at the edges by something above it. So this asks the question
     * itself: five points across a forty-pixel square, and all of them have
     * to reach the thing.
     */
    /*
     * A cross, not a square.
     *
     * Probing the corners of a forty-pixel square fails every forty-pixel
     * button, because a button has rounded corners and the corner of the
     * square is outside them - which reported the entire app as unreachable
     * immediately after it had all been made reachable. Across and down
     * through the middle is the measure that means something: forty pixels
     * of it in both directions.
     */
    const HALF = 19
    let blocker = null
    /*
     * Points outside the window are not asked about.
     *
     * elementFromPoint answers null for anything off screen, so a control
     * sitting near the top or bottom of a scrolling pane had a probe land
     * outside the viewport and came back unreachable - which is not true, it
     * is a thing you scroll to. Reported the toggles in settings as too small
     * while they were perfectly reachable a hundred pixels further down.
     */
    /*
     * And points outside the box the thing scrolls in, for the same reason.
     *
     * A list taller than the space it has is scrolled, and the last row in
     * it hangs below the fold - its box is real and half of it is behind
     * whatever comes after the scroller, which here is the bar with your
     * name on it. That is a row you scroll to, not a row you cannot reach,
     * and the rule above already says so about the window; a scroller is
     * the same thing one level in.
     */
    const scroller = (() => {
      let up = el.parentElement
      while (up) {
        const o = getComputedStyle(up).overflowY
        if (o === 'auto' || o === 'scroll') return up.getBoundingClientRect()
        up = up.parentElement
      }
      return null
    })()
    const inView = (x, y) =>
      x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight
      /* Inside its edges rather than up against them: a point on the
         boundary belongs to whatever is drawn after the scroller, which
         is a pixel of arithmetic rather than a control out of reach. */
      && (!scroller || (y >= scroller.top + 2 && y <= scroller.bottom - 2))
    const reach = [[0, 0], [-HALF, 0], [HALF, 0], [0, -HALF], [0, HALF]]
      .every(([dx, dy]) => {
        const px = cx + dx
        const py = cy + dy
        if (!inView(px, py)) return true
        const p = document.elementFromPoint(px, py)
        const ok = !!(p && (p === el || el.contains(p)))
        // What is there instead, so a failure names it rather than leaving
        // it to be guessed at from a width.
        if (!ok && !blocker) {
          /* Where, as well as what: "blocked by chd" on a button that looks
             the right size is unreadable without the point that missed. */
          const chain = []
          let up = p
          while (up && chain.length < 4) {
            chain.push((typeof up.className === 'string' && up.className
              ? up.className.slice(0, 20) : up.tagName))
            up = up.parentElement
          }
          blocker = (p ? chain.join('<') : 'nothing')
            + ' at ' + Math.round(px) + ',' + Math.round(py)
            + ' of ' + Math.round(r.left) + ',' + Math.round(r.top)
            + '-' + Math.round(r.right) + ',' + Math.round(r.bottom)
        }
        return ok
      })
    const name = (el.getAttribute('aria-label') || el.title
      || (el.textContent || '').trim().slice(0, 28)
      || el.className || el.tagName).toString().trim()

    out.push({
      name,
      invisible,
      cls: typeof el.className === 'string' ? el.className.slice(0, 40) : el.tagName,
      reach,
      blocker,
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.left),
      right: Math.round(r.right),
      vw: window.innerWidth,
      // Inside the screen sideways. Vertically a list scrolls, so only the
      // horizontal edges are a fault.
      inside: r.left >= -1 && r.right <= window.innerWidth + 1,
      hittable: !!(at && (at === el || el.contains(at) || el.contains(at.parentElement))),
      covered: at && !(at === el || el.contains(at)) ? (
        typeof at.className === 'string' && at.className ? at.className.slice(0, 40) : at.tagName
      ) : null,
    })
  }
  return {
    controls: out,
    missingRoot: false,
    sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollWidth: document.documentElement.scrollWidth,
    vw: window.innerWidth,
  } })()`

module.exports = {
  name: 'phone-audit',
  /*
   * The narrowest phone anybody still carries, rather than a comfortable one.
   *
   * 360 is a Galaxy and most Android; 375 is an iPhone SE and a 13 mini. A
   * layout that holds at 360 holds on all of them, and one checked only at
   * 390 is checked on the phones least likely to break.
   */
  width: 360,
  height: 780,

  async run({ js, until, wait, settled, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy', 'Cami'],
    })
    check('the server can be set up', setup.ok === true, setup.why)

    // Something to look at: a message, so the chat is not empty, and a second
    // server so the rail has more than one thing in it.
    await js(`(async () => {
      const t = localStorage.getItem('atrium.token')
      const h = { 'content-type': 'application/json', authorization: 'Bearer ' + t }
      await fetch('/api/spaces', { method: 'POST', headers: h,
        body: JSON.stringify({ name: 'Baileys Dictatorship' }) })
      return 1 })()`)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(2000)

    const problems = []

    /** Sweep the topmost layer and record anything wrong with it. */
    const sweep = async (where, root = null) => {
      const r = await js(SWEEP(root))
      if (r.missingRoot) {
        problems.push(`${where}: ${root} is not on screen`)
        console.log(`      ${where}: MISSING ${root}`)
        return r
      }
      const bad = {
        covered: r.controls.filter((c) => !c.hittable && !c.invisible),
        invisible: r.controls.filter((c) => c.invisible),
        outside: r.controls.filter((c) => !c.inside),
        small: r.controls.filter((c) => !c.reach && !c.invisible),
      }
      console.log(`      ${where}: ${r.controls.length} controls`)
      for (const c of bad.covered) {
        console.log(`        COVERED  ${c.name}  by ${c.covered}`)
        problems.push(`${where}: "${c.name}" is under ${c.covered}`)
      }
      for (const c of bad.invisible) {
        console.log(`        INVISIBLE ${c.name}  (${c.cls})`)
        problems.push(`${where}: "${c.name}" cannot be seen, only felt for`)
      }
      for (const c of bad.outside) {
        console.log(`        OUTSIDE  ${c.name}  x=${c.x} right=${c.right} vw=${c.vw}`)
        problems.push(`${where}: "${c.name}" is off the side of the screen`)
      }
      for (const c of bad.small) {
        console.log(`        SMALL    ${c.name}  ${c.w}x${c.h}  (${c.cls})  blocked by ${c.blocker}`)
        problems.push(`${where}: a fingertip does not fit on "${c.name}" (${c.w}x${c.h})`)
      }
      if (r.sideways) {
        console.log(`        SIDEWAYS  page is ${r.scrollWidth} wide in ${r.vw}`)
        problems.push(`${where}: the page scrolls sideways`)
      }
      return r
    }

    /*
     * Where the extra width is coming from, before asking which control it
     * pushed off the end. A control hanging over the edge is almost never
     * the control's fault - something above it refused to shrink.
     */
    const widths = await js(`(() => {
      const of = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { w: Math.round(r.width), x: Math.round(r.left), right: Math.round(r.right) }
      }
      return {
        vw: window.innerWidth,
        body: of('body'), app: of('.app'), chat: of('.chat'),
        head: of('.chat-head'), scroll: of('.msg-scroll'),
        composerWrap: of('.composer-wrap'), composer: of('.composer'),
        banner: of('.get-desktop, .gd, [class*="gd-"]')?.w ?? null,
        // Which child is refusing to shrink, rather than which control it
        // pushed over the edge.
        kids: [...(document.querySelector('.chatpane')?.children ?? [])].map((el) => ({
          cls: (typeof el.className === 'string' ? el.className : el.tagName).slice(0, 28),
          w: Math.round(el.getBoundingClientRect().width),
          content: el.scrollWidth,
          minw: getComputedStyle(el).minWidth,
        })),
      } })()`)
    console.log('      widths: ' + JSON.stringify(widths))

    const chat = await sweep('the chat')
    check('the chat has controls to sweep', chat.controls.length > 3, chat.controls.length)

    // ---- the channel drawer -------------------------------------------------
    await js(`(() => { const b = document.querySelector('.navtog'); if (b) b.click(); return 1 })()`)
    await settled('.pane.sidepane')
    await wait(400)
    await sweep('the channel drawer', '.pane.sidepane')
    await js(`(() => { const b = document.querySelector('.navtog'); if (b) b.click(); return 1 })()`)
    await settled('.pane.sidepane')

    // ---- the member drawer --------------------------------------------------
    await js(`(() => { const b = document.querySelector('.memtog'); if (b) b.click(); return 1 })()`)
    await settled('.pane.mempane')
    await wait(400)
    await sweep('the member drawer', '.pane.mempane')
    await js(`(() => { const b = document.querySelector('.memtog'); if (b) b.click(); return 1 })()`)
    await settled('.pane.mempane')

    // ---- conversations ------------------------------------------------------
    await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
    await wait(1200)
    await sweep('the conversations list')

    /*
     * Inside a conversation, which carries the most in its header: a way
     * back, a call, a screen share, pins, notifications, the profile and
     * search, with somebody's name in the middle of it.
     */
    await js(`(() => { const d = document.querySelector('.chan'); if (d) d.click(); return 1 })()`)
    await until('a conversation', `!!document.querySelector('.cmp')`, 8000)
    await wait(1200)
    await sweep('a conversation')

    /*
     * The things that open over a conversation.
     *
     * Everything above is a screen; these are layers on top of one, and a
     * layer is where a phone goes wrong - it is placed against a button that
     * is somewhere else at this width, or it is sized for a window rather
     * than for a screen. Each is opened, swept, and shut again.
     */
    const pinsOpen = await js(`(() => {
      const b = document.querySelector('[aria-label="Pinned messages"]')
      if (!b) return false
      b.click()
      return true })()`)
    if (pinsOpen) {
      await until('the pins panel', `!!document.querySelector('.pinbox')`, 6000)
      await wait(500)
      await sweep('the pins panel', '.pinbox')
      await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 1 })()`)
      await wait(400)
    }

    /*
     * A menu, which on a phone is reached by holding rather than by
     * right-clicking - and which is drawn where a pointer was, on a screen
     * with no pointer.
     */
    const menuOpen = await js(`(() => {
      const row = document.querySelector('.chan')
      if (!row) return false
      const r = row.getBoundingClientRect()
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
        clientX: Math.round(r.left + 20), clientY: Math.round(r.top + r.height / 2) }))
      return true })()`)
    if (menuOpen) {
      await wait(700)
      const there = await js(`!!document.querySelector('.ctx')`)
      if (there) {
        await sweep('a menu', '.ctx')
        await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 1 })()`)
        await wait(400)
      }
    }

    /*
     * And nothing in that row sitting on top of anything else.
     *
     * The sweep asks whether a control is covered, which is the right
     * question about a control and no question at all about a name. A long
     * name with no room to shrink is drawn straight over the buttons beside
     * it: the buttons still answer a tap, so every check passes while the
     * header is unreadable. Reported from a phone, with the name written
     * across two of them.
     */
    const overlaps = await js(`(() => {
      const head = document.querySelector('.chd')
      if (!head) return { none: true }
      /*
       * Text painted outside its own box, which is what this looks like.
       *
       * Comparing boxes finds nothing: min-width lets the name's box shrink
       * to whatever is left, and the letters are then drawn beyond it. The
       * box never overlaps anything - the ink does. So the question is
       * whether anything holds more than it has room for and is allowed to
       * spill: content wider than the box, with the overflow left visible.
       */
      const spilling = []
      for (const el of head.querySelectorAll('*')) {
        const s = getComputedStyle(el)
        if (s.display === 'none' || s.overflow !== 'visible') continue
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          spilling.push((typeof el.className === 'string' ? el.className : el.tagName).slice(0, 24)
            + ' by ' + (el.scrollWidth - el.clientWidth) + 'px')
        }
      }
      const title = head.querySelector('.tbn')
      return {
        none: false,
        spilling,
        headWidth: Math.round(head.getBoundingClientRect().width),
        vw: window.innerWidth,
        titleClipped: title ? title.scrollWidth > title.clientWidth : null,
      } })()`)
    console.log('      header: ' + JSON.stringify(overlaps))
    check('nothing in the header is drawn outside itself',
      overlaps.none === true || overlaps.spilling.length === 0, overlaps.spilling)
    check('and the header fits the screen',
      overlaps.none === true || overlaps.headWidth <= overlaps.vw + 1, overlaps)

    // ---- settings -----------------------------------------------------------
    await js(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => /settings/i.test(x.title || x.getAttribute('aria-label') || ''))
      if (b) b.click()
      return 1 })()`)
    await wait(1500)
    const settingsOpen = await js(`(() => !!document.querySelector('.snav button'))()`)
    check('settings opens on a phone', settingsOpen === true)
    if (settingsOpen) {
      await sweep('settings', SETTINGS_ROOT)
      for (const pane of ['voice', 'appearance']) {
        /* On a phone the list and the pane are two screens, so the list is
           not on screen once a pane is open. Without stepping back first the
           second pane is never reached and its sweep silently re-measures
           the first one under the wrong name. */
        /* Two steps with a breath between them. Going back and picking
             from the list in one block queried a pane list that React had
             not put back yet, so the second pane was never opened. */
        await js(`(() => {
          const back = document.querySelector('.sback')
          if (back) back.click()
          return 1 })()`)
        await wait(400)
        await js(`(() => {
          const b = [...document.querySelectorAll('.snav button')]
            .find((x) => new RegExp(${JSON.stringify('^')} + ${JSON.stringify(pane)}, 'i').test(x.textContent.trim()))
          if (b) b.click()
          return 1 })()`)
        await wait(900)
        /*
         * That the pane is on screen, not that a button was pressed.
         *
         * Pressing it and getting nowhere is exactly the bug this found:
         * picking from the list did not open anything, so both sweeps below
         * measured the list again under the name of a pane and passed for
         * having nothing to find.
         */
        const reached = await js(`(() => {
          const h = document.querySelector('.smain .stitle')
          return h ? h.textContent.trim() : null })()`)
        check(`settings can reach ${pane}`,
          new RegExp(`^${pane}`, 'i').test(reached ?? ''), reached)
        await sweep(`settings / ${pane}`, SETTINGS_ROOT)
      }
      await js(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /close|done|✕|×/i.test(x.textContent || x.getAttribute('aria-label') || ''))
        if (b) b.click()
        return 1 })()`)
      await wait(800)
    }

    /*
     * Reported as one list rather than one failing check each, because a
     * sweep that stops at the first thing it finds is a sweep that has to be
     * run once per fault.
     */
    if (problems.length) {
      console.log('')
      console.log(`      ${problems.length} things to answer for:`)
      for (const p of problems) console.log(`        - ${p}`)
    }
    check('nothing on a phone is covered, off screen, or too small to hit',
      problems.length === 0, problems.slice(0, 12))
  },
}
