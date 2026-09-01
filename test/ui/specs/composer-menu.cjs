/**
 * Right-clicking in the message box.
 *
 * On the web this gave the browser's own menu, which knows about cut and
 * paste and nothing about this app. In the desktop shell it gave nothing at
 * all: Electron shows no context menu unless one is built, and none was. So
 * on the desktop the mouse had no way to cut or paste at all, and on neither
 * was there any way to make the selected word bold.
 *
 * What is checked here is the menu appearing where it should, offering what
 * it should for the selection there actually is, and the formatting working.
 *
 * What is deliberately NOT checked is Cut, Copy and Paste. This suite drives
 * a real Electron window on a real machine, and those three write to the
 * clipboard somebody is using at the time. Their wiring is one call each to a
 * bridge that is checked in the unit tests; taking over the clipboard to
 * prove it is not a fair trade. The items are checked for being present and
 * correctly enabled, which is where the logic actually lives.
 */
const { signIn, MESSAGE_BOX, hitTestFor } = require('../lib.cjs')

/** Select part of the draft and right-click on it. */
const RIGHT_CLICK = (text, start, end) => `(() => {
  const box = ${MESSAGE_BOX}
  if (!box) return { ok: false, why: 'no message box' }
  const proto = window.HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  box.focus()
  box.setSelectionRange(${start}, ${end})
  const r = box.getBoundingClientRect()
  const ev = new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: Math.round(r.left + 40), clientY: Math.round(r.top + 10),
  })
  box.dispatchEvent(ev)
  /* The browser's own menu must not also be coming. */
  return { ok: true, prevented: ev.defaultPrevented }
})()`

const MENU = `(() => {
  const m = document.querySelector('.ctx')
  if (!m) return { open: false }
  const rows = [...m.querySelectorAll('.mitem')]
  const r = m.getBoundingClientRect()
  return {
    open: true,
    /* The words on the row, without the key drawn at the end of it - the
       label is a bare piece of text here rather than a span of its own, so
       taking the first span took the shortcut instead. */
    items: rows.map((b) => {
      const k = b.querySelector('.cm-key')
      return (b.textContent || '').replace(k ? (k.textContent || '') : '', '').trim()
    }),
    disabled: rows.filter((b) => b.disabled).map((b) => {
      const k = b.querySelector('.cm-key')
      return (b.textContent || '').replace(k ? (k.textContent || '') : '', '').trim()
    }),
    keys: [...m.querySelectorAll('.cm-key')].map((k) => k.textContent),
    onScreen: r.top >= 0 && r.left >= 0
      && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
  } })()`

const CLICK_ITEM = (label) => `(() => {
  /* By the words on the row without the key at the end of it. */
  const b = [...document.querySelectorAll('.ctx .mitem')]
    .find((x) => {
      const k = x.querySelector('.cm-key')
      return (x.textContent || '').replace(k ? (k.textContent || '') : '', '').trim()
        === ${JSON.stringify(label)}
    })
  if (!b) return { ok: false, why: 'no ' + ${JSON.stringify(label)} }
  b.click()
  return { ok: true } })()`

const DRAFT = `(() => {
  const box = ${MESSAGE_BOX}
  return box ? { text: box.value, start: box.selectionStart, end: box.selectionEnd } : null })()`

const PRESS = (key, mods) => `(() => {
  const box = ${MESSAGE_BOX}
  box.focus()
  box.dispatchEvent(new KeyboardEvent('keydown', Object.assign(
    { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }, ${JSON.stringify(mods)})))
  return { ok: true } })()`

/**
 * Right-click again without shutting the menu, the way a mouse really does:
 * mousedown first - which the menu's own away-handler sees - then
 * contextmenu. React batches the two, so nothing remounts.
 */
const SECOND_RIGHT_CLICK = (start, end) => `(() => {
  const box = ${MESSAGE_BOX}
  box.focus()
  box.setSelectionRange(${start}, ${end})
  const r = box.getBoundingClientRect()
  const where = { bubbles: true, cancelable: true,
    clientX: Math.round(r.left + 60), clientY: Math.round(r.top + 12) }
  box.dispatchEvent(new MouseEvent('mousedown', Object.assign({ button: 2 }, where)))
  box.dispatchEvent(new MouseEvent('contextmenu', where))
  return { ok: true } })()`

const SELECT = (start, end) => `(() => {
  const box = ${MESSAGE_BOX}
  box.focus(); box.setSelectionRange(${start}, ${end}); return { ok: true } })()`

