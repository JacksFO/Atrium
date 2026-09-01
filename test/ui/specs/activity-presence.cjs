/**
 * Somebody else's presence, all the way through.
 *
 * Everything so far has been tested a piece at a time: what the server will
 * repeat, what the shell will match, what the card measures. This is the
 * chain - one person says what they are doing, the server carries it, and it
 * appears beside their name and on their profile.
 *
 * Driven from a second account over its own socket, because that is what the
 * desktop shell does and it is the only way to watch the receiving side
 * behave like one. It needs no game and no music player running: what the
 * shell would have read is exactly the shape sent here, and the reading is
 * covered where the reading happens.
 */
const { signIn } = require('../lib.cjs')

/**
 * Say what somebody is doing, as them, over their own socket.
 *
 * Held open for a moment afterwards on purpose: the server forgets what
 * somebody is doing the instant their socket closes, which is the whole
 * difference between presence and a written status. Closing straight away
 * would undo the thing being tested.
 */
const report = (js, token, activity) => js(`(async () => {
  return await new Promise((resolve) => {
    const s = new WebSocket('ws://' + location.host + '/gateway')
    s.onopen = () => s.send(JSON.stringify({ t: 'hello', token: ${JSON.stringify(token)} }))
    s.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.t === 'ping') return s.send(JSON.stringify({ t: 'pong' }))
      if (m.t !== 'ready') return
      s.send(JSON.stringify({ t: 'activity', activities: ${JSON.stringify(activity)} }))
      setTimeout(() => resolve({ ok: true }), 1200)
    }
    setTimeout(() => resolve({ ok: false, why: 'the socket never became ready' }), 9000)
  }) })()`)

const openRowSaying = (js, text) => js(`(() => {
  /* One person, not the box they are all in: .mem is the roster and
     clicking it opens nothing. */
  const rows = [...document.querySelectorAll('.mrow')]
  const row = rows.find((r) => r.textContent.includes(${JSON.stringify(text)}))
  if (!row) return { found: false }
  row.click()
  return { found: true } })()`)

module.exports = {
  name: 'activity-presence',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)
    const them = setup.friends.Baileyyy

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1500)

    const sent = await report(js, them.token, [
      { kind: 'game', name: 'Escape from Tarkov', since: Date.now() - 3723000 },
      { kind: 'music', name: 'Some Song', detail: 'Some Artist', at: 30000, length: 120000 },
    ])
    check('they can say they are doing both at once', sent.ok === true, sent.why)

    // --- beside their name -------------------------------------------------
    check('it shows beside their name in the list',
      await until('the line under their name',
        `[...document.querySelectorAll('.mrow .a')].some((s) => s.textContent.includes('Tarkov'))`))

    const line = await js(`(() => {
      const s = [...document.querySelectorAll('.mrow .a')].find((n) => n.textContent.includes('Tarkov'))
      return { text: s && s.textContent, /* An activity rather than something they typed: the line is built
         from the parts of what they are doing, and those carry .acl.
         A status somebody wrote is plain text in the same place. */
      marked: !!(s && s.querySelector('.acl')) } })()`)
    /* The game gets the single line, not the track: everybody's music says
       the same thing and only one of them is in a raid. */
    check('naming the game, and not the track', line.text === 'Playing Escape from Tarkov', line)
    check('and marked as an activity rather than something they wrote',
      line.marked === true, line)

    // --- and on their profile ---------------------------------------------
    const opened = await openRowSaying(js, 'Tarkov')
    check('their row can be opened', opened.found === true, opened)
    await wait(900)

    const card = await js(`(() => {
      const c = document.querySelector('.act')
      if (!c) return { there: false }
      const art = c.querySelector('.act-art')
      const box = art && art.getBoundingClientRect()
      const holder = c.closest('.pcard') || c.parentElement
      return {
        there: true,
        heading: (c.querySelector('.act-h') || {}).textContent,
        name: (c.querySelector('.act-name') || {}).textContent,
        /* How long it has been running is the last of the small lines
           under the name; a track's artist is the first. Same class, because
           they are the same kind of line - a quiet note about the thing
           above it. */
        since: (() => { const l = [...c.querySelectorAll('.act-by')]
          return l.length ? l[l.length - 1].textContent : null })(),
        /* A tile stands in where there is no art. This client draws an icon
           in it rather than the first letters of the name - either says
           "there is a picture missing here" without leaving a hole. */
        standIn: !!c.querySelector('.act-art.none'),
        hasBar: !!c.querySelector('.act-bar'),
        fits: Math.round(c.getBoundingClientRect().right)
          <= Math.round(holder.getBoundingClientRect().right) + 1,
        square: box ? Math.round(box.width) === Math.round(box.height) : null,
      } })()`)
    check('their profile carries the card', card.there === true, card)
    check('headed for what it is', card.heading === 'Playing a game', card.heading)
    check('naming the game', card.name === 'Escape from Tarkov', card.name)
    /* The card counts rather than describes: a number that moves while it is
       being looked at. An hour and two minutes, so the hours show. */
    check('counting up in hours, minutes and seconds',
      /^1:02:0\d elapsed$/.test(card.since || ''), card.since)
    check('with a tile standing in, since a game has no art here',
      card.standIn === true, card.standIn)
    check('and no progress bar, because a game has no end', card.hasBar === false, card.hasBar)
    check('the card fits the profile it is in', card.fits === true, card)
    check('and its tile is square', card.square === true, card)

    // --- and the track, on the same profile, below it -----------------------
    const track = await js(`(() => {
      const cards = [...document.querySelectorAll('.act')]
      const c = cards[1]
      if (!c) return { there: false, cards: cards.length }
      const fill = c.querySelector('.act-bar span')
      const bar = c.querySelector('.act-bar')
      return {
        there: true,
        heading: (c.querySelector('.act-h') || {}).textContent,
        detail: (c.querySelector('.act-by') || {}).textContent,
        times: [...c.querySelectorAll('.act-times span')].map((s) => s.textContent),
        filled: fill && bar
          ? fill.getBoundingClientRect().width / bar.getBoundingClientRect().width
          : null,
        /* A track says where it has got to with a bar and two clocks, so
           it has no "elapsed" line: that is the game's way of saying the
           same thing, and both at once reads as two different answers. */
        hasSince: [...c.querySelectorAll('.act-by')].some((l) => /elapsed/.test(l.textContent || '')),
      } })()`)
    check('the track has its own card', track.there === true, track)
    check('headed with the player, which is the thing worth naming',
      track.heading === 'Listening to Spotify', track.heading)
    check('the artist reads as an artist', track.detail === 'by Some Artist', track.detail)
    check('a bar a quarter of the way through',
      track.filled !== null && Math.abs(track.filled - 0.25) < 0.08, track.filled)
    /*
     * The end is fixed; the position is not, and should not be.
     *
     * It carries forward from when this client was told, so by the time the
     * card is read a second or two has passed - which is the whole point, and
     * what an exact 0:30 here would have been asserting the absence of. It
     * must never go backwards, and must not have run away either.
     */
    const at = (() => {
      const [m, sec] = String(track.times[0]).split(':')
      return Number(m) * 60 + Number(sec)
    })()
    check('the end of the track is where it was said to be',
      track.times[1] === '2:00', track.times)
    check('and the position has moved on from where it was reported, but not far',
      at >= 30 && at <= 40, { shown: track.times[0], seconds: at })
    check('and no elapsed clock, because a track has an end instead',
      track.hasSince === false, track.hasSince)
  },
}
