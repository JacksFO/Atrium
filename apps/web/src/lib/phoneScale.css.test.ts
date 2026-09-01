import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * How big the app is on a phone.
 *
 * Everything is sized in em from one number, and that number is twenty -
 * right across a room from a monitor, far too large held at arm's length.
 * Reported as the app looking zoomed into on a phone browser.
 */

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

/**
 * The block that sizes the app for a screen held in the hand.
 *
 * Found by what is in it rather than by being the first block with that
 * media query. More than one thing cares about a screen you hold — the
 * settings window stops fading there too, since nothing hovers on a touch
 * screen — and taking whichever came first in the file meant this test
 * silently began measuring somebody else's block.
 */
const PHONE = '@media (hover:none),(max-width:820px){'

function phoneBlock(): string {
  for (let at = css.indexOf(PHONE); at >= 0; at = css.indexOf(PHONE, at + 1)) {
    const block = css.slice(at, css.indexOf('\n}', at))
    if (block.includes('#app{font-size')) return block
  }
  throw new Error('the block that sizes the app on a phone is gone')
}

describe('the size on a phone', () => {
  it('follows the screen being held rather than the window being narrow', () => {
    /*
     * Neither test catches every phone alone: turned sideways a phone is
     * wider than the layout breakpoint and would go back to monitor-sized
     * type, and a narrow window on a desktop is still a monitor. Nothing here
     * is iOS or Android - both were oversized in the same way.
     */
    expect(css).toContain('@media (hover:none),(max-width:820px){')
  })

  it('is scaled from whatever size was chosen, not replaced with a fixed one', () => {
    /* Somebody who has set their own size still gets it, just smaller here. */
    const block = phoneBlock()
    expect(block).toContain('#app{font-size:calc(var(--fsz)*1px*var(--phonefs,.8))}')
  })

  it('and is set where the size is used, not where the variable is declared', () => {
    /*
     * The theme writes --fsz onto the document element. A property declared
     * on an element beats the same property inherited into it, so redeclaring
     * it in a stylesheet does nothing at all - the same trap that would kill
     * the panel drag. The scale goes on the rule instead.
     */
    expect(css).not.toMatch(/@media[^{]*\{[^}]*:root\s*\{[^}]*--fsz/)
  })
})

describe('what you type into', () => {
  it('is never small enough for Safari to zoom the page in', () => {
    /* It zooms in when a field under sixteen pixels takes the focus and does
       not zoom back out, which reads as the app breaking rather than as a
       font size. */
    expect(phoneBlock()).toContain('input,textarea,select{font-size:max(16px,1em)}')
  })
})
