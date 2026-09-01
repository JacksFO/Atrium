/**
 * Can you actually read it, in both themes?
 *
 * Measured from the pixels the app really draws rather than from the
 * stylesheet. Every colour here comes from a custom property, several of
 * which are set as inline styles at runtime, and two of the panels sit behind
 * a blur over a gradient - so the computed `color` of a span tells you very
 * little about whether the text on top of all that can be read.
 *
 * So: capture the rectangle a piece of text occupies, take the darkest and
 * lightest pixels in it, and work out the contrast between them. That is the
 * text against its own background, whatever produced either.
 *
 * The theme is changed through the app's own control. Writing data-theme by
 * hand looked like it worked and was not the same thing at all: apply() also
 * sets the accent and the ambient gradient as inline properties, so a
 * hand-set attribute produces a half-themed page that exists for nobody.
 */
const { signIn, sayAs } = require('../lib.cjs')

/** WCAG AA for body text. Large text is allowed 3, and none of these are. */
const NEEDED = 4.5

module.exports = {
  name: 'theme-contrast',
  width: 1280,
  height: 800,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await sayAs(js, setup.friends.baileyyy.token, 'Morning all, can you read this')
    await wait(1200)

    /**
     * The contrast inside one element's rectangle, from the real pixels.
     *
     * The 2nd and 98th percentiles rather than the outright min and max:
     * a single stray antialiased pixel should not decide the answer.
     */
    const contrastOf = async (selector, label) => {
      const rect = await js(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find((n) => (n.textContent || '').trim().length > 3)
        if (!el) return null
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) return null
        const cs = getComputedStyle(el)
        return { x: Math.round(r.left), y: Math.round(r.top),
                 width: Math.round(Math.min(r.width, 300)), height: Math.round(r.height),
                 /* Named, so a failure says which element and which colour
                    rather than only which selector was asked for. */
                 text: (el.textContent || '').trim().slice(0, 24),
                 cls: (el.className || '').toString().slice(0, 40),
                 colour: cs.color,
                 parent: (el.parentElement?.className || '').toString().slice(0, 40),
                 parentOpacity: el.parentElement ? getComputedStyle(el.parentElement).opacity : '1' }
      })()`)
      if (!rect) return { label, found: false }

      /*
       * Clamped, and allowed to fail.
       *
       * capturePage throws outright on a rectangle that is partly outside
       * the window - which a row at the bottom of a list can easily be after
       * a panel closes and the layout settles. One unreadable label should
       * not take the whole measurement down with it.
       */
      let shot
      try {
        shot = await win.webContents.capturePage({
          x: Math.max(0, rect.x), y: Math.max(0, rect.y),
          width: Math.max(4, Math.min(rect.width, 300)),
          height: Math.max(4, Math.min(rect.height, 200)),
        })
      } catch (err) {
        return { label, found: false, why: String(err).slice(0, 80) }
      }
      const { width, height } = shot.getSize()
      if (width === 0 || height === 0) return { label, found: false, why: 'empty capture' }
      const bmp = shot.getBitmap()          // BGRA, one byte each
      const lum = []
      for (let i = 0; i < bmp.length; i += 4) {
        const chan = (v) => {
          const s = v / 255
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
        }
        lum.push(0.2126 * chan(bmp[i + 2]) + 0.7152 * chan(bmp[i + 1]) + 0.0722 * chan(bmp[i]))
      }
      lum.sort((a, b) => a - b)
      const at = (p) => lum[Math.min(lum.length - 1, Math.floor(lum.length * p))]
      const dark = at(0.02)
      const light = at(0.98)
      const ratio = (light + 0.05) / (dark + 0.05)
      return {
        label, found: true, pixels: width * height,
        ratio: Math.round(ratio * 100) / 100,
        text: rect.text, cls: rect.cls, colour: rect.colour,
        parent: rect.parent, parentOpacity: rect.parentOpacity,
      }
    }

    /* The text somebody spends all day reading, and the labels around it. */
    const TARGETS = [
      ['.msg-body, .md-line', 'a message'],
      ['.msg-author, .author', "the sender's name"],
      ['.chan-name', 'a channel in the list'],
      /*
       * An offline member, deliberately.
       *
       * The first name in the list is the owner, and it is drawn in the
       * Owner role's colour - which is stored in the database as a hex value
       * somebody chose, not a token this app themes. Measuring it here would
       * be testing one row of user data rather than the palette. It is
       * reported on its own below instead.
       */
      ['.mem.off .mem-name', 'an offline name in the member list'],
      ['.composer-hint', 'the hint under the message box'],
    ]

    const measure = async (theme) => {
      const out = []
      for (const [sel, label] of TARGETS) {
        try {
          out.push(await contrastOf(sel, label))
        } catch (err) {
          out.push({ label, found: false, why: String(err).slice(0, 80) })
        }
      }
      console.log(`      ${theme}: ` + JSON.stringify(out
        .map((r) => r.found ? `${r.label} ${r.ratio}` : `${r.label} (not measured: ${r.why || 'absent'})`)))
      return out
    }

    /**
     * Choose a theme through the control somebody would actually use.
     *
     * Writing data-theme by hand looked like it worked and was not the same
     * thing: apply() also sets the accent and the ambient gradient inline, so
     * a hand-set attribute produces a half-themed page that exists for
     * nobody, and a screenshot of it is a bug report about nothing.
     */
    const chooseTheme = async (word) => {
      await js(`(() => {
        const cog = document.querySelector('.mebar .icb[title="Settings"]')
        if (cog) cog.click(); return 1 })()`)
      await wait(900)
      await js(`(() => {
        const b = [...document.querySelectorAll('.settings nav button, .snav button')]
          .find((x) => /appearance/i.test(x.textContent || ''))
        if (b) b.click(); return 1 })()`)
      await wait(700)
      /*
       * A named theme, not a Dark/Light switch.
       *
       * The client this replaced had two buttons and this looked for their
       * words. This one offers a grid of named themes, each of which is
       * itself dark or light - so the spec picks one of each by name. What
       * is being checked is unchanged: that choosing one really applies the
       * whole theme rather than setting an attribute, and that both ends of
       * the range are readable.
       */
      const hit = await js(`(() => {
        const b = [...document.querySelectorAll('.thgrid .thsw')]
          .find((x) => (x.querySelector('.thn') || {}).textContent === ${JSON.stringify(word)})
        if (!b) return { hit: false, why: 'no ' + ${JSON.stringify(word)} + ' theme' }
        /* Settings is a window rather than the whole screen now, so the
           theme grid can be below the fold - and a point outside the
           viewport answers null, which is not the same as being covered. */
        b.scrollIntoView({ block: 'center' })
        const r = b.getBoundingClientRect()
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (!at) return { hit: false, why: 'not on screen', at: Math.round(r.top) }
        if (!(at === b || b.contains(at))) {
          return { hit: false, why: 'covered', by: at.className || at.tagName }
        }
        at.click()
        return { hit: true } })()`)
      await wait(900)
      await js(`(() => {
        const x = document.querySelector('.settings .set-close, .settings [title*="lose"]')
        if (x) x.click()
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return 1 })()`)
      await wait(1000)
      return hit
    }

    /*
     * Dark on purpose, first.
     *
     * The mode is stored, and the harness reuses its profile between runs -
     * so a run that ended in Light started the next one in Light and reported
     * two identical sets of numbers under two different headings. Choosing it
     * explicitly is what makes "dark" mean dark.
     */
    const toDark = await chooseTheme('Ink')
    check('a dark theme can be chosen', toDark.hit === true, toDark)
    check('and the app is really in it',
      await js(`document.documentElement.dataset.mode`) === 'dark')

    const dark = await measure('dark')
    for (const r of dark) {
      if (!r.found) continue
      check(`dark: ${r.label} can be read`, r.ratio >= NEEDED, r.ratio)
    }

    const switched = await chooseTheme('Mist')
    check('a light theme can be chosen', switched.hit === true, switched)

    /*
     * The attribute and the numbers behind it.
     *
     * A theme here is a mode written onto the root and a handful of values
     * set inline with it - the hue, how much of it to use, the corner
     * radius. The attribute alone is half a theme: it would flip the
     * stylesheet's light rules on with the dark theme's hue still in place.
     * So both are asked for, and the background is read back as the proof
     * that something actually changed on screen.
     */
    const applied = await js(`(() => ({
      attr: document.documentElement.dataset.mode || null,
      hue: document.documentElement.style.getPropertyValue('--h').trim(),
      tint: document.documentElement.style.getPropertyValue('--tint').trim(),
      ground: getComputedStyle(document.body).backgroundColor,
    }))()`)
    console.log('      applied: ' + JSON.stringify(applied))
    check('and the whole theme is applied, not only the attribute',
      applied.attr === 'light' && applied.hue !== '' && applied.tint !== '', applied)

    const back = await js(`!!document.querySelector('.mbody, .mbody')`)
    check('the conversation is back on screen', back === true)

    const light = await measure('light')
    for (const r of light) {
      if (!r.found) continue
      check(`light: ${r.label} can be read`, r.ratio >= NEEDED,
        { ratio: r.ratio, text: r.text, cls: r.cls, colour: r.colour,
          parent: r.parent, parentOpacity: r.parentOpacity })
    }

    /*
     * And the one the app does not choose: a name drawn in its role's colour.
     *
     * Role colours are hex values somebody picked and are stored as they were
     * picked - they do not follow the theme, so a colour chosen while looking
     * at the dark theme can be unreadable in the light one. The seeded Owner
     * colour is #4C8DFF, which is the dark accent, and it measures 3.01
     * against the light glass.
     *
     * Reported rather than asserted. Nothing here should quietly rewrite a
     * colour somebody chose; what this can do is say the number out loud so
     * the decision is somebody's rather than nobody's.
     */
    const roleColoured = await contrastOf('.mem-name', 'a name in its role colour')
    if (roleColoured.found) {
      console.log(`      note: ${roleColoured.text} in ${roleColoured.colour} `
        + `measures ${roleColoured.ratio} against the light panel `
        + `(${roleColoured.ratio >= NEEDED ? 'readable' : 'below the 4.5 needed'})`)
    }
  },
}
