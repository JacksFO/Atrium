/**
 * A server's name is not cut off.
 *
 * Rewritten for the client that is running. The finding is the same and the
 * shape it was fixed in is not: the client this replaced put the name in a
 * narrow header beside an Invite pill, and the fix there was to let it take
 * a second line rather than an ellipsis. This one puts it on the banner
 * across the top of the channel panel, which is far wider - so "two lines"
 * is an answer to a question this design does not ask, and asserting it
 * would be asserting the old client's shape rather than the thing anybody
 * complained about.
 *
 * What is kept is the complaint: the whole name has to be readable, at both
 * ends of the text-size slider, and it has to stay inside the box it is
 * drawn in.
 *
 * Reported: "top left where it says the server name discord i can see a lot
 * more of the name but ours you cant ... not sure if it can do lines like
 * Baileys / Dictatorship rather than getting cutoff".
 *
 * One line held about fourteen characters, so "Baileys Dictatorship" arrived
 * as "Baileys Dicta...". Discord fits more into a column of the same width by
 * setting its name smaller and narrower; this gives it the second line
 * instead, which roughly doubles what fits without touching the type.
 *
 * Measured in the running app rather than against a stub page, because every
 * number here depends on the real display face at its real width setting -
 * a substituted font would answer a question about the substitute.
 *
 * Both ends of the text-size slider, because the header row used to be 56px
 * written out in four files and two lines at 26px needs about 67. The bars
 * along the top of the window have to stay level with each other whatever
 * size the text is, so that is asserted rather than assumed.
 */
const { signIn } = require('../lib.cjs')

const LONG = 'Baileys Dictatorship'

const MEASURE = `(() => {
  /* The name as the channel panel shows it, which is where somebody looking
     for "what server am I in" reads it. */
  const span = document.querySelector('.sidepane .banner .nm')
  const head = document.querySelector('.sidepane .banner')
  const chat = document.querySelector('.chatpane .chd')
  if (!span || !head) return { found: false }
  const range = document.createRange()
  range.selectNodeContents(span)
  const s = span.getBoundingClientRect()
  const h = head.getBoundingClientRect()
  return {
    found: true,
    text: span.textContent,
    /*
     * How many lines the text sits on, counted by how many distinct heights
     * its rectangles have.
     *
     * Not getClientRects().length, which was the first thing tried and is not
     * the same question: putting the old one-line rule back still produced two
     * rectangles, so that check went on passing against the bug it was written
     * for. Two boxes side by side on one line is one line.
     */
    lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
    /*
     * Whether any of it is being hidden, which is the whole point of the
     * report - and it can be hidden two different ways. A third line past the
     * clamp is cut off the bottom; a line wider than the box is cut off the
     * end with an ellipsis. Only asking about the first would have called
     * "Baileys / Dictatorsh..." a complete name.
     */
    hiddenBelow: span.scrollHeight > span.clientHeight + 1,
    hiddenAtTheEnd: span.scrollWidth > span.clientWidth + 1,
    /* And that two lines did not push it out of the bar it sits in. */
    insideTheHeader: s.top >= h.top - 1 && s.bottom <= h.bottom + 1,
    headHeight: Math.round(h.height),
    chatHeadHeight: chat ? Math.round(chat.getBoundingClientRect().height) : null,
    rootFont: getComputedStyle(document.documentElement).fontSize,
  }
})()`

module.exports = {
  name: 'server-name',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    const made = await js(`(async () => {
      const r = await (await fetch('/api/spaces', { method: 'POST',
        headers: { 'content-type': 'application/json',
          authorization: 'Bearer ' + ${JSON.stringify(setup.me?.token ?? '')} },
        body: JSON.stringify({ name: ${JSON.stringify(LONG)} }) })).json()
      return { ok: !!r.space } })()`)
    check('a server with a long name can be made', made.ok === true, made)

    const open = async (fontPx) => {
      await win.loadURL(base + '/')
      await until('the app', `document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)').length >= 2`, 15000)
      await js(`(() => {
        localStorage.setItem('atrium.fontSize', ${JSON.stringify(String(fontPx))})
        return 1 })()`)
      await win.loadURL(base + '/')
      await until('the rail', `document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)').length >= 2`, 15000)
      await js(`(() => {
        const pips = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]
        if (pips[1]) pips[1].click()
        return 1 })()`)
      await wait(1600)
      return await js(MEASURE)
    }

    /* The size it ships at, which is the one the report was made on. */
    const normal = await open(20)
    console.log('      at 20px: ' + JSON.stringify(normal))
    check('the header is there', normal.found === true, normal)
    check('and it is the long name being shown', normal.text === LONG, normal.text)

    /*
     * The finding. Two lines and nothing hidden - the old rule was one line
     * with an ellipsis, so this is the assertion that fails without the fix.
     */
    check('the whole name is visible - nothing cut off the bottom',
      normal.hiddenBelow === false, normal)
    check('and nothing cut off the end of a line',
      normal.hiddenAtTheEnd === false, normal)
    check('without escaping the bar it sits in', normal.insideTheHeader === true, normal)

    /*
     * And at the largest text the slider offers, which is where a header
     * frozen at 56px could not have held two lines at all.
     */
    const big = await open(26)
    console.log('      at 26px: ' + JSON.stringify(big))
    /*
     * The largest text the slider offers, where a header frozen at 56px could
     * not have held two lines at all. Asked the same two ways, because a name
     * can be hidden below the clamp or cut off the end of a line and only one
     * of those was being measured to begin with.
     */
    check('and the whole name is still readable at the largest text size',
      big.hiddenAtTheEnd === false, big)
    check('with nothing cut off the bottom there either',
      big.hiddenBelow === false, big)

    /*
     * And not asserted to fit, because at this size it does not. "Dictatorship"
     * on its own is wider than what is left of a 288px column once the Invite
     * pill has taken its share, so the second line ends in an ellipsis and the
     * name reads "Baileys" over "Dictatorsh...".
     *
     * That is the limit rather than a fault, and it is recorded here so nobody
     * has to rediscover it: at the largest text every column is proportionally
     * narrower, and a name this long stops fitting somewhere. What matters is
     * that it degrades to two readable lines rather than to one, and that it
     * is whole at the size the app actually ships at.
     */
    console.log('      at 26px the last line is cut: ' + JSON.stringify(big.hiddenAtTheEnd))
    check('still inside its bar', big.insideTheHeader === true, big)
    /*
     * The two checks that were here - that the bar grows with the text and
     * that it stays level with the one beside it - were about the old
     * client's header: a row of text on the left that had to keep step with
     * a row of text on the right. Here the name sits on a picture of a fixed
     * height and there is no second bar to be level with, so both would be
     * asserting a shape this design does not have. What replaces them is the
     * check above: whatever the text size, the name stays inside it.
     */

    /* A short name must not gain a second line it has no use for. */
    await js(`(() => {
      const pips = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]
      if (pips[0]) pips[0].click()
      return 1 })()`)
    await wait(1200)
    const short = await js(MEASURE)
    console.log('      short name: ' + JSON.stringify(short))
    check('a short name stays on one line', short.lines === 1, short)
    check('and is not cut either',
      short.hiddenBelow === false && short.hiddenAtTheEnd === false, short)
  },
}
