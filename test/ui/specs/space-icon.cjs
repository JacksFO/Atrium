/**
 * A server's icon is drawn, styled, and holds still when nobody is looking.
 *
 * This exists because of an audit note that turned out to be right to worry.
 * The icon used to be a plain <img> in four places; it became <StillImage>, so
 * that animated ones stop like avatars and banners do - and that was checked
 * by reading the four call sites, which is exactly the check that had just
 * missed a real bug elsewhere. The box for editing a message had been changed
 * from an input to a textarea and the stylesheet still said `.edit-box input`,
 * so every rule stopped applying: the thing worked perfectly and looked like a
 * bare browser control. Nothing threw and nothing went red.
 *
 * That is the risk here too, and it is per place rather than shared: each call
 * site keeps its own class, and a class that no longer matches is invisible to
 * everything except somebody looking at the screen. So this asks each of them
 * whether any of our rules reached it - a size, a corner, a fit - rather than
 * only whether an element exists.
 *
 * The stopping is shared, being one hook, and is proved on the rail icon. The
 * avatar and banner spec covers the mechanism itself.
 */
const { app } = require('electron')
const { signIn } = require('../lib.cjs')

/*
 * A real 1x1 WebP - real because the server sniffs the first bytes and turns
 * away anything whose contents disagree with the type it claims.
 *
 * WebP rather than GIF on purpose: choosing a picture from the provider
 * stores whatever the fetch came back as, and that is very often a WebP. It
 * was left out of "can this move" once already and had to be put back.
 */
const WEBP = '524946461a000000574542505650384c0d0000002f00000010071011118888fe0700'

