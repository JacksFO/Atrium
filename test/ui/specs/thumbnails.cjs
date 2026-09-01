/**
 * A picture in a conversation is drawn from a small copy, not the whole file.
 *
 * A message column is a few hundred pixels wide and the full picture was
 * being fetched to fill it - so twenty pictures in a channel meant twenty
 * full images downloaded by everybody who scrolled past, all of it out of the
 * upstream of whoever is hosting. The small copy is made by the sender's
 * browser, which already has the picture decoded, and costs the server no
 * image library at all.
 *
 * Asked of the bytes rather than of the markup: a thumbnail that is not
 * meaningfully smaller is not a thumbnail, and an attribute pointing at a
 * second file proves nothing about what it weighs.
 */
const { signIn, typeAndSend } = require('../lib.cjs')

module.exports = {
  name: 'thumbnails',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1500)

    /*
     * A picture big enough to be worth shrinking, drawn in the page so the
     * upload is of real bytes rather than a fixture the resizer would decline.
     */
    const sent = await js(`(async () => {
      const c = document.createElement('canvas')
      c.width = 3000; c.height = 2000
      const g = c.getContext('2d')
      const grad = g.createLinearGradient(0, 0, 3000, 2000)
      grad.addColorStop(0, '#1b3a6b'); grad.addColorStop(0.5, '#c94f3d')
      grad.addColorStop(1, '#f2e6c9')
      g.fillStyle = grad; g.fillRect(0, 0, 3000, 2000)
      for (let i = 0; i < 60; i += 1) {
        g.fillStyle = 'rgba(255,255,255,' + (0.03 + (i % 7) / 60) + ')'
        g.beginPath(); g.arc(i * 51 % 3000, i * 89 % 2000, 40 + i * 3, 0, Math.PI * 2); g.fill()
      }
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const file = new File([blob], 'big.png', { type: 'image/png' })

      /* By its property, not an attribute selector: an input written the
         ordinary way has no type attribute, whatever the browser treats it
         as. The composer is .cmp. */
      const input = [...document.querySelectorAll('.cmp input')].find((i) => i.type === 'file')
      if (!input) return { ok: false, why: 'no file input' }
      const dt = new DataTransfer()
      dt.items.add(file)
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, was: blob.size } })()`)
    console.log('      picked: ' + JSON.stringify(sent))
    check('a picture can be chosen', sent.ok === true, sent)

    /*
     * Two files go up, not one - the picture and its small copy - and a
     * 3000x2000 png is shrunk twice before either does. Waited on rather
     * than slept through: a fixed four seconds was enough for the picture
     * and not for the pair, so the message went without the attachment and
     * the failure looked like the feature not working.
     */
    check('it is accepted', await until('the attachment',
      `document.querySelectorAll('.pend .pendone').length > 0`, 30000))
    await wait(1500)
    const ready = await typeAndSend(js, 'here it is')
    check('the message can be sent', ready.ok === true, ready)

    await until('the picture in the conversation',
      `!!document.querySelector('.msg .attpic img')`, 20000)
    await wait(1500)

    const shown = await js(`(() => {
      const img = document.querySelector('.msg .attpic img')
      if (!img) return { found: false }
      return { found: true, src: img.getAttribute('src') || '' } })()`)
    console.log('      shown: ' + JSON.stringify(shown.src.slice(0, 70)))
    check('the picture is in the conversation', shown.found === true, shown)

    /*
     * Both files, weighed.
     *
     * The one in the conversation, and the one opening it fetches. Asked of
     * the bytes rather than the address: every stored file is named with a
     * fresh id whatever the sender called it, so nothing in a URL says which
     * of the two it is - only the size does.
     */
    const drawn = shown.src
    await js(`(() => {
      const b = document.querySelector('.msg .attpic button')
      if (b) b.click()
      return 1 })()`)
    await until('the full picture', `!!document.querySelector('.lightbox img')`, 8000)
    const opened = await js(`(() => {
      const img = document.querySelector('.lightbox img')
      return img ? img.getAttribute('src') : null })()`)

    const weighed = await js(`(async () => {
      const sizeOf = async (u) => (await (await fetch(u)).blob()).size
      return {
        drawn: await sizeOf(${JSON.stringify(drawn)}),
        opened: await sizeOf(${JSON.stringify(opened)}),
      } })()`)
    console.log('      drawn ' + weighed.drawn + ' bytes, opened ' + weighed.opened + ' bytes')

    check('opening it fetches a different file from the one in the conversation',
      opened !== drawn, { drawn: drawn.slice(0, 46), opened: String(opened).slice(0, 46) })
    /* A third is generous: 512 against 2048 on the long edge is a sixteenth
       of the pixels. Being generous is the point - this is guarding against
       the full picture being served, not measuring the encoder. */
    check('and the conversation fetches a fraction of it',
      weighed.drawn * 3 < weighed.opened, weighed)
  },
}
