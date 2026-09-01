/**
 * Typing a slash in the message box, and what comes of it.
 *
 * Asked for with a screenshot of Discord's command list. There are two ways
 * to use one and both have to work, because people use both without thinking
 * about it: picking from the list that appears, and typing the whole thing
 * out and pressing Enter. The second is the one that breaks silently - the
 * list has closed by then, so nothing is on screen to catch the Enter, and
 * the failure is the literal text `/shrug well then` appearing in the
 * channel.
 *
 * And the thing a slash command must never do is get in the way of an
 * ordinary message. A path typed into chat is a message.
 */
const { signIn, typeAndSend, MESSAGE_BOX, SET_VALUE } = require('../lib.cjs')

/** Put text in the box without sending it, and say what the picker shows. */
const TYPE = (text) => `(() => {
  const box = ${MESSAGE_BOX}
  if (!box) return { ok: false, why: 'no message box' }
  ;(${SET_VALUE})(box, ${JSON.stringify(text)})
  box.setSelectionRange(${text.length}, ${text.length})
  box.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }))
  return { ok: true } })()`

/*
 * One picker for all three.
 *
 * The client this replaced had a menu per kind - one for commands, one for
 * people, one for shortcodes - and this looked for the commands one by name.
 * Here they are the same list drawn in the same place, which is why only one
 * of them can be open at a time, and each row is a name and what it is for.
 */
const PICKER = `(() => {
  const p = document.querySelector('.cmp .picker')
  return {
    open: !!p,
    names: [...document.querySelectorAll('.cmp .picker .pitem b')].map((n) => n.textContent),
    hints: [...document.querySelectorAll('.cmp .picker .pitem .hint')].map((n) => n.textContent),
  } })()`

const KEY = (key) => `(() => {
  const box = ${MESSAGE_BOX}
  box.dispatchEvent(new KeyboardEvent('keydown',
    { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true }))
  return { ok: true } })()`

const DRAFT = `(() => (${MESSAGE_BOX})?.value ?? null)()`

const LAST_MESSAGE = `(() => {
  const rows = [...document.querySelectorAll('.msg')]
  const last = rows[rows.length - 1]
  return last ? last.textContent : null })()`

/*
 * Whether the spoiler is actually hiding anything.
 *
 * The class name proves nothing on its own - what hides the words is
 * `color: transparent`, so that is what gets asked about. A rule that stopped
 * applying would leave the class in place and the secret on screen.
 */
const SPOILER = `(() => {
  const el = document.querySelector('.msg:last-of-type .spo')
    || [...document.querySelectorAll('.spo')].pop()
  if (!el) return { there: false }
  return {
    there: true,
    tag: el.tagName,
    role: el.getAttribute('role'),
    tabIndex: el.getAttribute('tabindex'),
    text: el.textContent,
    colour: getComputedStyle(el).color,
    label: el.getAttribute('aria-label'),
  } })()`

/*
 * Clicking and reading are two steps, and have to be.
 *
 * Showing a spoiler swaps the button for a span, so the element clicked is
 * detached by the time it has been shown - holding on to it reports the old
 * transparent colour for ever, which is a passing feature failing its test.
 * Ask the document again afterwards.
 */
const CLICK_SPOILER = `(() => {
  const el = [...document.querySelectorAll('.spo')].pop()
  if (!el) return { ok: false }
  el.click()
  return { ok: true } })()`

const SPOILER_NOW = `(() => {
  const el = [...document.querySelectorAll('.spo')].pop()
  if (!el) return { there: false }
  return {
    there: true, tag: el.tagName, shown: el.className,
    role: el.getAttribute('role'), tabIndex: el.getAttribute('tabindex'),
    colour: getComputedStyle(el).color, text: el.textContent,
  } })()`

