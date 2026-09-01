/**
 * How long the app takes to be usable from a cold load.
 *
 * Reported as the desktop client freezing for about half a minute on every
 * reload. Timed rather than felt: what matters is when the channel list is
 * there and the page answers, not when something has been painted.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'zz-startup-cost',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    /* Signed in already, which is the case being complained about: a reload
       of an app that knows who you are. */
    const started = Date.now()
    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`, 60000)
    const toList = Date.now() - started

    /*
     * And still answering. A page can draw a channel list and then sit on a
     * blocked main thread, which is what a freeze is - so this asks it to do
     * something small and times how long it takes to come back.
     */
    const probes = []
    for (let i = 0; i < 5; i++) {
      const t = Date.now()
      await js(`document.querySelectorAll('.chan').length`)
      probes.push(Date.now() - t)
      await wait(300)
    }
    const worst = Math.max(...probes)
    console.log(`      to the channel list: ${toList}ms   answers in: ${JSON.stringify(probes)}ms`)
    check('the app is usable within a few seconds', toList < 8000, toList)
    check('and the page is not blocked once it is', worst < 1200, probes)
  },
}
