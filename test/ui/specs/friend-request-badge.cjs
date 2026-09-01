/**
 * A friend request shows on the people button, from inside a server.
 *
 * Asked for directly: "when I have a friend request it should show in the DM
 * button at the top left above the servers as a notification too so I know I
 * have one". The count already existed and already drove the pill on the
 * Friends row - but that row is in the conversations sidebar, which is not on
 * screen while you are in a server. So from a server, which is where you are
 * most of the time, nothing anywhere said somebody had asked.
 *
 * Everything here happens while a server is on screen, and nothing reloads
 * after the request is sent. A reload would paper over the case that matters.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'friend-request-badge',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    // No friends to begin with, so the badge cannot be counting anything else.
    const setup = await signIn(js, { owner: 'JacksFO', friends: [] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.mem').length > 0`)
    await wait(2000)

    // The whole point of the change: this must be true throughout.
    const inSpace = await js(`(() => ({
      viewingAServer: !document.querySelector('.rl[aria-label="Conversations"].is-on'),
      friendsRowOnScreen: !!document.querySelector('.chan.dm-friends'),
    }))()`)
    check('a server is on screen, not the conversations list',
      inSpace.viewingAServer === true, inSpace)
    check('so the Friends row is nowhere to be seen',
      inSpace.friendsRowOnScreen === false, inSpace)

    const quiet = await js(`(() => ({
      badge: (document.querySelector('.rl[aria-label="Conversations"] .pip') || {}).textContent || null,
      title: (document.querySelector('.rl[aria-label="Conversations"]') || {}).title || '',
    }))()`)
    check('nothing is waiting to begin with', quiet.badge === null, quiet)
    /* Its own name, and nothing else, while nothing is waiting: a tooltip
       that always lists what is not there is noise. */
    check('and the button says only what it is',
      quiet.title === 'Conversations', quiet.title)

    // --- somebody asks ------------------------------------------------------
    const asked = await js(`(async () => {
      const them = await (await fetch('/api/register', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'Chels', displayName: 'Chels',
          password: 'password123' }) })).json()
      if (!them.token) return { ok: false, got: them }
      const r = await fetch('/api/friends/request', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + them.token },
        body: JSON.stringify({ name: 'JacksFO' }) })
      return { ok: r.status === 200, status: r.status, id: them.user.id,
        token: them.token } })()`)
    check('a stranger can ask to be friends', asked.ok === true, asked)

    // No reload. The badge has to arrive on its own.
    const showed = await until('the badge on the people button',
      `!!document.querySelector('.rl[aria-label="Conversations"] .pip')`, 12000)
    check('a friend request badges the people button without a refresh',
      showed === true)

    const badged = await js(`(() => ({
      text: (document.querySelector('.rl[aria-label="Conversations"] .pip') || {}).textContent || '',
      title: (document.querySelector('.rl[aria-label="Conversations"]') || {}).title || '',
      stillInASpace: !document.querySelector('.rl[aria-label="Conversations"].is-on'),
    }))()`)
    console.log('      badge: ' + JSON.stringify(badged))
    check('it says one', badged.text === '1', badged)
    check('without having left the server', badged.stillInASpace === true, badged)
    /*
     * A bare "1" cannot say whether somebody messaged or somebody asked, and
     * the two are answered in different places. The tooltip says which.
     */
    check('and the tooltip says what kind of one',
      /1 friend request\b/.test(badged.title) && !/friend requests/.test(badged.title),
      badged.title)

    // --- and it goes when the request does ---------------------------------
    const accepted = await js(`(async () => {
      const mine = ${JSON.stringify(setup.me?.token ?? '')}
      const r = await fetch('/api/friends/accept', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + mine },
        body: JSON.stringify({ userId: ${JSON.stringify(asked.id ?? '')} }) })
      return { status: r.status } })()`)
    check('the request can be accepted', accepted.status === 200, accepted)

    const cleared = await until('the badge to go',
      `!document.querySelector('.rl[aria-label="Conversations"] .pip')`, 12000)
    check('answering it clears the badge, without a refresh', cleared === true)

    const after = await js(`(() => ((document.querySelector('.rl[aria-label="Conversations"]') || {}).title || ''))()`)
    check('and the tooltip goes back to plain',
      after === 'Conversations', after)
  },
}
