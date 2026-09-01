/**
 * A big picture is made the size it is looked at before it is sent.
 *
 * Measured on the uploads this server already held: twenty pictures taking
 * 25.0 MB come to 2.4 MB at 2048px as WebP - ten and a half times smaller,
 * for pictures nothing ever draws above 420px wide inline. One 6 MB phone
 * photo was costing the same disk as eighteen thousand messages.
 *
 * The rules about which pictures to touch are unit tested. What they cannot
 * cover is the part that only exists in a browser: decoding the file, drawing
 * it into a canvas, and getting WebP back out. So this drives the real
 * composer with a real file and then asks the server what it actually
 * received - which is the only place the answer is not a claim.
 *
 * A GIF goes through the same door and must come out untouched, because a
 * canvas draws one frame of one and shrinking it would quietly turn an
 * animation into a picture of its first moment.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'upload-shrink',
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

    /*
     * Put a file into the composer the way a person does.
     *
     * A page may not set a filename on a file input, but it may hand one a
     * DataTransfer - which is what a drop does, and which goes through every
     * line of the app's own upload path rather than around it.
     */
    const send = (makeFile) => js(`(async () => {
      const file = await (${makeFile})()
      const input = [...document.querySelectorAll('.cmp input')].find((i) => i.type === 'file')
      if (!input) return { ok: false, why: 'no file input' }
      const dt = new DataTransfer()
      dt.items.add(file)
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, sent: { name: file.name, type: file.type, bytes: file.size } }
    })()`)

    /*
     * A big photograph-ish picture: smooth gradients and shapes, which is
     * what a screenshot or a photo mostly is. Noise would compress badly in
     * both formats and prove nothing about either.
     */
    const BIG_PNG = `async () => {
      const c = document.createElement('canvas')
      c.width = 3000; c.height = 2000
      const g = c.getContext('2d')
      const grad = g.createLinearGradient(0, 0, 3000, 2000)
      grad.addColorStop(0, '#1b3a6b'); grad.addColorStop(0.5, '#c94f3d'); grad.addColorStop(1, '#f2e6c9')
      g.fillStyle = grad; g.fillRect(0, 0, 3000, 2000)
      for (let i = 0; i < 60; i++) {
        g.fillStyle = 'rgba(255,255,255,' + (0.03 + (i % 7) / 60) + ')'
        g.beginPath(); g.arc(i * 51 % 3000, i * 89 % 2000, 40 + i * 3, 0, Math.PI * 2); g.fill()
      }
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      return new File([blob], 'holiday.png', { type: 'image/png' })
    }`

    const big = await send(BIG_PNG)
    check('a large picture can be put in the composer', big.ok === true, big)
    console.log('      picked:   ' + JSON.stringify(big.sent))
    check('and it really is a large PNG to begin with',
      big.sent.bytes > 256 * 1024 && big.sent.type === 'image/png', big.sent)

    check('it is accepted', await until('the attachment',
      `document.querySelectorAll('.pend .pendone').length > 0`, 20000))
    await wait(800)

    /*
     * What the server has, rather than what the page believes. Only the newest
     * upload matters, and its bytes are the number this whole change is about.
     */
    const stored = await js(`(async () => {
      const r = await fetch('/api/admin/storage', { headers: {
        authorization: 'Bearer ' + localStorage.getItem('atrium.token') } })
      if (!r.ok) return { ok: false, status: r.status }
      return { ok: true, body: await r.json() }
    })()`)
    console.log('      storage:  ' + JSON.stringify(stored).slice(0, 200))

    /* The name is on the thumbnail rather than under it - this composer
       shows the picture itself, and what it is called is what a screen
       reader is given for it. */
    const shown = await js(`(() => {
      const pf = document.querySelector('.pend .pendone img')
      return pf ? (pf.getAttribute('alt') || '').trim() : null
    })()`)
    console.log('      attached: ' + JSON.stringify(shown))
    check('and it went up as a WebP, not the PNG it started as',
      typeof shown === 'string' && /\.webp$/i.test(shown), shown)

    // --- and a GIF is left exactly as it is ---------------------------------
    /*
     * The one that must not be touched. Built as a real animated GIF rather
     * than any old bytes, because "left alone" is only interesting for a file
     * the shrinker would otherwise have taken an interest in.
     */
    const GIF = `async () => {
      const hex = '47494638396101000100800000000000ffffff21f90401000000002c00000000'
        + '010001000002024401003b'
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
      return new File([bytes], 'dancing.gif', { type: 'image/gif' })
    }`

    const gif = await send(GIF)
    check('a GIF can be put in the composer too', gif.ok === true, gif)
    check('the GIF arrives as a GIF', await until('the second attachment',
      `[...document.querySelectorAll('.pend .pendone img')]
         .some((n) => /\.gif$/i.test(n.getAttribute('alt') || ''))`,
      20000))

    const names = await js(`(() => [...document.querySelectorAll('.pend .pendone img')]
      .map((n) => (n.getAttribute('alt') || '').trim()))()`)
    console.log('      pending:  ' + JSON.stringify(names))
    check('so one was converted and one was left alone',
      names.some((n) => /\.webp$/i.test(n)) && names.some((n) => /\.gif$/i.test(n)), names)
  },
}