module.exports = {
  name: 'composer-menu',
  width: 1280,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO' })
    check('the server can be set up', setup.ok === true, setup.why)

    await win.loadURL(base + '/')
    await until('the message box', `!!(${MESSAGE_BOX})`, 15000)
    await wait(800)

    console.log('  --- with something selected ---')

    const opened = await js(RIGHT_CLICK('say hello there', 4, 9))
    check('the right-click is taken', opened.ok === true, opened)
    check('and the browser menu is called off', opened.prevented === true, opened)
    await wait(300)

    const menu = await js(MENU)
    check('our menu opens instead', menu.open === true, menu)
    check('with the formatting on offer',
      ['Bold', 'Italic', 'Strikethrough', 'Code', 'Spoiler'].every((l) => menu.items.includes(l)),
      menu.items)
    check('and the two that work on whole lines',
      ['Quote', 'Code block'].every((l) => menu.items.includes(l)), menu.items)
    check('and the editing actions too',
      ['Cut', 'Copy', 'Paste', 'Select all'].every((l) => menu.items.includes(l)),
      menu.items)
    check('nothing is greyed out when there is a selection',
      !menu.disabled.includes('Cut') && !menu.disabled.includes('Copy'), menu.disabled)
    check('each one shows the shortcut that does it',
      menu.keys.includes('Ctrl+B') && menu.keys.includes('Ctrl+V'), menu.keys)
    check('and the whole menu is on the screen', menu.onScreen === true, menu)

    /*
     * A menu that is drawn but covered is a menu that does not work, and
     * dispatching a click at it would never notice. This asks what is
     * actually at the middle of the item.
     */
    const hit = await js(hitTestFor('.ctx .mitem'))
    check('and a pointer would actually land on it', hit.hittable === true, hit)

    console.log('  --- and it does the formatting ---')

    await js(CLICK_ITEM('Bold'))
    await wait(400)
    const bolded = await js(DRAFT)
    check('Bold wraps the selected words', bolded.text === 'say **hello** there', bolded)
    check('and leaves the words selected, not the stars',
      bolded.text.slice(bolded.start, bolded.end) === 'hello', bolded)

    /* Which means the next one nests rather than fighting it. */
    await js(RIGHT_CLICK('say **hello** there', 6, 11))
    await wait(300)
    await js(CLICK_ITEM('Italic'))
    await wait(400)
    const both = await js(DRAFT)
    check('Italic on top of Bold nests inside it',
      both.text === 'say ***hello*** there', both)

    /* And doing the same one twice takes it off again. */
    await js(RIGHT_CLICK('say **hello** there', 6, 11))
    await wait(300)
    await js(CLICK_ITEM('Bold'))
    await wait(400)
    const plain = await js(DRAFT)
    check('Bold a second time takes it off', plain.text === 'say hello there', plain)

    /* Quote marks the line, not the characters, which is the only thing it
       could mean when three words in the middle were selected. */
    await js(RIGHT_CLICK('say hello there', 4, 9))
    await wait(300)
    await js(CLICK_ITEM('Quote'))
    await wait(400)
    const quoted = await js(DRAFT)
    check('Quote marks the whole line', quoted.text === '> say hello there', quoted)

    /*
     * A second right-click, without shutting the menu in between.
     *
     * A real right-click sends mousedown first, which closes the menu, and
     * then contextmenu, which opens it again - both in one batch, so React
     * never remounts the component. Anything the menu read once about the
     * selection would still be the selection from the click before, and Bold
     * would land on the wrong words.
     */
    await js(RIGHT_CLICK('one two three', 0, 3))
    await wait(250)
    await js(SECOND_RIGHT_CLICK(4, 7))
    await wait(300)
    await js(CLICK_ITEM('Bold'))
    await wait(400)
    const second = await js(DRAFT)
    check('a second right-click uses the newer selection',
      second.text === 'one **two** three', second)

    console.log('  --- with nothing selected ---')

    await js(RIGHT_CLICK('say hello there', 5, 5))
    await wait(300)
    const empty = await js(MENU)
    check('the menu still opens', empty.open === true, empty)
    check('but the formatting is not offered, having nothing to format',
      !empty.items.includes('Bold'), empty.items)
    check('and Cut and Copy are greyed out',
      empty.disabled.includes('Cut') && empty.disabled.includes('Copy'), empty.disabled)
    check('while Paste is still there, because it does not need one',
      empty.items.includes('Paste') && !empty.disabled.includes('Paste'), empty)

    /* Escape shuts it, like every other menu in the app. */
    await js(`(() => { document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1 })()`)
    await wait(300)
    const shut = await js(MENU)
    check('Escape shuts it', shut.open === false, shut)

    /*
     * And on a phone it must not appear at all.
     *
     * A long-press in a text box fires contextmenu, so taking this event on
     * a touch screen takes away the selection bubble the phone puts up -
     * where Paste, Select All and Look Up live. This menu was asked for on
     * the desktop. Checked by making the window narrow enough for the same
     * media query the composer focus rule uses.
     */
    await win.setSize(700, 900)
    await wait(600)
    const onPhone = await js(RIGHT_CLICK('say hello there', 4, 9))
    await wait(300)
    const phoneMenu = await js(MENU)
    check('a long-press on a phone opens nothing of ours', phoneMenu.open === false, phoneMenu)
    check('and the event is left for the phone to handle',
      onPhone.prevented === false, onPhone)

    await win.setSize(1280, 900)
    await wait(600)

    console.log('  --- and the keyboard does it without the menu ---')

    await js(RIGHT_CLICK('say hello there', 4, 9))
    await wait(200)
    await js(`(() => { document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1 })()`)
    await wait(300)
    await js(SELECT(4, 9))
    await js(PRESS('b', { ctrlKey: true }))
    await wait(400)
    const viaKey = await js(DRAFT)
    check('Ctrl-B bolds the selection', viaKey.text === 'say **hello** there', viaKey)

    await js(SELECT(6, 11))
    await js(PRESS('s', { ctrlKey: true, shiftKey: true }))
    await wait(400)
    const spoilered = await js(DRAFT)
    check('and Ctrl-Shift-S makes it a spoiler',
      spoilered.text === 'say **||hello||** there', spoilered)

    /*
     * The thing that must not have broken: b without ctrl must not bold.
     *
     * This does not prove typing still works - a synthetic keydown never
     * inserts a character, so the box would read the same either way. What
     * it does prove is that the shortcut needs its modifier, which is the
     * half that could actually regress here.
     */
    await js(PRESS('b', {}))
    await wait(200)
    const stillThere = await js(DRAFT)
    check('b without ctrl does not bold anything',
      stillThere.text === 'say **||hello||** there', stillThere)
  },
}
