/**
 * The strip above the channels, and a way to change it.
 *
 * It had nothing of its own to draw: it stretched the server's icon - a small
 * square read at thirty pixels, blown up across three hundred - or fell back
 * to art grown from the server's id. Neither is a thing anybody chose.
 *
 * Also here: the button under the home tile says what it does. It was a tick
 * on its own, which is one more picture to learn on a rail where every other
 * tile is a place.
 */
const { signIn } = require('../lib.cjs')

/* A real one-pixel PNG, padded so it weighs something. Anything that is not
   a picture is refused before it reaches the banner, so a fake would test
   the refusal rather than the feature. */
const PNG = '89504e470d0a1a0a0000000d4948445200000001000000010806000000'
  + '1f15c4890000000a49444154789c6300010000050001'
  + '0d0a2db40000000049454e44ae426082'

module.exports = {
  name: 'server-banner',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1500)

    // ---- the button says what it does ------------------------------------
    const readAll = await js(`(() => {
      const b = document.querySelector('.pane.rail .rlread')
      if (!b) return { there: false }
      const r = b.getBoundingClientRect()
      return {
        there: true,
        says: b.textContent.trim(),
        /* Inside its own tile: words in a narrow column are the thing that
           overflows, and a label nobody can read is worse than a mark. */
        fits: b.scrollWidth <= Math.ceil(r.width) + 1,
        title: b.getAttribute('title') || '',
      } })()`)
    console.log('      the read-all tile: ' + JSON.stringify(readAll))
    check('the read-all button says so in words', /read all/i.test(readAll.says || ''), readAll)
    check('and the words fit inside it', readAll.fits === true, readAll)

    // ---- the banner ------------------------------------------------------
    const before = await js(`(() => {
      const b = document.querySelector('.sidepane .banner')
      return { img: !!(b && b.querySelector('.bimg')), art: !!(b && b.querySelector('canvas')) } })()`)
    console.log('      before: ' + JSON.stringify(before))

    const sent = await js(`(async () => {
      const hex = ${JSON.stringify(PNG)}
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
      const sp = await (await fetch('/api/spaces', { headers: {
        authorization: 'Bearer ' + localStorage.getItem('atrium.token') } })).json()
      const id = sp.spaces[0].id
      const r = await fetch('/api/space/banner?spaceId=' + id, {
        method: 'POST',
        headers: { 'content-type': 'image/png',
                   authorization: 'Bearer ' + localStorage.getItem('atrium.token') },
        body: bytes,
      })
      return { status: r.status, body: await r.json().catch(() => null) } })()`)
    console.log('      upload: ' + JSON.stringify(sent).slice(0, 130))
    check('a banner can be given to the server', sent.status === 200, sent)
    check('and the server keeps it', !!sent.body?.space?.banner_path, sent.body?.space)

    /* Drawn without a reload: a space-update goes to everybody in it. */
    const showing = await until('the strip to use it',
      `(() => {
        const b = document.querySelector('.sidepane .banner .bimg')
        return !!b && /uploads/.test(b.getAttribute('src') || '')
      })()`, 12000)
    check('and the strip draws it, live', showing === true)

    // ---- and it can be taken off again -----------------------------------
    const cleared = await js(`(async () => {
      const sp = await (await fetch('/api/spaces', { headers: {
        authorization: 'Bearer ' + localStorage.getItem('atrium.token') } })).json()
      const r = await fetch('/api/space/banner?spaceId=' + sp.spaces[0].id, {
        method: 'DELETE',
        headers: { authorization: 'Bearer ' + localStorage.getItem('atrium.token') } })
      return { status: r.status } })()`)
    check('and taken off again', cleared.status === 200, cleared)
    const backToArt = await until('the art to come back',
      `!document.querySelector('.sidepane .banner .bimg')`, 12000)
    check('which puts the art back rather than leaving a hole', backToArt === true)
  },
}
