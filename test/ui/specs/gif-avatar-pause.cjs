/**
 * An animated avatar and an animated banner stop when nobody is looking.
 *
 * Reported three times, which is why this drives the app rather than reading
 * the code and believing it:
 *
 *   "I changed my profile picture to a gif ... I tabbed out onto my 2nd
 *    monitor and its still playing"
 *   "I'm using a gif from the select gif from giphy, not an uploaded gif"
 *   "when I have my friend's profile open and he has an animated banner and
 *    then I tab out I still see it moving"
 *
 * Each of the last two was a hole in the fix for the one before it. Choosing
 * from the provider does not store the file you were shown - it stores
 * whatever the fetch came back as, which is very often a WebP, and WebP had
 * been left out as "rare". And a banner was a background-image, which looks
 * the same as a picture and cannot be stopped, there being no element to hand
 * to a canvas and no property that pauses one.
 *
 * So: the avatar here is a WebP and the banner is a GIF, deliberately, and
 * both are asked the same three questions - is it moving, does it stop, does
 * it start again.
 *
 * Set over the API rather than through the picker, because the picker fetches
 * from a provider no test can reach. What is being tested is what the app
 * does with an animated picture, not how somebody came to have one.
 */
const { app } = require('electron')
const { signIn } = require('../lib.cjs')

/*
 * Give the window the attention back, and mean it.
 *
 * A run that restored the window without regaining focus read "not watching"
 * throughout the last phase - so the pictures stayed still, correctly, and
 * three checks failed on a fix that was working. show() raises and focuses in
 * one go, and app.focus({ steal: true }) is what makes that stick on Windows
 * when something else holds the foreground.
 */
const lookAtIt = async (win, wait) => {
  win.show()
  app.focus({ steal: true })
  win.focus()
  await wait(900)
}

/*
 * The smallest real files of each kind. Real, because the server sniffs the
 * first bytes and refuses anything whose contents disagree with the type it
 * claims - so a made-up buffer would be turned away and this would pass
 * having proved nothing.
 */
const GIF89A = '47494638396101000100800000000000ffffff21f90401000000002c00000000'
  + '010001000002024401003b'
const WEBP = '524946461a000000574542505650384c0d0000002f00000010071011118888fe0700'

module.exports = {
  name: 'gif-avatar-pause',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(1500)

    const put = (what, hex, mime) => js(`(async () => {
      const hex = ${JSON.stringify(hex)}
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
      const r = await fetch('/api/me/${what}', {
        method: 'POST',
        headers: {
          'content-type': ${JSON.stringify(mime)},
          authorization: 'Bearer ' + localStorage.getItem('atrium.token'),
        },
        body: bytes,
      })
      return { status: r.status, body: await r.json().catch(() => null) }
    })()`)

    /* A WebP avatar: the shape a picture chosen from the provider arrives in. */
    const avatar = await put('avatar', WEBP, 'image/webp')
    console.log('      avatar: ' + JSON.stringify(avatar))
    check('a WebP can be an avatar', avatar.status === 200, avatar)
    check('and is stored as .webp, which is how the app knows it might move',
      /\.webp/.test(String(avatar.body && avatar.body.url)), avatar.body)

    const banner = await put('banner', GIF89A, 'image/gif')
    console.log('      banner: ' + JSON.stringify(banner))
    check('a GIF can be a banner', banner.status === 200, banner)

    await win.loadURL(base + '/')
    await until('the app again', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(1500)

    /* The banner only exists while a profile is open, so open one. */
    await js(`(() => {
      const row = [...document.querySelectorAll('.mrow')].find((m) => /JacksFO/.test(m.textContent))
      if (!row) return 0
      const r = row.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + 40, r.top + r.height / 2)
      if (hit) hit.click()
      return 1 })()`)
    check('a profile can be opened',
      await until('the card', `!!document.querySelector('.pop .pcard')`))
    await wait(600)

    /*
     * What every picture on screen is showing: the file itself, or a still
     * drawn from it. Asked of avatars and banners together, because the two
     * were separate reports of the same thing.
     */
    const SHOWING = `(() => {
      const say = (i) => i.src.startsWith('data:') ? 'still'
        : (/\\.(gif|webp)/.test(i.src) ? 'moving' : 'other')
      return {
        /* The picture inside an avatar, not the box around it: .av is
           the round frame and holds either a picture or drawn art. */
        avatars: [...document.querySelectorAll('.av.pic img')].map(say),
        banners: [...document.querySelectorAll('.pbn img.bimg')].map(say),
        /* What the app itself thinks, so a run that could not change the
           window's state says so rather than looking like a broken fix. */
        watching: document.visibilityState === 'visible' && document.hasFocus(),
        /* How much a frozen picture costs while it is frozen. */
        bytes: [...document.querySelectorAll('.av.pic img, .pbn img.bimg')]
          .filter((i) => i.src.startsWith('data:'))
          .reduce((n, i) => n + i.src.length, 0),
      }
    })()`

    /*
     * Focused first, and checked - these windows are shown but not always in
     * front, and one that started unfocused would find the stills already
     * there and pass without the swap ever happening.
     */
    await lookAtIt(win, wait)
    const watching = await js(SHOWING)
    console.log('      looking at it:  ' + JSON.stringify(watching))
    /* Everything below is about a window losing attention and getting it
       back, so a run that never had it in the first place proves nothing. */
    check('the window is being looked at to begin with',
      watching.watching === true, watching.watching)
    check('there is an animated avatar on screen',
      watching.avatars.includes('moving'), watching.avatars)
    check('and an animated banner',
      watching.banners.includes('moving'), watching.banners)
    check('and nothing is a still yet',
      !watching.avatars.includes('still') && !watching.banners.includes('still'), watching)

    // --- tabbed out ----------------------------------------------------------
    /*
     * Hidden, not blurred.
     *
     * win.blur() left document.hasFocus() exactly as it was - the first run of
     * this read identical answers in all three phases - so it proved nothing
     * about a window losing attention. Hiding changes visibilityState, which
     * is a state the page genuinely has and which attention.ts genuinely
     * listens for; showing it again brings the focus with it, where restoring
     * from minimised did not. Tabbing to another monitor is the other half of
     * the same switch and cannot be driven from here at all.
     */
    win.hide()
    await wait(900)
    const away = await js(SHOWING)
    console.log('      tabbed away:    ' + JSON.stringify(away))
    check('and loses it', away.watching === false, away.watching)
    check('tabbing away stops every animated avatar',
      away.avatars.length > 0 && !away.avatars.includes('moving'), away.avatars)
    check('and every animated banner',
      away.banners.length > 0 && !away.banners.includes('moving'), away.banners)
    check('by putting a still in its place, not by blanking it',
      away.avatars.includes('still') && away.banners.includes('still'), away)

    // --- and back ------------------------------------------------------------
    await lookAtIt(win, wait)
    const back = await js(SHOWING)
    console.log('      looking again:  ' + JSON.stringify(back))
    check('and gets it back', back.watching === true, back.watching)
    check('coming back gives the moving avatar back',
      back.avatars.includes('moving'), back.avatars)
    check('and the moving banner',
      back.banners.includes('moving'), back.banners)
    check('with no stills left behind',
      !back.avatars.includes('still') && !back.banners.includes('still'), back)
  },
}
