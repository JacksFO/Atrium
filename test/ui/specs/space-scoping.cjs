/**
 * A server's member list is that server's members.
 *
 * Reported from a friend's own server: he could see everybody from a server
 * he had merely joined, listed as though they were in his, and the app named
 * somebody else as its owner.
 *
 * Two separate mistakes behind one screenshot. The member column drew from
 * the flat set of everyone the account can see anywhere - every shared
 * server, every friend, everyone in a conversation - and never narrowed it to
 * the server on screen. And the Owner heading was keyed on the instance role,
 * so whoever runs the app appeared as owner of servers other people made.
 *
 * This is a disclosure bug, not a cosmetic one: it told him who else existed
 * and who they were, which is the whole thing the per-server model is for.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'space-scoping',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    // The owner's server, with three other people in it.
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy', 'Cami', 'Keeko'],
    })
    check('the server can be set up', setup.ok === true, setup.why)

    // Now sign in as Baileyyy and make a server of his own.
    const mine = await js(`(async () => {
      const token = ${JSON.stringify(setup.friends?.baileyyy?.token ?? '')}
      if (!token) return { ok: false, why: 'no token for Baileyyy' }
      const made = await (await fetch('/api/spaces', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ name: 'Baileys Dictatorship' }) })).json()
      localStorage.setItem('atrium.token', token)
      return { ok: true, spaceId: made.space && made.space.id, owner: made.space && made.space.owner_id } })()`)
    check('Baileyyy can make his own server', mine.ok === true && !!mine.spaceId, mine)
    check('and the server says he owns it',
      mine.owner === setup.friends.baileyyy.id, { owner: mine.owner, him: setup.friends.baileyyy.id })

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)').length >= 2`)
    await wait(2000)

    // His own server is the second pip: the one he joined comes first.
    await js(`(() => { const p = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]; if (p[1]) p[1].click(); return 1 })()`)
    await wait(2000)

    const his = await js(`(() => {
      const head = document.querySelector('.sidepane .nm, .sidepane .chd .tt')
      const list = document.querySelector('.mempane')
      return {
        server: head ? head.textContent.trim() : null,
        names: [...document.querySelectorAll('.mempane .mrow')].map((m) => m.textContent.trim()),
        headings: [...document.querySelectorAll('.mempane .sect')].map((h) => h.textContent.trim()),
      } })()`)
    console.log('      in his own server: ' + JSON.stringify(his))

    check('he is looking at his own server', /Dictatorship/i.test(his.server || ''), his.server)
    check('he is listed in it',
      (his.names || []).some((n) => /baileyyy/i.test(n)), his.names)

    /*
     * The heart of it. Cami and Keeko are in the other server and have never
     * joined this one, so they must not appear here at all.
     */
    check('nobody who never joined it is listed',
      !(his.names || []).some((n) => /Cami|Keeko/i.test(n)), his.names)
    check('and neither is the owner of the other server',
      !(his.names || []).some((n) => /JacksFO/i.test(n)), his.names)

    // And the Owner heading, if shown, is about this server.
    const ownerHeading = (his.headings || []).find((h) => /owner/i.test(h))
    check('any Owner heading counts only him',
      !ownerHeading || /—\s*1|- 1/.test(ownerHeading), ownerHeading ?? '(no owner heading)')

    // The server he merely joined still lists everyone properly.
    await js(`(() => { const p = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]; if (p[0]) p[0].click(); return 1 })()`)
    await wait(2000)
    const joined = await js(`(() => ({
      server: (document.querySelector('.sidepane .nm, .sidepane .chd .tt') || {}).textContent,
      names: [...document.querySelectorAll('.mempane .mrow')].map((m) => m.textContent.trim()) }))()`)
    console.log('      in the server he joined: ' + JSON.stringify(joined))
    check('the server he joined still lists its own people',
      (joined.names || []).some((n) => /Cami/i.test(n))
        && (joined.names || []).some((n) => /JacksFO/i.test(n)), joined.names)
  },
}
