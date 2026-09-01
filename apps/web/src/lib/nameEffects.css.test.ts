import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The effects that paint letters from a background.
 *
 * Three of the four fill the letters by clipping a background to their shape,
 * and that clip only finds text the element holds DIRECTLY. A flex or grid
 * container moves a bare run of text into an anonymous item, and a <button>
 * — which is what a name in the message list is, so it can be clicked — wraps
 * its contents the same way. Either one drops the effect silently: no error,
 * no warning, just a flat name that reads as no effect at all.
 *
 * It surfaced as "some people's names are animated and some aren't", and the
 * split ran by EFFECT rather than by person: shimmer showed, gradient did
 * not. Shimmer was not working, it was getting away with it — animating the
 * background position puts it on a paint path that finds the letters. So the
 * one that appeared to work was the least trustworthy thing in the room, and
 * a static effect is the honest test of whether this is right.
 */

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

/** The declarations of one rule, by its exact selector. */
function ruleFor(selector: string): string {
  const at = css.indexOf(`${selector}{`)
  if (at < 0) return ''
  return css.slice(at + selector.length + 1, css.indexOf('}', at))
}

const CLIPS_TO_TEXT = ['.fx-gradient', '.fx-shimmer', '.fx-outline']

describe('names that paint from a background', () => {
  it('are the ones this is about', () => {
    /* Or the whole file below is checking rules that are not there. */
    for (const c of CLIPS_TO_TEXT) expect(css).toContain(c)
    expect(ruleFor('.fx-gradient')).toContain('background-clip:text')
  })

  it('sit on a box that holds its own text', () => {
    const shared = ruleFor(CLIPS_TO_TEXT.join(','))
    expect(shared).toContain('display:inline-block')
  })

  /* The member row is where it was found. It holds a name and nothing else,
     so it never needed to be a flex box — and being one hid every static
     effect worn by anybody in the list. */
  it('and the member row is not a flex box', () => {
    const row = ruleFor('.mrow .n')
    expect(row).not.toContain('display:flex')
    expect(row).toContain('display:inline-block')
  })

  /* The same rule asks for an ellipsis, which a flex container also ignores,
     so the two faults had one cause and one fix. */
  it('and can still cut a long name short', () => {
    const row = ruleFor('.mrow .n')
    expect(row).toContain('text-overflow:ellipsis')
    expect(row).toContain('overflow:hidden')
  })

  /* Glow is a shadow rather than a clip, so it works anywhere and must not be
     dragged into the same rule — an inline-block would change its layout for
     no reason. */
  it('but glow, which clips nothing, is left alone', () => {
    expect(ruleFor('.fx-glow')).toContain('text-shadow')
    expect(CLIPS_TO_TEXT).not.toContain('.fx-glow')
  })
})
