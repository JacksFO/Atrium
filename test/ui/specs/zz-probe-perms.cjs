/**
 * What the client thinks you may do, printed.
 *
 * Not a test - a question, asked because the message menu offered Reply, Pin,
 * Edit and Delete but no reactions, to somebody who owns the server. Either
 * the server is not sending add_reactions, or the client is losing it on the
 * way, and guessing between those two is how an afternoon disappears.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'zz-probe-perms',
  width: 1500,
  height: 950,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`)
    await wait(1200)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)
    await wait(1200)

    /* Straight from the socket, before the client has done anything with it. */
    const fromServer = await js(`(async () => {
      return await new Promise((resolve) => {
        const s = new WebSocket('ws://' + location.host + '/gateway')
        s.onopen = () => s.send(JSON.stringify({ t: 'hello',
          token: localStorage.getItem('atrium.token') }))
        s.onmessage = (e) => {
          const m = JSON.parse(e.data)
          if (m.t === 'ping') return s.send(JSON.stringify({ t: 'pong' }))
          if (m.t === 'ready') {
            s.close()
            resolve({
              permissionsBySpace: m.permissions ?? m.permissionsBySpace ?? null,
              channelPermissions: m.channelPermissions ?? null,
              keys: Object.keys(m),
            })
          }
        }
        setTimeout(() => resolve({ why: 'never ready' }), 9000)
      })
    })()`)
    console.log('      ready frame keys: ' + JSON.stringify(fromServer.keys))
    console.log('      permissions by space: ' + JSON.stringify(fromServer.permissionsBySpace))
    console.log('      channel exceptions:   ' + JSON.stringify(fromServer.channelPermissions))
    check('the server said what you may do somewhere',
      !!fromServer.permissionsBySpace, fromServer.why)
  },
}
