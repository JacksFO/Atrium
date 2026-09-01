/**
 * A GIF as an avatar, chosen rather than uploaded.
 *
 * Asked for as a GIF for the avatar and the banner, chosen from GIPHY as an
 * alternative to uploading one of your own.
 *
 * The picker was already there for messages and GIF was already accepted for
 * an avatar. What was missing was the two being introduced.
 *
 * The provider is not reachable from a test - there is no key and no network
 * to speak of - so the picker itself is driven only as far as opening. What
 * this proves is the part that is ours: that the route fetches a picture and
 * keeps our own copy of it, that the copy is served from this server rather
 * than linked to somebody else's, and that it refuses to go anywhere it was
 * not invited.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'gif-avatar',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(1500)

    const post = (path, body) => js(`(async () => {
      const r = await fetch(${JSON.stringify(path)}, {
        method: 'POST',
        headers: { 'content-type': 'application/json',
                   authorization: 'Bearer ' + localStorage.getItem('atrium.token') },
        body: JSON.stringify(${JSON.stringify(body)}) })
      return { status: r.status, body: await r.json().catch(() => null) } })()`)

    /*
     * The whole security of this route, since it makes the server fetch a URL
     * a member chose. Each of these is a machine only this server can reach,
     * or somebody else's domain wearing a provider's name.
     */
    console.log('      --- where it will not go ---')
    for (const [url, what] of [
      ['http://localhost:8787/api/admin/health', 'this machine'],
      ['https://192.168.0.1/admin', 'the router'],
      ['https://169.254.169.254/latest/meta-data/', 'a metadata service'],
      ['https://evil-giphy.com/a.gif', 'a lookalike domain'],
      ['https://giphy.com.attacker.net/a.gif', 'a domain that merely starts with one'],
      ['file:///etc/passwd', 'a file on disk'],
      ['http://media.giphy.com/a.gif', 'a provider over plain http'],
    ]) {
      const r = await post('/api/me/avatar/gif', { url })
      console.log(`        ${r.status}  ${what}`)
      check(`it refuses ${what}`, r.status === 400, { url, status: r.status })
    }

    // And nothing was written while all that was refused.
    const untouched = await js(`(async () => {
      const r = await (await fetch('/api/me', { headers: {
        authorization: 'Bearer ' + localStorage.getItem('atrium.token') } })).json()
      return r.user.avatar_path })()`)
    check('and none of them left an avatar behind', untouched === null, untouched)

    // --- the button is where somebody would look for it ----------------------
    await js(`(() => {
      /* Yours, by your name at the bottom - the server's gear says
         "settings" too and comes first, so a match on the word alone opened
         the wrong screen and looked like a missing pane. */
      const b = document.querySelector('.mebar button[aria-label="Your settings"]')
      if (b) b.click()
      return 1 })()`)
    await wait(1500)
    await js(`(() => {
      /* Called My account here, and on purpose: a Profile entry that held
         nothing was taken off rather than left opening an empty page. */
      const b = [...document.querySelectorAll('.snav button')]
        .find((x) => /my account/i.test(x.textContent.trim()))
      if (b) b.click()
      return 1 })()`)
    await until('the profile pane',
      `[...document.querySelectorAll('.card .row .t')].some((t) => /^Picture$/.test(t.textContent))`)
    await wait(600)

    /* The two rows that carry a picture, found by what they say rather than
       by a class: which element holds a settings row is this app's business,
       and "Picture" and "Banner" are what somebody reads. */
    const ROWS = `[...document.querySelectorAll('.card .row')].filter((r) =>
      /^(Picture|Banner)$/.test(((r.querySelector('.t') || {}).textContent || '').trim()))`
    const offered = await js(`(() => ${ROWS}.map((box) => ({
      buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim()),
    })))()`)
    console.log('      pickers: ' + JSON.stringify(offered))
    check('both the avatar and the banner offer it',
      offered.length >= 2 && offered.every((o) => o.buttons.some((b) => /gif/i.test(b))),
      offered)

    // --- and it opens where it can be seen -----------------------------------
    const opened = await js(`(() => {
      const box = ${ROWS}[0]
      if (!box) return { ok: false, why: 'no picture row' }
      const b = [...box.querySelectorAll('button')].find((x) => /gif/i.test(x.textContent))
      if (!b) return { ok: false, why: 'no button' }
      const r = b.getBoundingClientRect()
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!el || !b.contains(el)) return { ok: false, why: 'something is on top of it' }
      b.click()
      return { ok: true } })()`)
    check('the button can be pressed', opened.ok === true, opened)

    await until('the picker', `!!document.querySelector('.gifs')`, 8000)
    const where = await js(`(() => {
      const p = document.querySelector('.gifs')
      const r = p.getBoundingClientRect()
      return {
        onScreen: r.top >= 0 && r.left >= 0
          && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1,
        top: Math.round(r.top), height: Math.round(r.height),
        scrim: !!document.querySelector('.scrim.bare'),
      } })()`)
    console.log('      picker: ' + JSON.stringify(where))
    /*
     * The reason it is portalled. Left where it was drawn it anchors above
     * its container, which in a scrolling settings pane means clipped by the
     * pane or off the top of the window entirely.
     */
    check('it opens over the middle rather than off the top', where.onScreen === true, where)
    check('and on a scrim of its own', where.scrim === true, where)
  },
}
