/**
 * Deleting a server you made, and only that one.
 *
 * Owning a server was a one-way door: an owner cannot leave their own server,
 * and there was nothing to delete it with, so one made by mistake stayed for
 * ever. Asked for with the worry attached - that it must take the chosen
 * server and nothing else.
 *
 * The server side of that is checked in the independence suite, which counts
 * what is left afterwards. This is about the door itself: that it is shut to
 * people who do not own the server, that it cannot be opened by accident, and
 * that going through it actually works.
 */
const { signIn } = require('../lib.cjs')

module.exports = {
  name: 'delete-server',
  width: 1400,
  height: 900,

  async run({ js, until, wait, win, check, base }) {
    await win.loadURL(base + '/')
    const setup = await signIn(js, { owner: 'JacksFO', friends: ['baileyyy'] })
    check('the server can be set up', setup.ok === true, setup.why)

    // A second server, so deleting one leaves something to check.
    const made = await js(`(async () => {
      const token = ${JSON.stringify(setup.me?.token ?? '')}
      const r = await (await fetch('/api/spaces', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ name: 'Scratch Server' }) })).json()
      return { ok: !!r.space, id: r.space && r.space.id } })()`)
    check('a second server can be made', made.ok === true, made)

    await win.loadURL(base + '/')
    await until('the rail', `document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)').length >= 2`)
    await wait(2000)
    await js(`(() => {
      const pips = [...document.querySelectorAll('.pane.rail .rl:not([aria-label="Conversations"]):not(.rlread):not(.rlnew)')]
      if (pips[1]) pips[1].click()
      return 1 })()`)
    await wait(2000)

    /** Open settings, on the overview pane. */
    const openOverview = async () => {
      await js(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) =>
          /settings/i.test(x.title || x.getAttribute('aria-label') || ''))
        if (b) b.click()
        return 1 })()`)
      // Waited for, not slept through. These were 1500ms guesses at how long
      // a panel takes to open, which is fine alone and not fine behind
      // nineteen other specs on a busy machine.
      await until('the settings pane', `!!document.querySelector('.snav button')`)
      await js(`(() => {
        const b = [...document.querySelectorAll('.snav button')].find((x) => /overview/i.test(x.textContent))
        if (b) b.click()
        return 1 })()`)
      await until('the danger zone',
        `[...document.querySelectorAll('button')].some((b) => /delete .*server/i.test(b.textContent))`)
    }

    await openOverview()

    /*
     * The gate is one step in rather than on the first button.
     *
     * The client this replaced put the whole thing on screen at once with a
     * dead button at the bottom. This one asks first - the button opens a
     * form, and the destructive button inside it is what starts dead until
     * the server's name has been typed. Same gate, one step further in, so
     * this opens the form before deciding whether it is shut.
     */
    await js(`(() => {
      const b = [...document.querySelectorAll('.card.danger button')]
        .find((x) => /delete .*server/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await wait(600)

    const zone = await js(`(() => {
      const heads = [...document.querySelectorAll('.card h4')].map((h) => h.textContent.trim())
      const card = document.querySelector('.card.danger')
      const btn = card
        ? [...card.querySelectorAll('button')].filter((b) => b.classList.contains('bad')).pop()
        : null
      const words = card ? card.innerText : ''
      return {
        heads,
        offered: !!btn,
        disabled: btn ? btn.disabled : null,
        /* Said in this client's words: there is no undoing it, and what goes
           is what is in the server. */
        warning: /no undoing this|cannot be undone/i.test(words),
        saysConversationsSafe:
          /Conversations and friendships are not affected/i.test(words)
          || /for everybody who is in it/i.test(words),
      } })()`)
    console.log('      danger zone: ' + JSON.stringify(zone))

    check('the owner is offered a way to delete it', zone.offered === true, zone.heads)
    check('but the button starts dead', zone.disabled === true)
    check('with a warning that it cannot be undone', zone.warning === true)
    check('and a note that conversations are not affected', zone.saysConversationsSafe === true)

    // --- typing the wrong thing does not arm it ---------------------------
    const wrong = await js(`(() => {
      const input = [...document.querySelectorAll('.fld input')].find((i) => i.placeholder === 'Scratch Server')
      if (!input) return { found: false }
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(input, 'scratch')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const btn = [...document.querySelectorAll('.card.danger button')].find((b) => b.classList.contains('bad'))
      return { found: true, disabled: btn ? btn.disabled : null } })()`)
    await wait(400)
    check('a near miss does not arm it', wrong.found === true && wrong.disabled === true, wrong)

    // --- the exact name does ----------------------------------------------
    const armed = await js(`(() => {
      const input = [...document.querySelectorAll('.fld input')].find((i) => i.placeholder === 'Scratch Server')
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(input, 'Scratch Server')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return { ok: true } })()`)
    void armed
    await wait(500)
    const nowArmed = await js(`(() => {
      const btn = [...document.querySelectorAll('.card.danger button')].find((b) => b.classList.contains('bad'))
      return btn ? btn.disabled : null })()`)
    check('the exact name arms it', nowArmed === false, nowArmed)

    /*
     * --- and it asked before it could be pressed at all -------------------
     *
     * The client this replaced armed the button and then put a second
     * dialog in front of it. This one asks first: the button cannot be
     * pressed until the server's own name has been typed into the box
     * above it, and the box says which name. That is the same protection
     * one step earlier - a mis-click cannot delete a server either way -
     * so what is checked is the gate rather than the dialog.
     */
    const asked = await js(`(() => {
      const card = document.querySelector('.card.danger')
      if (!card) return { open: false }
      return { open: true,
        title: card.innerText,
        buttons: [...card.querySelectorAll('button')].map((b) => b.textContent.trim()) } })()`)
    console.log('      the gate: ' + JSON.stringify(asked.buttons))
    check('it asks before doing it', asked.open === true)
    /* Case-insensitively: the label is drawn in capitals by the stylesheet,
       so the words that come back are shouted. */
    check('naming the server in the question', /scratch server/i.test(asked.title || ''), asked.title)
    check('with a way to back out',
      (asked.buttons || []).some((b) => /keep it|cancel/i.test(b)), asked.buttons)

    // Back out, and confirm nothing happened.
    await js(`(() => {
      const b = [...document.querySelectorAll('.card.danger button')].find((x) => /keep it|cancel/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await wait(1200)
    const afterCancel = await js(`(async () => {
      const token = ${JSON.stringify(setup.me?.token ?? '')}
      const r = await (await fetch('/api/spaces', { headers: { authorization: 'Bearer ' + token } })).json()
      return (r.spaces || []).map((s) => s.name) })()`)
    check('cancelling deletes nothing', afterCancel.includes('Scratch Server'), afterCancel)

    /* --- go through with it ----------------------------------------------
     *
     * Backing out shut the form and forgot what had been typed, which is
     * the point of backing out - so this opens it again and types the name
     * again before pressing the button. */
    await js(`(() => {
      const b = [...document.querySelectorAll('.card.danger button')]
        .find((x) => /delete .*server/i.test(x.textContent))
      if (b) b.click()
      return 1 })()`)
    await wait(600)
    await js(`(() => {
      const input = [...document.querySelectorAll('.fld input')].find((i) => i.placeholder === 'Scratch Server')
      if (!input) return 0
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(input, 'Scratch Server')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return 1 })()`)
    await wait(500)
    await js(`(() => {
      const b = [...document.querySelectorAll('.card.danger button')].find((x) => x.classList.contains('bad'))
      if (b && !b.disabled) b.click()
      return 1 })()`)
    // The settings window closing is the app saying the delete went through,
    // so that is what to wait for rather than three seconds of hoping.
    await until('the settings window to close',
      `!document.querySelector('.sbody, .settings')`, 12000)

    // The panel was describing the server that just went, so it has to go too
    // - otherwise it redraws against whatever the app falls back to, which
    // reads as the delete having hit the wrong one.
    const panel = await js(`(() => ({ open: !!document.querySelector('.sbody, .settings') }))()`)
    check('the settings window closes once its server is gone', panel.open === false, panel)

    const afterDelete = await js(`(async () => {
      const token = ${JSON.stringify(setup.me?.token ?? '')}
      const r = await (await fetch('/api/spaces', { headers: { authorization: 'Bearer ' + token } })).json()
      return (r.spaces || []).map((s) => s.name) })()`)
    console.log('      servers left: ' + JSON.stringify(afterDelete))
    check('the chosen server is gone', !afterDelete.includes('Scratch Server'), afterDelete)
    check('and the other one is not', afterDelete.length === 1, afterDelete)
  },
}
