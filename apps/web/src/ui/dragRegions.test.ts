import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What the window manager takes, and what the page keeps.
 *
 * The desktop app draws its own chrome, so one strip across the top is the
 * window's drag region. A drag region hands every press inside it to the
 * window manager before the page sees it - which is right for the strip and
 * ruinous for anything drawn over it.
 *
 * Both halves of that have been reported. First the strip itself could not
 * drag the window, because the element filling it was marked no-drag. Then
 * the update banner sat at 14px from the top, inside a 40px drag strip, so
 * the top of the Reload button did nothing and the bottom sliver worked -
 * "finicky, have to hit it in certain spots".
 */

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

/** The declarations of one rule, by its exact selector. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector}{`)
  if (at < 0) return ''
  return css.slice(at + selector.length + 1, css.indexOf('}', at))
}

describe('drag regions', () => {
  /* The one that is meant to be one. */
  it('are the top bar', () => {
    expect(rule('.topbar')).toContain('-webkit-app-region:drag')
  })

  /*
   * And nothing else by default. The property inherits, so a baseline means
   * anything drawn over the strip stays clickable without having to know it
   * is over the strip.
   */
  it('and nothing else, unless it asks', () => {
    expect(rule('#app')).toContain('-webkit-app-region:no-drag')
  })

  /* Belt and braces for the strip that goes closest to it. */
  it('and the banners across the top are clickable', () => {
    expect(rule('.notices')).toContain('-webkit-app-region:no-drag')
  })

  /*
   * They start below the bar as well. Overlapping it and relying on no-drag
   * works, but a banner that begins inside the window's own chrome looks
   * like a mistake even when it behaves.
   *
   * Said as a place in the layout rather than as a distance from the top.
   * The strip used to float, offset by the bar's height, which is a sum that
   * has to be kept in step - and while it floated it covered whatever was
   * beneath it. It sits in the shell's second row now, and the bar is the
   * first, so it is below the bar by construction and there is no offset to
   * get wrong.
   */
  it('and start below the bar rather than inside it', () => {
    expect(rule('.bars')).toContain('grid-row:2')
    expect(rule('.topbar')).toContain('grid-row:1')
  })

  /*
   * The bar's own contents must not carve a hole in it: the inner element
   * fills the bar, so a no-drag there is a no-drag on all of it, and the
   * window cannot be moved at all.
   */
  it('but the bar itself is not cancelled from inside', () => {
    const bar = readFileSync(resolve(process.cwd(), 'src/ui/TopBar.tsx'), 'utf8')
    const code = bar.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toContain('no-drag')
  })
})