module.exports = {
  name: 'space-icon',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(1500)

    /* One server in the install, so the route does not need telling which. */
    const uploaded = await js(`(async () => {
      const hex = ${JSON.stringify(WEBP)}
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
      const r = await fetch('/api/space/icon', {
        method: 'POST',
        headers: {
          'content-type': 'image/webp',
          authorization: 'Bearer ' + localStorage.getItem('atrium.token'),
        },
        body: bytes,
      })
      return { status: r.status, body: await r.json().catch(() => null) }
    })()`)
    console.log('      upload: ' + JSON.stringify(uploaded))
    check('the owner can set a server icon', uploaded.status === 200, uploaded)

    await win.loadURL(base + '/')
    await until('the app again', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(1800)

    /*
     * What a place is showing, and whether anything styled it.
     *
     * `painted` is the question the edit-box bug needed asked: an element that
     * no rule reaches still renders, still has the right src, and is still
     * completely wrong to look at. A drawn size and object-fit are what our
     * rules give these, and a browser gives neither by itself.
     */
    const LOOK = `((selector) => {
      const el = document.querySelector(selector)
      if (!el) return { there: false }
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return {
        there: true,
        w: Math.round(r.width), h: Math.round(r.height),
        fit: style.objectFit,
        radius: style.borderTopLeftRadius,
        showing: el.src && el.src.startsWith('data:') ? 'still'
          : (/\\.(gif|webp)/.test(el.src || '') ? 'moving' : 'other'),
      }
    })`

    const at = (selector) => js(`(${LOOK})(${JSON.stringify(selector)})`)

    win.show()
    app.focus({ steal: true })
    win.focus()
    await wait(700)

    // --- the rail, which is on screen the whole time -----------------------
    const rail = await at('.pane.rail .sicon')
    console.log('      rail:     ' + JSON.stringify(rail))
    check('the rail shows the icon', rail.there === true, rail)
    check('and something styled it, rather than nothing',
      rail.w > 0 && rail.h > 0 && rail.fit === 'cover', rail)
    check('and it is the picture, not a still, while it is being looked at',
      rail.showing === 'moving', rail.showing)

    // --- the header above the conversation ---------------------------------
    const head = await at('.topbar > .tbin .tbi img, .topbar .tbi img')
    console.log('      header:   ' + JSON.stringify(head))
    check('the header shows it too', head.there === true, head)
    check('and it fills its box rather than being left at its own size',
      head.w > 0 && head.fit === 'cover', head)

    // --- the preview in the server settings --------------------------------
    await js(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => /settings/i.test(x.title || x.getAttribute('aria-label') || ''))
      if (b) b.click()
      return 1 })()`)
    await wait(1200)
    const onSpace = await js(`(() => {
      const b = [...document.querySelectorAll('.snav button')]
        .find((x) => /^space settings|^overview/i.test(x.textContent.trim()))
      if (b) { b.click(); return true }
      return false })()`)
    if (onSpace) {
      await until('the space settings', `!!document.querySelector('.sicon')`, 8000)
      await wait(600)
      const preview = await at('.settings .sicon')
      console.log('      settings: ' + JSON.stringify(preview))
      check('the settings preview shows it', preview.there === true, preview)
      check('and our rules reach that one as well',
        preview.w > 0 && preview.fit === 'cover', preview)
    } else {
      check('the space settings pane can be opened', false, 'no pane in the list')
    }

    // Back out, so the rail is on screen for the part below.
    await js(`(() => {
      const x = [...document.querySelectorAll('button')].find((b) => /close|✕/i.test(b.textContent))
      if (x) x.click()
      return 1 })()`)
    await wait(900)

    // --- the pip beside a conversation ------------------------------------
    /*
     * The fourth place, and the one that needs going somewhere to see: the
     * panel beside a direct message lists the servers you are both in, each
     * with its icon. A friend made by signIn is in the owner's server, so
     * there is one to list.
     */
    /* Conversations live in the home column, not in a server's channel list. */
    await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
    await wait(1400)
    const inDm = await js(`(() => {
      const row = [...document.querySelectorAll('.chan, .chan.dm')]
        .find((r) => /Baileyyy/i.test(r.textContent))
      if (!row) return { ok: false, rows: [...document.querySelectorAll('.chan')].map((c) => c.textContent.trim()) }
      row.click()
      return { ok: true } })()`)
    check('a conversation with a friend can be opened', inDm.ok === true, inDm)

    if (inDm.ok) {
      const panel = await until('the panel beside it',
        `!!document.querySelector('.chip img, .pshared2 img')`, 10000)
      check('it lists the server you are both in, with its icon', panel)
      if (panel) {
        const pip = await at('.chip img, .pshared2 img')
        console.log('      dm pip:   ' + JSON.stringify(pip))
        check('and our rules reach that one too',
          pip.there === true && pip.w > 0 && pip.fit === 'cover', pip)
      }
    }

    /* Back to the server, so the rail icon below is the one being looked at. */
    await js(`(() => {
      const pip = document.querySelector('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')
      if (pip) pip.click()
      return 1 })()`)
    await wait(1200)

    // --- and it stops when nobody is looking -------------------------------
    /*
     * Hidden rather than blurred: win.blur() leaves document.hasFocus() exactly
     * as it was, so it would prove nothing. The attention state is asserted
     * either side, so a run that could not change it says so.
     */
    win.hide()
    await wait(900)
    const away = await js(`(() => ({
      watching: document.visibilityState === 'visible' && document.hasFocus(),
      rail: (${LOOK})('.pane.rail .sicon'),
    }))()`)
    console.log('      away:     ' + JSON.stringify(away))
    check('the window loses attention', away.watching === false, away.watching)
    check('and the server icon holds still with everything else',
      away.rail.showing === 'still', away.rail)

    win.show()
    app.focus({ steal: true })
    win.focus()
    await wait(900)
    const back = await js(`(() => ({
      watching: document.visibilityState === 'visible' && document.hasFocus(),
      rail: (${LOOK})('.pane.rail .sicon'),
    }))()`)
    console.log('      back:     ' + JSON.stringify(back))
    check('and gets it back', back.watching === true, back.watching)
    check('and the icon moves again', back.rail.showing === 'moving', back.rail)
  },
}
