/**
 * Who is in the conversations list, and in what order.
 *
 * Two things reported together. Somebody accepted a friend request and could
 * not find them under Direct messages: the list only held people there was
 * already a conversation with, so a new friend appeared nowhere until you had
 * messaged them - which is the thing you were trying to do.
 *
 * And the order. Whoever wrote to you jumped to the top, but somebody YOU had
 * just written to did not move: the sender is acknowledged rather than sent
 * their own message back, so the code that bumps recency never ran for them.
 */
const { signIn, typeAndSend } = require('../lib.cjs')

module.exports = {
  name: 'dm-list',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy', 'Keeko', 'Cami'],
    })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `!!document.querySelector('.rl[aria-label="Conversations"], .rail-pip')`)
    await wait(2000)

    /** Open the home column, where conversations live. */
    const openHome = async () => {
      await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
      await wait(1200)
    }
    /** The names under the Direct messages heading, in the order shown. */
    const dmNames = () => js(`(() => {
      const rows = [...document.querySelectorAll('.chan .nm')]
      return rows.map((r) => r.textContent.trim())
    })()`)

    await openHome()
    const listed = await dmNames()
    console.log('      conversations list: ' + JSON.stringify(listed))

    /*
     * signIn makes them friends and nothing more - not one message has been
     * sent. Every one of them should still be here.
     */
    check('a friend shows up before any conversation exists',
      ['baileyyy', 'Keeko', 'Cami'].every((n) => listed.some((l) => l.includes(n))), listed)

    // --- somebody writes to you -------------------------------------------
    /*
     * Opened and sent explicitly rather than through sayAs, which finds a
     * channel by kind - and the whole point here is that no conversation
     * exists yet.
     */
    const wrote = await js(`(async () => {
      const token = ${JSON.stringify(setup.friends?.Keeko?.token ?? '')}
      const me = ${JSON.stringify(setup.me?.id ?? '')}
      const made = await (await fetch('/api/dms', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ userId: me }) })).json()
      const channelId = made.channel && made.channel.id
      if (!channelId) return { ok: false, why: 'no conversation was made' }
      await new Promise((resolve) => {
        const s = new WebSocket(location.origin.replace('http', 'ws') + '/gateway')
        s.onopen = () => s.send(JSON.stringify({ t: 'hello', token }))
        s.onmessage = (ev) => {
          const m = JSON.parse(String(ev.data))
          if (m.t === 'ping') return s.send(JSON.stringify({ t: 'pong' }))
          if (m.t === 'ready') {
            s.send(JSON.stringify({ t: 'send', channelId, body: 'evening', nonce: 'k1' }))
            setTimeout(() => { s.close(); resolve() }, 900)
          }
        }
        setTimeout(resolve, 6000)
      })
      return { ok: true } })()`)
    check('Keeko can open a conversation and write', wrote.ok === true, wrote)
    await wait(2500)
    await openHome()
    const afterTheirs = await dmNames()
    console.log('      after Keeko wrote: ' + JSON.stringify(afterTheirs))
    check('whoever wrote to you goes to the top',
      (afterTheirs[0] || '').includes('Keeko'), afterTheirs[0])

    // --- you write to somebody else ---------------------------------------
    // Open Cami's conversation from the list, and say something.
    await js(`(() => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /Cami/.test(r.textContent || ''))
      if (row) row.click()
      return 1 })()`)
    await wait(2500)
    await typeAndSend(js, 'are you about')
    await wait(2500)

    const afterMine = await dmNames()
    console.log('      after writing to Cami: ' + JSON.stringify(afterMine))

    /*
     * The heart of the second half: something YOU sent is the strongest sign
     * a conversation is current, and it was the one case that never moved.
     */
    check('somebody you just wrote to goes to the top as well',
      (afterMine[0] || '').includes('Cami'), afterMine[0])
    check('and the one before them is still above the rest',
      (afterMine[1] || '').includes('Keeko'), afterMine.slice(0, 3))
  },
}
