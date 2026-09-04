/**
 * What the app costs while nobody is touching it.
 *
 * Reported from a real machine: Atrium sitting there had burned 23,340
 * seconds of processor time - about a quarter of a core, continuously - and
 * was holding 858 MB. A chat window that nobody is typing in should cost
 * approximately nothing, so this measures the approximately.
 *
 * Measured with getAppMetrics rather than by watching Task Manager, because
 * it separates the processes: the browser process, each renderer and the GPU
 * are different problems with different causes, and a single total cannot
 * tell you which one is spinning.
 *
 * Not an assertion about a number anybody agreed on - it prints what it sees
 * and fails only on something no idle app can explain. The point is to have
 * the figure at all, and to notice when it changes.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'zz-idle-cost',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    const { app } = require('electron')

    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['Baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the channel list', `document.querySelectorAll('.chan').length > 0`)
    await wait(1500)
    await js(`(() => { const c = document.querySelector('.chan'); if (c) c.click(); return 1 })()`)

    /* Long enough for the opening rush to finish: the world loads, the
       members arrive, the list settles. What is measured after this is the
       app doing nothing. */
    await wait(6000)

    const look = () => {
      const out = {}
      for (const m of app.getAppMetrics()) {
        const kind = m.type === 'Tab' ? 'renderer' : m.type
        const cpu = (m.cpu && m.cpu.percentCPUUsage) || 0
        const mb = Math.round(((m.memory && m.memory.workingSetSize) || 0) / 1024)
        if (!out[kind]) out[kind] = { cpu: 0, mb: 0, n: 0 }
        out[kind].cpu += cpu
        out[kind].mb += mb
        out[kind].n++
      }
      return out
    }

    /* Sampled over a stretch rather than once: a single reading catches
       whatever happened to be running in that instant and says nothing about
       whether it keeps happening. */
    const SAMPLES = 12
    const EVERY = 5000
    const runs = []
    for (let i = 0; i < SAMPLES; i++) {
      await wait(EVERY)
      runs.push(look())
    }

    const kinds = [...new Set(runs.flatMap((r) => Object.keys(r)))]
    const avg = {}
    for (const k of kinds) {
      const seen = runs.filter((r) => r[k])
      avg[k] = {
        cpu: +(seen.reduce((n, r) => n + r[k].cpu, 0) / seen.length).toFixed(2),
        mb: Math.round(seen.reduce((n, r) => n + r[k].mb, 0) / seen.length),
      }
    }
    const total = +Object.values(avg).reduce((n, v) => n + v.cpu, 0).toFixed(2)
    const totalMb = Object.values(avg).reduce((n, v) => n + v.mb, 0)

    console.log('      idle over ' + (SAMPLES * EVERY / 1000) + 's: ' + JSON.stringify(avg))
    console.log('      total: ' + total + '% of a core, ' + totalMb + ' MB')

    /*
     * The one that was reported. A quarter of a core while idle is not a
     * threshold anybody chose - it is the figure measured on the machine this
     * was reported from, so crossing it again is the same fault returning.
     */
    check('the app is not burning a core while nobody touches it',
      total < 25, { percentOfACore: total, per: avg })

    /* And which part, when it is. Printed either way so a regression says
       where to look rather than only that something grew. */
    const worst = Object.entries(avg).sort((a, b) => b[1].cpu - a[1].cpu)[0]
    console.log('      busiest: ' + worst[0] + ' at ' + worst[1].cpu + '%')
  },
}
