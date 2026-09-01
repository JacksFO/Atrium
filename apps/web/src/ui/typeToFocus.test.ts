import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Start typing and it goes in the box.
 *
 * Coming back to the window and typing put the letters nowhere - the box has
 * to be clicked first, and the first word of what somebody meant to say is
 * gone by the time they notice.
 *
 * The thing worth checking is not that it works but that it stays out of the
 * way, because it listens to every key in the window. Every condition below
 * is a place where taking the keystroke would be worse than never having
 * done this: a shortcut, somebody writing somewhere else, or a dialog that
 * owns the keyboard while it is up.
 *
 * Read from the source because it is a listener on `window` inside a
 * component that needs a channel, a roster and a gateway to mount - and what
 * is being checked is the shape of one `if`, which a render cannot show.
 */

const src = readFileSync(join(__dirname, 'Composer.tsx'), 'utf8')
  .split('\r\n').join('\n')

const handler = (() => {
  const from = src.indexOf('const start = (e: KeyboardEvent) => {')
  expect(from, 'the handler is there').toBeGreaterThan(-1)
  const to = src.indexOf('\n    }\n', from)
  expect(to).toBeGreaterThan(from)
  return src.slice(from, to)
})()

describe('typing anywhere picks the box up', () => {
  /*
   * On keydown, not on the character arriving.
   *
   * This is the whole reason nothing is dropped: the browser finishes the
   * event by putting the character into whatever holds focus at the end of
   * it, so moving focus during keydown means the keystroke lands by itself.
   * Doing it later means catching the character and replaying it by hand,
   * which is where the off-by-one bugs live.
   */
  it('moves focus during keydown, so the keystroke lands by itself', () => {
    expect(src).toContain("window.addEventListener('keydown', start)")
    expect(handler).toContain('el.focus()')
    /* And nothing is replayed - if this ever sets the value itself, the
       character has been taken rather than delivered. */
    expect(handler).not.toMatch(/el\.value\s*[+]?=/)
  })

  it('and takes the listener away with it', () => {
    expect(src).toContain("window.removeEventListener('keydown', start)")
  })
})

describe('and stays out of the way of', () => {
  it('anything somebody else has already acted on', () => {
    expect(handler).toContain('e.defaultPrevented')
  })

  /* Shift is deliberately not here: it is how capitals and most punctuation
     are typed, and excluding it would mean a capital letter opened nothing. */
  it('every shortcut, while still allowing shift', () => {
    expect(handler).toContain('e.ctrlKey || e.metaKey || e.altKey')
    expect(handler).not.toContain('e.shiftKey')
  })

  /* Enter, Escape, Tab, the arrows and the F-keys all report a name rather
     than a character here, and every one of them means something elsewhere. */
  it('and every key that is not a character', () => {
    expect(handler).toContain('e.key.length !== 1')
  })

  /*
   * And anywhere somebody is already writing.
   *
   * The search box, a channel being renamed, a message being edited, a box
   * in a dialog. Stealing a letter out of one of those is worse than never
   * having done this at all.
   */
  it('and anywhere else that takes typing', () => {
    expect(handler).toContain("on.tagName === 'INPUT'")
    expect(handler).toContain("on.tagName === 'TEXTAREA'")
    expect(handler).toContain('on.isContentEditable')
  })

  /* Including the box itself, or every keystroke costs a focus call. */
  it('and the box when it already has focus', () => {
    expect(handler).toContain('el === document.activeElement')
  })

  /*
   * And anything open over the top.
   *
   * A dialog or a menu owns the keyboard while it is up - Escape closes it,
   * letters move through it - and the conversation underneath is not what is
   * being used.
   */
  it('and a dialog or a menu that is open', () => {
    expect(handler).toContain(".modal, .ctx, .scrim")
  })

  /* And it does not run at all where the person cannot send anyway. */
  it('and a channel they may not write in', () => {
    const at = src.indexOf('const start = (e: KeyboardEvent)')
    expect(src.slice(Math.max(0, at - 400), at)).toContain('if (!maySend) return')
  })
})
