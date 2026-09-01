/**
 * Somebody typing is only typing in the room you are looking at.
 *
 * Reported: "I was in a DM with this person, I then swapped to a another DM
 * and another chat and I still saw that they was typing even tho I left the
 * DM and still saw them typing?"
 *
 * Who is typing was held per person and not per channel. Arriving events are
 * already dropped unless they belong to the channel on screen, so nothing
 * wrong ever came in - what lingered was what was already there, for the five
 * seconds an entry takes to go stale by itself.
 *
 * Which is the trap this spec has to avoid falling into. "The line is gone"
 * becomes true on its own after five seconds whether anything was fixed or
 * not, so the check is useless unless it happens well inside that window -
 * and so the run prints how long it took, and fails if it dawdled.
 */
const { signIn } = require('../lib.cjs')

const READ = `(() => {
  const el = document.querySelector('.typ')
  return {
    text: el ? el.textContent.trim() : null,
    channel: ([...document.querySelectorAll('.tbn')].pop() || {}).textContent,
  }
})()`

/* A typing event as somebody else, over the gateway, which is the only way
   one can arrive. Nothing is sent - typing is not a message. */
const typeAs = (token, channelId) => `(() => new Promise((resolve) => {
  const s = new WebSocket('ws://' + location.host + '/gateway')
  s.onopen = () => s.send(JSON.stringify({ t: 'hello', token: ${JSON.stringify(token)} }))
  s.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.t === 'ping') return s.send(JSON.stringify({ t: 'pong' }))
    if (m.t === 'ready') {
      s.send(JSON.stringify({ t: 'typing', channelId: ${JSON.stringify(channelId)} }))
      setTimeout(() => { s.close(); resolve({ ok: true }) }, 400)
    }
  }
  setTimeout(() => resolve({ ok: false, why: 'never became ready' }), 9000)
}))()`

module.exports = {
  name: 'typing-stays-put',
  width: 1280,
  height: 860,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1500)

    // Which conversation the two of them share.
    const dm = await js(`(async () => {
      const r = await (await fetch('/api/dms', { headers: {
        authorization: 'Bearer ' + ${JSON.stringify(setup.me?.token ?? '')} } })).json()
      const one = (r.dms || [])[0]
      return { id: one && one.id, howMany: (r.dms || []).length } })()`)
    check('there is a conversation to be in', !!dm.id, dm)

    await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
    await until('the conversation list', `document.querySelectorAll('.chan').length > 0`, 12000)
    await js(`(() => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /baileyyy/i.test(r.textContent))
      if (row) row.click()
      return 1 })()`)
    await wait(1200)

    // ---- they start typing, and it shows ----
    const sent = await js(typeAs(setup.friends.baileyyy.token, dm.id))
    check('a typing event can be sent as them', sent.ok === true, sent)
    const startedAt = Date.now()
    await wait(600)

    const showing = await js(READ)
    console.log('      in the DM:  ' + JSON.stringify(showing))
    /*
     * The precondition, and the whole spec rests on it: if the line never
     * appeared, everything below passes without testing anything.
     */
    check('it says they are typing', /baileyyy/i.test(showing.text || ''), showing)

    // ---- and then you leave ----
    await js(`(() => {
      const pip = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')][0]
      if (pip) pip.click()
      return 1 })()`)
    await wait(900)

    const after = await js(READ)
    const elapsed = Date.now() - startedAt
    console.log('      after leaving: ' + JSON.stringify(after) + ' at +' + elapsed + 'ms')

    /*
     * Before this is judged: an entry goes stale by itself after five
     * seconds, so a check made late would have passed against the bug.
     */
    check('the check happened well inside the five seconds it expires in',
      elapsed < 3000, { elapsed })
    check('nobody is typing in the channel you moved to',
      !/typing/i.test(after.text || ''), after)

    // ---- and going back does not resurrect it ----
    await js(`(() => { const h = document.querySelector('.rl[aria-label="Conversations"]'); if (h) h.click(); return 1 })()`)
    await until('the conversation list', `document.querySelectorAll('.chan').length > 0`, 12000)
    await js(`(() => {
      const row = [...document.querySelectorAll('.chan')]
        .find((r) => /baileyyy/i.test(r.textContent))
      if (row) row.click()
      return 1 })()`)
    await wait(1200)

    const returned = await js(READ)
    console.log('      back in the DM: ' + JSON.stringify(returned))
    /*
     * A line saying somebody is typing is only true while it keeps being
     * resent. Putting a saved one back on return would be a claim about the
     * past, and they stopped when they sent it or gave up.
     */
    check('and coming back does not claim they are still typing',
      !/typing/i.test(returned.text || ''), returned)
  },
}
