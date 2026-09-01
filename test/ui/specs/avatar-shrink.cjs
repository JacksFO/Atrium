/**
 * A picture of a person goes up small, because that is how it is drawn.
 *
 * An avatar is a forty-pixel circle beside a name, and it is fetched by
 * everybody who opens the app. It was going up at whatever size it was
 * chosen at: six people's pictures weighed 6.1MB between them on the live
 * server, one banner alone 4.7MB. The sizes to send them at had been written
 * down and tested for months - AVATAR_EDGE is 256, BANNER_EDGE is 1024 - and
 * nothing had ever passed one to anything, so a green test sat on top of a
 * setting with no effect.
 *
 * Asked of the stored bytes rather than of the code. What matters is not
 * that a function was called on the way past; it is what the next person to
 * open the app has to download.
 */
const { signIn } = require('../lib.cjs')

/* Something worth shrinking, drawn in the page: a real photograph's worth of
   detail, at a size no avatar needs. */
const BIG = `(async () => {
  const c = document.createElement('canvas')
  c.width = 2400; c.height = 2400
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 2400, 2400)
  grad.addColorStop(0, '#20406e'); grad.addColorStop(0.5, '#c05a3a')
  grad.addColorStop(1, '#efe2c4')
  g.fillStyle = grad; g.fillRect(0, 0, 2400, 2400)
  for (let i = 0; i < 90; i += 1) {
    g.fillStyle = 'rgba(255,255,255,' + (0.03 + (i % 9) / 70) + ')'
    g.beginPath(); g.arc(i * 61 % 2400, i * 97 % 2400, 30 + i * 4, 0, Math.PI * 2); g.fill()
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  return blob })()`

module.exports = {
  name: 'avatar-shrink',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1500)

    /* Yours, by your name at the bottom - the server's gear says "settings"
       too and comes first. */
    await js(`(() => {
      const b = document.querySelector('.mebar button[aria-label="Your settings"]')
      if (b) b.click()
      return 1 })()`)
    await wait(1500)
    await js(`(() => {
      const b = [...document.querySelectorAll('.snav button')]
        .find((x) => /my account/i.test(x.textContent.trim()))
      if (b) b.click()
      return 1 })()`)
    await until('the profile pane',
      `[...document.querySelectorAll('.card .row .t')].some((t) => /^Picture$/.test(t.textContent))`)
    await wait(600)

    /*
     * The file input belonging to the Picture row.
     *
     * By its property rather than an attribute selector: an input written the
     * ordinary way has no type attribute, whatever the browser treats it as.
     * The row is found by what it says, because which element holds a
     * settings row is this app's business and "Picture" is what somebody
     * reads.
     */
    const chose = await js(`(async () => {
      const blob = await ${BIG}
      const file = new File([blob], 'huge.png', { type: 'image/png' })
      const row = [...document.querySelectorAll('.card .row')].find((r) =>
        /^Picture$/.test(((r.querySelector('.t') || {}).textContent || '').trim()))
      if (!row) return { ok: false, why: 'no Picture row' }
      let input = [...row.querySelectorAll('input')].find((i) => i.type === 'file')
      /* The picker can be a sibling of the row rather than inside it. */
      if (!input) {
        input = [...document.querySelectorAll('.settings input')].find((i) => i.type === 'file')
      }
      if (!input) return { ok: false, why: 'no file input' }
      const dt = new DataTransfer()
      dt.items.add(file)
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return {
        ok: true, chosen: blob.size,
        /* Which one it was, and how many there were to choose between: the
           settings window holds several, and setting the wrong one looks
           exactly like an upload that silently did not happen. */
        inRow: !!row.querySelector('input[type=file]'),
        inputs: [...document.querySelectorAll('.settings input')]
          .filter((i) => i.type === 'file').length,
      } })()`)
    console.log('      chose: ' + JSON.stringify(chose))
    check('a picture can be chosen', chose.ok === true, chose)

    /* What the pane says about it, which is where a refusal appears. */
    await wait(3000)
    const said = await js(`(() => {
      const t = [...document.querySelectorAll('.settings')]
        .map((s) => s.textContent || '').join(' ')
      const m = t.match(/(Saved\\.|would not upload|needs to be a|too large|[Ff]ailed)/)
      return m ? m[0] : '(nothing said)' })()`)
    console.log('      the pane says: ' + JSON.stringify(said))

    /* Waited on rather than slept through: a 2400px png is decoded, drawn to
       a canvas and re-encoded before a single byte goes out. */
    const ME = `(async () => {
      const r = await fetch('/api/me', { headers:
        { authorization: 'Bearer ' + localStorage.getItem('atrium.token') } })
      const j = await r.json()
      return (j.user && j.user.avatar_path) ? j.user.avatar_path : null })()`
    /*
     * Asked directly, and asserted on what came back.
     *
     * Not through `until`: it answers whether something happened, not what it
     * was, so the first version of this measured the string "true" - fetched
     * it as an address, got the app's own index.html, and passed the size
     * check on 1298 bytes of HTML. Wrapping the query in `!!(await ...)` to
     * get a boolean out of it made that worse rather than better, because an
     * un-awaited promise is truthy whatever it resolves to, so the wait did
     * not wait and the check could not fail.
     */
    const stored = await js(ME)
    console.log('      stored at: ' + JSON.stringify(stored))
    check('the picture is saved', typeof stored === 'string' && stored.startsWith('/uploads/'),
      { stored, said })

    const weighed = await js(`(async () => {
      const r = await fetch(${JSON.stringify(stored)})
      const b = await r.blob()
      const url = URL.createObjectURL(b)
      const size = await new Promise((done) => {
        const img = new Image()
        img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => done({ w: 0, h: 0 })
        img.src = url
      })
      URL.revokeObjectURL(url)
      return { bytes: b.size, type: b.type, ...size } })()`)
    console.log('      stored: ' + JSON.stringify(weighed))

    /*
     * That what came back is a picture at all, before anything is concluded
     * from its size. Every route that is not a file answers with the app's
     * own page here, and an HTML page is small - so a size assertion on its
     * own passes most loudly when the address was wrong.
     */
    check('what is stored is an image', /^image\//.test(weighed.type), weighed)

    /*
     * The long edge: that is the setting, and it is the one that was being
     * ignored. AVATAR_EDGE is 256, and a square 2400 becomes 256.
     */
    check('it is stored no larger than an avatar is drawn',
      weighed.w > 0 && weighed.w <= 256 && weighed.h <= 256, weighed)

    /* And the bytes, which is what anybody opening the app pays. A tenth is
       generous on purpose - this guards against the full picture being
       stored, it does not measure the encoder. */
    check('and weighs a fraction of what was chosen',
      weighed.bytes * 10 < chose.chosen, { chosen: chose.chosen, stored: weighed.bytes })
  },
}
