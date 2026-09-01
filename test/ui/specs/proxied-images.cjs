/**
 * A linked picture is fetched by the server, not by whoever is reading it.
 *
 * Showing a linked image inline is the obvious feature and the obvious leak:
 * everybody who scrolls past fetches it themselves, so whoever posted the
 * link learns the address of everybody in the channel.
 *
 * /api/media was written for exactly this and nothing ever called it, because
 * an <img src> cannot carry an Authorization header and the route wants one.
 * So every linked picture was still hotlinked, and the proxy sat there unused
 * — which is the sort of thing that only shows up if something asks the page
 * where its pictures actually came from.
 */
const { signIn, typeAndSend } = require('../lib.cjs')

/* A real address, and one that only works if the query is understood: the
   type is in ?format=jpg and there is no extension anywhere in the path. */
const PIC = 'https://pbs.twimg.com/media/HQ6-pr5WcAAYhrK?format=jpg&name=large'

module.exports = {
  name: 'proxied-images',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1200)

    await typeAndSend(js, PIC)
    await wait(1200)

    /* It has to be recognised as a picture at all - that is the half that
       decides between an image and a bare link. */
    await until('the picture', `!!document.querySelector('.bareimg img')`, 20000)

    const shown = await js(`(() => {
      const img = document.querySelector('.bareimg img')
      if (!img) return { found: false }
      return {
        found: true,
        src: img.getAttribute('src') || '',
        complete: img.complete,
        w: img.naturalWidth,
        h: img.naturalHeight,
      } })()`)
    console.log('      ' + JSON.stringify(shown))

    check('a linked picture is drawn as a picture', shown.found === true, shown)
    /*
     * The whole point. A blob means the bytes came through this server; the
     * original address in the tag would mean the browser went and got it
     * itself, which is the leak.
     */
    check('and its bytes came through this server, not from the host',
      shown.src.startsWith('blob:'), shown.src.slice(0, 60))
    check('and the address of the picture is not in the tag',
      !shown.src.includes('pbs.twimg.com'), shown.src.slice(0, 60))
    /* And it is a real picture rather than a broken one: a proxy that
       returns nothing would pass the two checks above. */
    check('and it really loaded', shown.w > 0 && shown.h > 0, { w: shown.w, h: shown.h })

    /* Nothing anywhere on the page may point straight at the host. */
    const direct = await js(`(() => {
      const out = []
      for (const el of document.querySelectorAll('img,video,source')) {
        const s = el.getAttribute('src') || el.getAttribute('poster') || ''
        if (/^https?:/i.test(s) && !s.includes(location.host)) out.push(s.slice(0, 70))
      }
      return out })()`)
    console.log('      direct: ' + JSON.stringify(direct))
    check('and nothing on the page is fetched straight from somewhere else',
      direct.length === 0, direct)
  },
}
