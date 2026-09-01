/**
 * A picture opened full screen has to fit the screen.
 *
 * Reported with a photo of a monitor: clicking a large image to enlarge it
 * showed the middle of it with the top and bottom off the window.
 *
 * The CSS said max-width and max-height 100% with object-fit: contain, which
 * reads as correct and is why this needed measuring rather than rereading. A
 * grid item defaults to min-height: auto, and for a replaced element that
 * resolves to the picture's own intrinsic size - so a tall photo had a tall
 * minimum and the max-height lost outright.
 */
const { signIn } = require('../lib.cjs')

/** A PNG of a given size, built in the page. Tall on purpose. */
function makeImage(w, h) {
  return `(async () => {
    const c = document.createElement('canvas')
    c.width = ${w}; c.height = ${h}
    const g = c.getContext('2d')
    g.fillStyle = '#1b6'
    g.fillRect(0, 0, ${w}, ${h})
    // Corners in a different colour, so "is the whole thing visible" is a
    // question the picture itself can answer.
    g.fillStyle = '#f0f'
    g.fillRect(0, 0, 40, 40)
    g.fillRect(${w} - 40, ${h} - 40, 40, 40)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const buf = await blob.arrayBuffer()
    const up = await fetch('/api/upload', { method: 'POST',
      headers: { authorization: 'Bearer ' + localStorage.getItem('atrium.token'),
        'content-type': 'image/png', 'x-filename': 'tall.png' },
      body: buf })
    return await up.json() })()`
}

module.exports = {
  name: 'lightbox',
  width: 1280,
  height: 800,

  async run({ js, until, wait, settled, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: [] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1800)

    // Far taller than the 800px window, which is the case that failed.
    const file = await js(makeImage(1400, 3000))
    check('a tall picture uploads', !!file && !!file.url, file && Object.keys(file))

    const sent = await js(`(async () => {
      return await new Promise((resolve) => {
        const s = new WebSocket('ws://' + location.host + '/gateway')
        s.onopen = () => s.send(JSON.stringify({ t: 'hello', token: localStorage.getItem('atrium.token') }))
        s.onmessage = (e) => {
          const m = JSON.parse(e.data)
          if (m.t === 'ping') return s.send(JSON.stringify({ t: 'pong' }))
          if (m.t === 'ready') {
            const ch = (m.channels || []).find((c) => c.kind === 'text')
            s.send(JSON.stringify({ t: 'send', channelId: ch.id, nonce: 'lb-1',
              body: 'a tall one', attachments: [${JSON.stringify('__FILE__')}] }))
          }
          if (m.t === 'ack') { s.close(); resolve(true) }
        }
        setTimeout(() => resolve(false), 9000)
      }) })()`.replace('"__FILE__"', JSON.stringify(file)))
    check('and is posted', sent === true)

    await until('the picture', `document.querySelectorAll('.att img').length > 0`)
    await wait(1200)

    await js(`(() => { const b = document.querySelector('.att'); if (b) b.click(); return 1 })()`)
    await wait(1200)

    const box = await js(`(() => {
      const img = document.querySelector('.lightbox img')
      if (!img) return { open: false }
      const r = img.getBoundingClientRect()
      return { open: true,
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        left: Math.round(r.left), right: Math.round(r.right),
        w: Math.round(r.width), h: Math.round(r.height),
        vw: window.innerWidth, vh: window.innerHeight,
        natural: { w: img.naturalWidth, h: img.naturalHeight } } })()`)
    console.log('      ' + JSON.stringify(box))

    check('it opens full screen', box.open === true)
    check('the whole picture is on screen, top and bottom',
      box.top >= -1 && box.bottom <= box.vh + 1, { top: box.top, bottom: box.bottom, vh: box.vh })
    check('and left and right',
      box.left >= -1 && box.right <= box.vw + 1, { left: box.left, right: box.right, vw: box.vw })
    check('it was scaled down rather than cropped',
      box.h < box.natural.h, { shown: box.h, natural: box.natural.h })
    check('and kept its shape',
      Math.abs((box.w / box.h) - (box.natural.w / box.natural.h)) < 0.02,
      { shown: (box.w / box.h).toFixed(3), natural: (box.natural.w / box.natural.h).toFixed(3) })
  },
}
