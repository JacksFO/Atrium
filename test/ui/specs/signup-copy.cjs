/**
 * The sign-up screen tells the truth about what it needs.
 *
 * Reported: a friend was asked to join, and the app told them "Everyone needs
 * a code to join". It did not - open registration had been on for hours, and
 * the server would have let them straight in. The sentence was written when
 * a code really was required and had no way to know that had changed.
 *
 * So it asks the server now, and this checks it says the right thing.
 *
 * There used to be a second state to check: an install nobody had claimed,
 * where a code printed in a console genuinely was the only way in. That is
 * gone - Atrium is one app people sign up to, and the first person through
 * the door is just the first person - so what is left is that the screen
 * says the same true thing before and after anybody exists, and that
 * somebody can sign up with nothing at all.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'signup-copy',
  width: 1100,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    await until('the sign-in screen', `!!document.querySelector('.gatebox')`)
    await wait(800)

    /** Switch to Create account and read what the screen says. */
    const readSignup = async () => {
      await js(`(() => {
        // The swap is a button reading "Create one" under "Don't have an
        // account?" - matched on the swap row rather than on wording that
        // could sit on the submit button too.
        const toggle = document.querySelector('.gswap button')
        if (toggle && /create|make an account/i.test(toggle.textContent || '')) toggle.click()
        return 1 })()`)
      await wait(700)
      return js(`(() => {
        const card = document.querySelector('.gatebox')
        const labels = [...card.querySelectorAll('.fld label')].map((l) => l.textContent.trim())
        const invite = labels.find((l) => /invite/i.test(l)) || ''
        // By position, not by wording: the placeholder is allowed to say
        // "Only if somebody gave you one", which mentions neither code nor
        // invite - and a test that searched for those words missed it.
        const inviteLbl = [...card.querySelectorAll('.fld label')]
          .find((l) => /invite/i.test(l.textContent || ''))
        let field = inviteLbl ? inviteLbl.nextElementSibling : null
        while (field && field.tagName !== 'INPUT') field = field.nextElementSibling
        const placeholder = field ? field.placeholder : ''
        return {
          lede: (card.querySelector('.sub') || {}).textContent || '',
          inviteLabel: invite,
          placeholder,
          hint: (card.querySelector('.fld .hint') || {}).textContent || '',
        } })()`)
    }

    // --- with nobody signed up yet ---
    const empty = await readSignup()
    console.log('      before anybody: ' + JSON.stringify(empty))
    /* Nothing about claiming, owners or consoles. This is the screen the
       very first visitor sees, and it used to tell them the install was
       unclaimed and point at a console they had no way of reading. */
    check('says nothing about claiming or an owner',
      !/claim|owner|console/i.test(JSON.stringify(empty)), JSON.stringify(empty))
    check('and the invite is optional from the very first visit',
      empty.inviteLabel === 'Invite code (optional)', empty.inviteLabel)

    // --- somebody signs up, which is all a first run is now ---
    const setup = await signIn(js, { owner: 'JacksFO', friends: [] })
    check('the first account can just sign up', setup.ok === true, setup.why)

    // Back to a signed-out screen, the way somebody arriving fresh sees it.
    await js(`(() => { localStorage.clear(); return 1 })()`)
    await win.loadURL(base + '/')
    await until('the sign-in screen again', `!!document.querySelector('.gatebox')`)
    await wait(800)

    const open = await readSignup()
    console.log('      claimed, door open: ' + JSON.stringify(open))

    /*
     * The heart of it: the screen must not claim a code is needed when the
     * server would accept somebody without one.
     */
    check('and the screen says the same afterwards',
      !/everyone needs a code/i.test(open.lede), open.lede)
    check('it says what they actually get: nothing, to start with',
      /no servers and no friends/i.test(open.lede), open.lede)
    check('the code is labelled optional', /optional/i.test(open.inviteLabel), open.inviteLabel)
    check('and the field says so too', /only if/i.test(open.placeholder), open.placeholder)
    check('with a line telling them to leave it empty',
      /leave this empty/i.test(open.hint), open.hint)

    /*
     * And it is true, not just written down. Somebody signing up with the
     * field left alone gets an account, and lands nowhere.
     */
    const fresh = await js(`(async () => {
      const r = await fetch('/api/register', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'Newcomer', displayName: 'Newcomer', password: 'password123' }) })
      const b = await r.json().catch(() => null)
      if (!b || !b.token) return { ok: false, status: r.status, body: b }
      const h = { headers: { authorization: 'Bearer ' + b.token } }
      const spaces = await (await fetch('/api/spaces', h)).json()
      const friends = await (await fetch('/api/friends', h)).json()
      return {
        ok: true,
        spaces: (spaces.spaces || []).length,
        friends: (friends.friends || []).length,
      } })()`)

    check('somebody can sign up with no code at all', fresh.ok === true, fresh)
    check('and starts in no servers', fresh.spaces === 0, fresh.spaces)
    check('and with no friends', fresh.friends === 0, fresh.friends)
  },
}
