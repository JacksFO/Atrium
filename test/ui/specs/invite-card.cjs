/**
 * An invite in a conversation, pressed rather than copied out.
 *
 * Asked as "can we make it like a button thing that they can press aswell in
 * their DM so they can just join it rather than having to manually put the
 * code in".
 *
 * The invite already arrived as a message - sending one from the member list
 * posts "Join Somewhere: at-1a2b3c4d" into the conversation - so what was
 * missing was the reading of it, not the sending.
 *
 * Driven through the button rather than the route, because the route already
 * worked. What is being tested is that somebody who was sent an invite can
 * get into the server without typing anything.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'invite-card',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    /*
     * A server of the host's that the friend is NOT in, and an invite to it
     * sent into their conversation - which is the actual path, not a code
     * typed into the test.
     */
    const sent = await js(`(async () => {
      const t = ${JSON.stringify(setup.me?.token ?? '')}
      const h = { 'content-type': 'application/json', authorization: 'Bearer ' + t }
      const made = await (await fetch('/api/spaces', { method: 'POST', headers: h,
        body: JSON.stringify({ name: 'The Attic' }) })).json()
      const them = ${JSON.stringify(setup.friends?.baileyyy?.id ?? '')}
      const r = await fetch('/api/spaces/' + made.space.id + '/invites/send', {
        method: 'POST', headers: h, body: JSON.stringify({ userId: them }) })
      const body = await r.json()
      return { ok: r.status === 200, spaceId: made.space.id, code: body.code, why: body.error } })()`)
    check('an invite can be sent into the conversation', sent.ok === true, sent)

    // --- and now as the person who received it -------------------------------
    await js(`(() => {
      localStorage.setItem('atrium.token', ${JSON.stringify(setup.friends?.baileyyy?.token ?? '')})
      return 1 })()`)
    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(1500)

    /*
     * The precondition, asserted rather than assumed: they are not in that
     * server yet. Without it a later "they are in it" proves nothing.
     */
    const before = await js(`(async () => {
      const t = ${JSON.stringify(setup.friends?.baileyyy?.token ?? '')}
      const r = await (await fetch('/api/spaces', { headers: { authorization: 'Bearer ' + t } })).json()
      return (r.spaces || []).map((s) => s.name) })()`)
    console.log('      their servers before: ' + JSON.stringify(before))
    check('they are not in that server yet', !before.includes('The Attic'), before)

    // Into the conversation, which is where the invite landed.
    await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
    await until('the conversations list', `document.querySelectorAll('.chan').length >= 1`)
    await wait(800)
    await js(`(() => { const d = document.querySelector('.chan'); if (d) d.click(); return 1 })()`)
    await until('the invite card', `!!document.querySelector('.invite-card')`, 12000)
    await wait(600)

    const card = await js(`(() => {
      const c = document.querySelector('.invite-card')
      if (!c) return { found: false }
      const btn = c.querySelector('.invite-join')
      return {
        found: true,
        name: (c.querySelector('.invite-words b') || {}).textContent,
        lede: (c.querySelector('.invite-lede') || {}).textContent,
        meta: (c.querySelector('.invite-meta') || {}).textContent,
        button: btn ? btn.textContent.trim() : null,
        dead: c.classList.contains('is-dead'),
      } })()`)
    console.log('      card: ' + JSON.stringify(card))
    check('the invite is drawn as a card', card.found === true, card)
    check('and it says which server', /Attic/.test(card.name || ''), card.name)
    // A button that says Join and nothing else asks somebody to agree to
    // something they have not been told.
    check('and how many people are in it', /member/.test(card.meta || ''), card.meta)
    check('and offers a button', card.button === 'Join', card.button)
    check('and it is not the expired one', card.dead === false, card.dead)

    // --- press it ------------------------------------------------------------
    const pressed = await js(`(() => {
      const b = document.querySelector('.invite-join')
      if (!b) return { ok: false, why: 'no button' }
      const r = b.getBoundingClientRect()
      // Hit tested, because a synthetic click on a covered button passes and
      // proves nothing.
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!el || !b.contains(el)) return { ok: false, why: 'something is on top of it' }
      b.click()
      return { ok: true } })()`)
    check('the button can actually be pressed', pressed.ok === true, pressed)

    const after = await until('them to be in the server', `(async () => {
      const t = ${JSON.stringify(setup.friends?.baileyyy?.token ?? '')}
      const r = await (await fetch('/api/spaces', { headers: { authorization: 'Bearer ' + t } })).json()
      return (r.spaces || []).some((s) => s.name === 'The Attic') })()`, 12000)
    check('pressing it puts them in the server', after === true)

    // And the card stops offering, rather than inviting them again.
    await wait(1200)
    const settled = await js(`(() => {
      const c = document.querySelector('.invite-card')
      return { joined: !!c && !!c.querySelector('.invite-in'),
        stillOffering: !!c && !!c.querySelector('.invite-join') } })()`)
    console.log('      after joining: ' + JSON.stringify(settled))
    check('the card says so afterwards', settled.joined === true, settled)
    check('and stops offering to do it again', settled.stillOffering === false, settled)

    // The server appears in the rail without a reload, because the gateway
    // says so - the card deliberately does nothing else.
    const rail = await js(`(() => document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)').length)()`)
    check('and it appears in the rail', rail >= 2, rail)
  },
}