module.exports = {
  name: 'slash-commands',
  width: 1280,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the message box', `!!(${MESSAGE_BOX})`, 15000)
    await wait(800)

    console.log('  --- the list that appears ---')

    await js(TYPE('/'))
    await wait(300)
    const all = await js(PICKER)
    check('a bare slash opens the list', all.open === true, all)
    check('and offers several commands', all.names.length >= 5, all.names)
    check('each one saying what it does', all.hints.every((h) => h && h.length > 3), all.hints)

    await js(TYPE('/shr'))
    await wait(300)
    const narrowed = await js(PICKER)
    check('typing narrows it to one', narrowed.names.length === 1, narrowed.names)
    check('and that one is shrug', /^\/?shrug$/.test(narrowed.names[0] || ''), narrowed.names)

    /* The risk: a picker that opens over an ordinary message. */
    await js(TYPE('either and/or both'))
    await wait(300)
    const mid = await js(PICKER)
    check('a slash mid-sentence opens nothing', mid.open === false, mid)

    await js(TYPE('https://example.com/thing'))
    await wait(300)
    const link = await js(PICKER)
    check('and neither does a link', link.open === false, link)

    console.log('  --- choosing one from the list ---')

    await js(TYPE('/shr'))
    await wait(300)
    await js(KEY('Enter'))
    await wait(400)
    const afterPick = await js(DRAFT)
    /*
     * The command in the box, not the shrug.
     *
     * The client this replaced put the characters in as soon as you chose
     * it; this one leaves the command written out and turns it into the
     * shrug when the message goes. Both leave the message yours to add
     * to, which is what the difference between a text command and an
     * action one is about - and this one keeps working when the command
     * is typed out by hand rather than chosen, which the other only
     * managed by keeping two paths in step.
     */
    check('Enter on the list completes the command',
      /^[/]shrug\s*$/.test(afterPick || ''), afterPick)
    /*
     * In the box, not sent. The message is still yours to add to - which is
     * the whole difference between a text command and an action one.
     */
    const notSentYet = await js(LAST_MESSAGE)
    check('and does not send it yet',
      !String(notSentYet ?? '').includes('(ツ)'), notSentYet)

    await js(KEY('Enter'))
    await until('the shrug to arrive', `document.body.textContent.includes('(ツ)')`, 10000)
    const sent = await js(LAST_MESSAGE)
    check('a second Enter sends it', String(sent).includes('¯\\_(ツ)_/¯'), sent)

    console.log('  --- typing one out in full ---')

    /*
     * The path with no safety net. By the time this is typed the picker has
     * closed, so if the composer does not recognise it on the way out the
     * literal text lands in the channel.
     */
    await typeAndSend(js, '/tableflip well then')
    await until('the flipped table', `document.body.textContent.includes('┻━┻')`, 10000)
    const flipped = await js(LAST_MESSAGE)
    check('a command typed out in full still runs',
      String(flipped).includes('well then (╯°□°）╯︵ ┻━┻'), flipped)
    check('and the slash itself is not in the message',
      !String(flipped).includes('/tableflip'), flipped)

    console.log('  --- and an ordinary message goes through untouched ---')

    await typeAndSend(js, '/usr/local/bin is where it lives')
    await until('the path', `document.body.textContent.includes('/usr/local/bin')`, 10000)
    const path = await js(LAST_MESSAGE)
    check('a path is sent exactly as typed',
      String(path).includes('/usr/local/bin is where it lives'), path)

    console.log('  --- a spoiler, which is the point of /spoiler ---')

    await typeAndSend(js, '/spoiler the butler did it')
    await until('the spoiler', `!!document.querySelector('.spo')`, 10000)
    await wait(400)
    const hidden = await js(SPOILER)
    check('the message becomes a spoiler', hidden.there === true, hidden)
    /*
     * Reachable by keyboard, however it is built.
     *
     * A real <button> was one way; this is a span that says it is a button
     * and takes the tab stop, which is the same promise to anything reading
     * the page and keeps the words inline where a button would break them
     * out. What has to be true is that it can be reached and pressed
     * without a mouse, not which element it is made of.
     */
    check('which can be reached by keyboard',
      hidden.role === 'button' && Number(hidden.tabIndex) >= 0, hidden)
    check('and the words are genuinely hidden, not just classed',
      hidden.colour === 'rgba(0, 0, 0, 0)', hidden.colour)
    check('with the text still there to be revealed',
      String(hidden.text).includes('the butler did it'), hidden.text)
    check('and something a screen reader can act on',
      /hidden/i.test(String(hidden.label ?? '')), hidden.label)

    const clicked = await js(CLICK_SPOILER)
    check('there is a spoiler to click', clicked.ok === true, clicked)
    await wait(400)
    const shown = await js(SPOILER_NOW)
    check('clicking it shows the words', shown.colour !== 'rgba(0, 0, 0, 0)', shown)
    check('and it says so', /(^| )open( |$)|is-shown/.test(String(shown.shown)), shown.shown)
    check('with the words still the words', String(shown.text).includes('the butler did it'), shown.text)

    console.log('  --- an action command opens something instead ---')

    await js(TYPE('/gif'))
    await wait(300)
    await js(KEY('Enter'))
    await wait(600)
    const picker = await js(`(() => ({
      gifs: !!document.querySelector('.gifs'),
      draft: (${MESSAGE_BOX})?.value ?? null }))()`)
    check('/gif opens the GIF picker', picker.gifs === true, picker)
    check('and empties the box, because the slash was the instruction',
      picker.draft === '', picker)
  },
}
