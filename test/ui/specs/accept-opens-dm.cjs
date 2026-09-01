/**
 * Saying yes to a friend request opens the conversation with them.
 *
 * Asked for directly: "when accepting someone as a friend the DM that opens
 * on the left side of friends should always go to the top for both the person
 * who sent it and the person who accepted it. The person who accepted it
 * should auto go into the DM chat with that person too."
 *
 * Becoming friends used to put a name in a list and nothing else. The
 * conversation only came into existence when somebody finally wrote in it, so
 * until then both sides had a row sorted alphabetically among everybody they
 * had never spoken to - the person you had just this second added was at the
 * bottom, and saying yes left you looking at whatever was already on screen.
 *
 * The Accept button is really clicked here rather than the API being called,
 * because where the app goes afterwards is half of what was asked for.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'accept-opens-dm',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy', 'Cami', 'Keeko'],
    })
    check('the server can be set up', setup.ok === true, setup.why)

    const mine = setup.me?.token ?? ''
    // signIn hands friends back keyed by name, not as a list.
    const friendToken = (name) => setup.friends?.[name]?.token ?? ''

    /*
     * Somebody writes first, so the top of the list is already taken by a real
     * conversation. A new friend going to the top over nothing would prove
     * very little.
     */
    const wrote = await js(`(async () => {
      const token = ${JSON.stringify(friendToken('Keeko'))}
      const r = await (await fetch('/api/dms', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ userId: ${JSON.stringify(setup.me?.id ?? '')} }) })).json()
      if (!r.channel) return { ok: false, got: r }
      // Over the gateway, because that is the only way a message can be sent.
      return await new Promise((resolve) => {
        const s = new WebSocket('ws://' + location.host + '/gateway')
        s.onopen = () => s.send(JSON.stringify({ t: 'hello', token }))
        s.onmessage = (e) => {
          const m = JSON.parse(e.data)
          if (m.t === 'ping') return s.send(JSON.stringify({ t: 'pong' }))
          if (m.t === 'ready') {
            s.send(JSON.stringify({ t: 'send', channelId: r.channel.id,
              body: 'first', nonce: 'spec-' + Math.random().toString(36).slice(2) }))
            setTimeout(() => { s.close(); resolve({ ok: true, channelId: r.channel.id }) }, 900)
          }
        }
        setTimeout(() => resolve({ ok: false, why: 'the socket never became ready' }), 9000)
      }) })()`)
    check('somebody already has a conversation going', wrote.ok === true, wrote)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan, .mem').length > 0`)
    await wait(2000)

    // Onto the conversations list, and check who is at the top of it.
    await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
    await until('the conversations list',
      `document.querySelectorAll('.chan .nm').length >= 3`)
    await wait(1200)

    const namesNow = () => js(`(() => [...document.querySelectorAll('.chan .nm')]
      .map((n) => n.textContent.trim()))()`)

    const before = await namesNow()
    console.log('      before: ' + JSON.stringify(before))
    check('the one with a conversation going is at the top', before[0] === 'Keeko', before)
    check('and the stranger is nowhere yet', !before.includes('Chels'), before)

    // --- a stranger asks ---------------------------------------------------
    const asked = await js(`(async () => {
      const them = await (await fetch('/api/register', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'Chels', displayName: 'Chels',
          password: 'password123' }) })).json()
      if (!them.token) return { ok: false, got: them }
      const r = await fetch('/api/friends/request', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + them.token },
        body: JSON.stringify({ name: 'JacksFO' }) })
      return { ok: r.status === 200, id: them.user.id, token: them.token } })()`)
    check('a stranger can ask to be friends', asked.ok === true, asked)

    // --- and it is accepted with the button, not with fetch ----------------
    await js(`(() => {
      /* Home and Friends sit above the conversations as their own rows,
         rather than as conversations with a class on them. */
      const b = [...document.querySelectorAll('.nrow')]
        .find((x) => /friends/i.test(x.textContent || ''))
      if (b) b.click()
      return 1 })()`)
    /* The tabs, which are there whether or not anybody is waiting - `.fa`
       is the line on a request and only exists once there is one. */
    await until('the Friends screen', `document.querySelectorAll('.ftab').length > 0`)
    await js(`(() => {
      /* The tab, not the number on it: the count is a pill inside the
         button and clicking it is clicking nothing. */
      const t = [...document.querySelectorAll('.ftab')]
        .find((x) => /pending/i.test(x.textContent))
      if (t) t.click()
      return 1 })()`)
    await until('the request waiting there',
      `[...document.querySelectorAll('.facts .btn.p')].some((b) => /accept/i.test(b.textContent))`)

    const clicked = await js(`(() => {
      const b = [...document.querySelectorAll('.facts .btn.p')]
        .find((x) => /accept/i.test(x.textContent))
      if (!b) return { found: false }
      const r = b.getBoundingClientRect()
      // Through elementFromPoint, so this cannot pass on a button that is
      // covered by something else.
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!el || (!b.contains(el) && el !== b)) {
        return { found: false, why: 'covered', by: el ? el.className : null }
      }
      el.click()
      return { found: true } })()`)
    check('the Accept button can actually be clicked', clicked.found === true, clicked)

    /*
     * Half of what was asked for: the app goes into the conversation with
     * them, rather than leaving you on the Friends screen you were on.
     */
    const landed = await until('the conversation with them to open',
      `(() => {
        const head = document.querySelector('.chatpane .chd .tt')
        const gone = !document.querySelector('.fa')
        return gone && !!head && /Chels/.test(head.textContent || '')
      })()`, 12000)
    check('accepting takes you into the conversation with them', landed === true)

    const where = await js(`(() => ({
      header: (document.querySelector('.chatpane .chd .tt') || {}).textContent || '',
      friendsScreenGone: !document.querySelector('.fa'),
      canType: !!document.querySelector('.cmp'),
    }))()`)
    console.log('      landed on: ' + JSON.stringify(where))
    check('with somewhere to write to them', where.canType === true, where)

    // --- and they are at the top of the list -------------------------------
    const after = await namesNow()
    console.log('      after: ' + JSON.stringify(after))
    check('the new friend is at the top of the conversations list',
      after[0] === 'Chels', after)
    check('and nobody was lost from it', after.length === before.length + 1, after)

    /*
     * The other half: the person who ASKED gets the same conversation, and it
     * has to be new enough to sort to the top of their list too. Their screen
     * is not on this machine, so this is asked of the server - the ordering
     * itself is the same code on both sides.
     */
    const theirs = await js(`(async () => {
      const token = ${JSON.stringify(asked.token ?? '')}
      const r = await (await fetch('/api/dms', { headers: { authorization: 'Bearer ' + token } })).json()
      const list = r.dms || []
      const withMe = list.find((d) => (d.members || [])
        .some((m) => m.user_id === ${JSON.stringify(setup.me?.id ?? '')}))
      return { count: list.length, found: !!withMe, createdAt: withMe && withMe.created_at } })()`)
    console.log('      the asker sees: ' + JSON.stringify(theirs))
    check('the person who asked has the conversation too', theirs.found === true, theirs)
    check('and it was made just now, so it sorts to their top as well',
      typeof theirs.createdAt === 'number' && Date.now() - theirs.createdAt < 60_000,
      theirs.createdAt)

    // One conversation, not one each - or they would be writing into different
    // halves of the same friendship.
    const same = await js(`(async () => {
      const token = ${JSON.stringify(mine)}
      const r = await (await fetch('/api/dms', { headers: { authorization: 'Bearer ' + token } })).json()
      const withThem = (r.dms || []).filter((d) => (d.members || [])
        .some((m) => m.user_id === ${JSON.stringify(asked.id ?? '')}))
      return { howMany: withThem.length, id: withThem[0] && withThem[0].id } })()`)
    check('and it is one conversation between them, not two',
      same.howMany === 1, same)
  },
}
