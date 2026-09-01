/**
 * A server opens on the channel you were reading in it, where you had got to.
 *
 * Asked for: "lets say I have 3 text channels in my server, I select chat 2
 * and then I go to a DM then I go back to the server It should always go back
 * to the chat I was last in and also where I was in that chat etc if I was
 * scrolled up etc."
 *
 * Clicking a server dropped you in its first text channel every time, so the
 * one you actually use was one more click away for ever unless it happened to
 * sit at the top of the list.
 *
 * The scroll half is measured from the bottom rather than as an offset,
 * because the two disagree the moment anything changes - so the check reads
 * the distance from the end, which is the thing being promised.
 */
const { signIn } = require('../lib.cjs')

/*
 * Said into one particular channel.
 *
 * lib's sayAs picks the first channel of a kind out of the socket's ready
 * payload, which is #general - so the first run of this filled the wrong
 * channel and left the one being measured empty. Every scroll check then
 * passed against a channel with nothing in it to scroll.
 */
const sayInto = (token, channelId, howMany) => `(() => new Promise((resolve) => {
  const s = new WebSocket('ws://' + location.host + '/gateway')
  s.onopen = () => s.send(JSON.stringify({ t: 'hello', token: ${JSON.stringify(token)} }))
  s.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.t === 'ping') return s.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') {
      for (let i = 0; i < ${howMany}; i++) {
        s.send(JSON.stringify({ t: 'send', channelId: ${JSON.stringify(channelId)},
          body: 'filler line number ' + i + ' ' + 'x'.repeat(30),
          nonce: 'fill-' + i + '-' + Math.random().toString(36).slice(2) }))
      }
      setTimeout(() => { s.close(); resolve({ ok: true }) }, 1600)
    }
  }
  setTimeout(() => resolve({ ok: false, why: 'never became ready' }), 9000)
}))()`

const WHERE = `(() => {
  const el = document.querySelector('.stream')
  return {
    channel: ([...document.querySelectorAll('.tbn')].pop() || {}).textContent,
    fromEnd: el ? Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) : null,
    scrollable: el ? el.scrollHeight > el.clientHeight + 100 : false,
  }
})()`

module.exports = {
  name: 'back-where-you-were',
  width: 1280,
  height: 760,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    const token = JSON.stringify(setup.me?.token ?? '')

    // Three text channels, as described.
    const made = await js(`(async () => {
      const out = []
      for (const name of ['chat-two', 'chat-three']) {
        const r = await (await fetch('/api/channels', { method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ${token} },
          body: JSON.stringify({ name, kind: 'text', spaceId: ${JSON.stringify(setup.spaceId ?? null)} }) })).json()
        out.push(r.channel && { name: r.channel.name, id: r.channel.id })
      }
      return out })()`)
    check('two more channels can be made', made.length === 2, made.map((c) => c && c.name))
    const chatTwo = made.find((c) => c && c.name === 'chat-two')
    check('and the one to be measured has an id', !!(chatTwo && chatTwo.id), chatTwo)

    /* Filled before it is opened, so its whole history is there to scroll. */
    const filled = await js(sayInto(setup.friends.baileyyy.token, chatTwo.id, 25))
    check('it can be filled with enough to scroll', filled.ok === true, filled)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length >= 3`, 15000)
    await wait(1500)

    // ---- go to the second one ----
    await js(`(() => {
      const row = [...document.querySelectorAll('.chan')].find((r) => /chat-two/.test(r.textContent))
      if (row) row.click()
      return 1 })()`)
    await wait(1300)
    const chosen = await js(WHERE)
    console.log('      chosen: ' + JSON.stringify(chosen))
    check('the second channel opens', /chat-two/.test(chosen.channel || ''), chosen)

    // ---- and stop part way up it ----
    await js(`(() => {
      const el = document.querySelector('.stream')
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 400)
      el.dispatchEvent(new Event('scroll'))
      return 1 })()`)
    await wait(700)
    const parked = await js(WHERE)
    console.log('      parked: ' + JSON.stringify(parked))
    /*
     * The precondition. With nothing to scroll, "you came back to where you
     * were" is true of a channel that simply opened at the end, and the whole
     * check below would pass without testing anything.
     */
    check('there is enough in the channel to be scrolled up in',
      parked.scrollable === true, parked)
    check('and we are genuinely part way up it', parked.fromEnd > 200, parked)

    // ---- away to a conversation, then back to the server ----
    await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
    await until('the conversation list', `document.querySelectorAll('.chan').length > 0`, 12000)
    await js(`(() => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /baileyyy/i.test(r.textContent))
      if (row) row.click()
      return 1 })()`)
    await wait(1300)
    const inDm = await js(WHERE)
    check('a conversation opens', /baileyyy/i.test(inDm.channel || ''), inDm)

    await js(`(() => {
      const pip = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')][0]
      if (pip) pip.click()
      return 1 })()`)
    await wait(1800)

    const back = await js(WHERE)
    console.log('      back:   ' + JSON.stringify(back))
    check('the server opens on the channel you were reading',
      /chat-two/.test(back.channel || ''), back)
    /* Within a message or so of where it was left, not to the pixel. */
    check('and near enough where you had got to in it',
      Math.abs(back.fromEnd - parked.fromEnd) < 160,
      { left: parked.fromEnd, returned: back.fromEnd })

    // ---- and a channel left at the end still opens at the end ----
    await js(`(() => {
      const el = document.querySelector('.stream')
      el.scrollTop = el.scrollHeight
      el.dispatchEvent(new Event('scroll'))
      return 1 })()`)
    await wait(600)
    await js(`(() => {
      const row = [...document.querySelectorAll('.chan')].find((r) => /chat-three/.test(r.textContent))
      if (row) row.click()
      return 1 })()`)
    await wait(1200)
    await js(`(() => {
      const row = [...document.querySelectorAll('.chan')].find((r) => /chat-two/.test(r.textContent))
      if (row) row.click()
      return 1 })()`)
    await wait(1500)

    const atEnd = await js(WHERE)
    console.log('      at end: ' + JSON.stringify(atEnd))
    /*
     * Somebody sitting at the end of a conversation wants the end of it when
     * they come back, not the end as it was before more arrived.
     */
    check('a channel left at the end comes back at the end',
      atEnd.fromEnd !== null && atEnd.fromEnd < 80, atEnd)
  },
}
