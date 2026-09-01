/**
 * An invite as a link somebody can be sent.
 *
 * The Make a link button copied a bare code. That is fine pasted into a
 * conversation here, where it is read and turned into a card with a Join
 * button - and useless sent anywhere else, where it is eight characters with
 * nothing to press and no way to tell what they are for.
 *
 * So it copies an address, and opening that address does what pressing the
 * card does. Both halves are driven here: the app already serves itself for
 * any path, so what is being tested is whether it notices.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'invite-link',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    // A server the friend is not in, and a code for it.
    const made = await js(`(async () => {
      const t = localStorage.getItem('atrium.token')
      const h = { 'content-type': 'application/json', authorization: 'Bearer ' + t }
      const space = (await (await fetch('/api/spaces', { method: 'POST', headers: h,
        body: JSON.stringify({ name: 'The Attic' }) })).json()).space
      const r = await (await fetch('/api/invites', { method: 'POST', headers: h,
        body: JSON.stringify({ uses: 5, days: 7, spaceId: space.id }) })).json()
      return { ok: !!r.code, code: r.code, spaceId: space.id } })()`)
    check('an invite can be made for it', made.ok === true, made)

    // --- what the button now puts on the clipboard ---------------------------
    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(2000)
    await js(`(() => {
      const b = document.querySelector('[aria-label="Invite people"]')
      if (b) b.click()
      return 1 })()`)
    await until('the invite dialog', `!!document.querySelector('.addspace.invite')`, 6000)
    await js(`(() => {
      const b = [...document.querySelectorAll('.addspace.invite button')]
        .find((x) => /make a link/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await until('a link', `!!document.querySelector('.as-code')`, 8000)
    const shown = await js(`(() => (document.querySelector('.as-code') || {}).textContent || '')()`)
    console.log('      shown: ' + JSON.stringify(shown))
    /*
     * The prefix moved with the name: codes were jc- when this was called
     * JacksCord and have been at- since. This asked for the old one and was
     * simply never run - the suite could not sign in for weeks, so the
     * failure sat here unseen. Asked as "an address ending in a code" rather
     * than by spelling the prefix again, which is the part that went stale.
     */
    check('it offers an address rather than a bare code',
      /^https?:\/\/.+\/invite\/[a-z]{2}-[0-9a-f]{8,18}$/.test(shown), shown)

    // --- arriving on one, already signed in ----------------------------------
    await win.loadURL(base + '/invite/' + made.code)
    await until('the invite it was for', `!!document.querySelector('.invite-arrival')`, 12000)
    await wait(800)

    const arrival = await js(`(() => {
      const box = document.querySelector('.invite-arrival')
      return {
        name: (box.querySelector('.invite-words b') || {}).textContent,
        button: (box.querySelector('.invite-join') || {}).textContent,
        joined: !!box.querySelector('.invite-in'),
        // Taken out of the address bar: a reload should put somebody back in
        // the app, not offer them a used invite and call it expired.
        path: location.pathname,
      } })()`)
    console.log('      arrival: ' + JSON.stringify(arrival))
    check('arriving on the link says which server', /Attic/.test(arrival.name || ''), arrival)
    /*
     * The owner is already in it, so the card says so rather than offering to
     * put them in twice. That it recognises the case is the point.
     */
    check('and knows they are already in it', arrival.joined === true, arrival)
    check('and the address bar is left clean', arrival.path === '/', arrival.path)

    // --- and arriving on one with no account at all --------------------------
    await js(`(() => { localStorage.clear(); return 1 })()`)
    await win.loadURL(base + '/invite/' + made.code)
    await until('the sign-in screen', `!!document.querySelector('input')`, 12000)
    await wait(1000)

    const signup = await js(`(() => {
      const fields = [...document.querySelectorAll('input')]
      const withCode = fields.find((i) => i.value === ${JSON.stringify(made.code)})
      return {
        filled: !!withCode,
        // Somebody following an invite is far likelier to be new than to be
        // signing back in, so the screen starts on making an account.
        registering: [...document.querySelectorAll('button')]
          .some((b) => /create|sign up|make an account/i.test(b.textContent)),
        values: fields.map((i) => i.value).filter(Boolean),
      } })()`)
    console.log('      signup: ' + JSON.stringify(signup))
    check('somebody with no account gets the code filled in', signup.filled === true, signup)
    check('and lands on making one', signup.registering === true, signup)
  },
}
