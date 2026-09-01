/**
 * The gate's own numbers, where somebody can read them.
 *
 * "Sometimes it doesn't pick up when I'm talking" is the one voice complaint
 * a level bar cannot answer. The bar moves whether or not the gate opens, and
 * by the time you have finished a sentence and looked down, it has gone back
 * to nothing - so the question of whether your voice ever reached the line is
 * exactly the question the bar refuses to keep.
 *
 * This is the readout that keeps it: the loudest reading since the pane was
 * opened, the line it is being judged against, the room underneath it, and
 * whether anything is going out right now.
 *
 * What is checked is not that the gate is right - nothing is being said into
 * this machine - but that the four rows are drawn, named, sized to their
 * column and reachable from the voice pane, because a diagnostic nobody can
 * find diagnoses nothing.
 *
 * The numbers it does print are worth a glance all the same. On a silent
 * input the line sits around 5, and the line is the noise floor times 1.9
 * plus a flat 5 - so in a quiet room almost all of it is that constant, and
 * nothing about it knows how loud this particular microphone runs.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'voice-gate-readout',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the app', `document.querySelectorAll('.chan').length > 0`, 15000)
    await wait(1500)

    /* Yours, by your name at the bottom - the server's gear says "settings"
       too and comes first. */
    await js(`(() => {
      const b = document.querySelector('.mebar button[aria-label="Your settings"]')
      if (b) b.click()
      return 1 })()`)
    await wait(1500)
    await js(`(() => {
      const b = [...document.querySelectorAll('.snav button')]
        .find((x) => /voice/i.test(x.textContent.trim()))
      if (b) b.click()
      return 1 })()`)
    /* The card's title is a sibling heading rather than something inside it,
       so a card is never found by the words above it. This one is the card
       holding the readout, which nothing else has. */
    await until('the microphone test',
      `!!document.querySelector('.ascard .gaten')`, 15000)
    await wait(800)

    const shown = await js(`(() => {
      const dl = document.querySelector('.ascard .gaten')
      if (!dl) return { ok: false, why: 'no readout' }
      const rows = [...dl.querySelectorAll('div')].map((d) => ({
        name: (d.querySelector('dt') || {}).textContent || '',
        value: (d.querySelector('dd') || {}).textContent || '',
      }))
      const box = dl.getBoundingClientRect()
      const card = dl.closest('.ascard').getBoundingClientRect()
      return {
        ok: true, rows,
        /* Inside the card it belongs to, rather than spilling out of it -
           the aside is a narrow column and a grid is an easy thing to
           overflow. */
        within: box.right <= card.right + 1 && box.left >= card.left - 1,
        wide: Math.round(box.width), card: Math.round(card.width),
      } })()`)
    console.log('      readout: ' + JSON.stringify(shown.rows))
    check('the readout is on the microphone test card', shown.ok === true, shown)

    const named = (shown.rows || []).map((r) => r.name)
    check('it names the loudest reading, the line, the room and what is happening now',
      ['Loudest', 'The line', 'The room', 'Now'].every((n) => named.includes(n)), named)

    /* Every row has something in it. A label with an empty value beside it is
       a row that reads as broken rather than as zero. */
    check('and every one of them has a value',
      (shown.rows || []).every((r) => r.value.trim().length > 0), shown.rows)

    check('and it fits the column it is in', shown.within === true,
      { readout: shown.wide, card: shown.card })

    /* The button that puts the loudest reading back, so a second attempt is
       not judged against the first one's best moment. */
    const again = await js(`(() => {
      const dl = document.querySelector('.ascard .gaten')
      const card = dl && dl.closest('.ascard')
      if (!card) return { ok: false, why: 'no card' }
      const b = [...card.querySelectorAll('button')]
        .find((x) => /start again/i.test(x.textContent || ''))
      if (!b) return { ok: false, why: 'no button',
        saw: [...card.querySelectorAll('button')].map((x) => x.textContent.trim()) }
      /* Really pressable, not merely present: elementFromPoint, because a
         dispatched click ignores anything drawn over the top of it. */
      const r = b.getBoundingClientRect()
      const at = document.elementFromPoint(
        Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
      return { ok: true, hit: b.contains(at) || b === at } })()`)
    check('the loudest reading can be started again', again.ok === true, again)
    check('and that button is not covered by anything', again.hit === true, again)
  },
}
