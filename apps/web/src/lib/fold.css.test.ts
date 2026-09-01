import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The two buttons that fold the channel list away and bring it back.
 *
 * Both are positioned from the arrangement rather than from the window: the
 * list is second from the left until somebody drags it somewhere else, and
 * the first version of this put the way back at `left: 6px` - the far edge of
 * the screen, nowhere near the panel it belongs to, and pointing the wrong
 * way for any arrangement where the list folds right.
 *
 * Read out of the stylesheet because there is no browser here to lay a grid
 * out in, and because the failure this guards is a rule quietly going
 * missing rather than a number being wrong.
 */

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

/**
 * Every rule whose selector mentions this class, body included.
 *
 * Written as a scan rather than one expression because the stylesheet nests:
 * a rule inside `@media` has a `{` before it that no flat pattern pairs off
 * correctly, and the phone rules for these very buttons are inside one.
 */
function rulesFor(cls: string): string[] {
  const out: string[] = []
  const mentions = new RegExp(`\\.${cls}\\b`)
  let at = 0
  while (at < css.length) {
    const open = css.indexOf('{', at)
    if (open < 0) break
    const close = css.indexOf('}', open)
    if (close < 0) break
    const selector = css.slice(at, open).replace(/\/\*[\s\S]*?\*\//g, '').trim()
    /* An at-rule opens a block of rules rather than a block of declarations,
       so step inside it instead of over it. */
    if (selector.startsWith('@')) { at = open + 1; continue }
    const body = css.slice(open + 1, close)
    if (mentions.test(selector)) out.push(`${selector}{${body}`)
    at = close + 1
  }
  return out
}

describe('the class names are ours alone', () => {
  /*
   * Twice now a button has been given a class the app already used for
   * something else and simply disappeared - once `sw`, once `picker`, both of
   * them positioned somewhere off screen by the rule they collided with.
   * There is one stylesheet and nothing scopes a class to a component, so the
   * only thing that catches this is counting.
   */
  it('and nothing else in the app styles them', () => {
    for (const cls of ['sideopen', 'sideshut']) {
      const theirs = rulesFor(cls)
      expect(theirs.length, `${cls} has rules`).toBeGreaterThan(0)
      for (const rule of theirs) {
        expect(rule.slice(0, rule.indexOf('{')), `an unrelated rule claims .${cls}`)
          .toMatch(new RegExp(`\\.${cls}`))
      }
    }
  })
})

describe('the way back', () => {
  const open = rulesFor('sideopen').join('\n')

  it('is placed in a column by the arrangement, not by the stylesheet', () => {
    /* The column is set on the element from the order the panels are in, so
       a `grid-column` here would be a fixed neighbour again. */
    const base = rulesFor('sideopen').find((r) => r.startsWith('.sideopen{'))!
    expect(base).not.toContain('grid-column')
    expect(base, 'sits in the row the panels are in').toContain('grid-row:3')
  })

  it('and never off the edge of the window', () => {
    expect(open, 'positioned from the grid, not from the shell')
      .not.toMatch(/position:\s*absolute/)
    /* The inset property, not the `left` in `border-left`. */
    expect(open).not.toMatch(/[;{]\s*left:/)
  })

  it('hugs the panel on whichever side the list went', () => {
    expect(open).toContain('.sideopen[data-fold="left"]{')
    expect(open).toContain('.sideopen[data-fold="right"]{')
    expect(open).toMatch(/\[data-fold="left"\]\{[^}]*justify-self:start/)
    expect(open).toMatch(/\[data-fold="right"\]\{[^}]*justify-self:end/)
  })

  it('with the corners it needs and the flat edge against the panel', () => {
    expect(open).toMatch(/\[data-fold="left"\]\{[^}]*border-left:0/)
    expect(open).toMatch(/\[data-fold="right"\]\{[^}]*border-right:0/)
  })
})

describe('the arrows', () => {
  /*
   * There is one chevron, pointing right. Each button turns it for exactly
   * one of the two sides, and they turn it for opposite ones: the button that
   * folds points the way the panel goes, and the one that brings it back
   * points the way it comes.
   */
  it('point opposite ways for the same fold', () => {
    expect(css).toContain('.sideshut[data-fold="left"] svg{transform:rotate(180deg)}')
    expect(css).toContain('.sideopen[data-fold="right"] svg{transform:rotate(180deg)}')
  })

  it('and neither is turned unconditionally', () => {
    /* Which is what it was: `.sideshut svg{rotate(180deg)}`, correct only
       while the list was always on the left. */
    expect(css).not.toContain('.sideshut svg{')
    expect(css).not.toContain('.sideopen svg{')
  })
})

describe('the button that folds it', () => {
  it('sits in the corner of the banner, away from the server settings', () => {
    /* Reported as overlapping the settings button, which is the panel's own
       top right. This one is top left. */
    const shut = rulesFor('sideshut').find((r) => r.startsWith('.sideshut{'))!
    expect(shut).toContain('left:7px')
    expect(shut, 'the top right belongs to the server settings').not.toMatch(/\bright:/)
  })
})
