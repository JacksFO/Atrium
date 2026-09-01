import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Rows inside a panel that scales itself.
 *
 * The conversations panel and the member panel size their contents from their
 * own width: dragging one wider raises its font size, and everything in it is
 * written in `em` so it follows. A row that states a size in pixels opts out
 * silently - it keeps the size it had while everything around it grows.
 *
 * That is what happened to Home and Friends. They were 14px and the heading
 * above them 10.5px, so widening the panel left two small rows sitting above
 * a list of large ones, and it read as them not scaling at all - which is
 * exactly what it was.
 */

/** A literal newline, built rather than written, so no tool between here and
    the file can eat the escape. */
const NEWLINE = String.fromCharCode(10)

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

/**
 * The declarations of a rule, found by its selector at the start of a line.
 *
 * By text rather than by a regular expression: the selectors here begin with
 * a dot, and escaping that through two layers to build a pattern is how this
 * check would come to match nothing and pass for ever.
 */
function ruleFor(selector: string): string {
  const at = css.indexOf(NEWLINE + selector + '{')
  expect(at, selector + ' is not in the stylesheet').toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

/* The rows that live inside a panel which scales. Not every class in the
   app - only the ones that sit in one of those two panes. */
const INSIDE_A_SCALING_PANEL = ['.nrow', '.sect', '.chan']

describe('a row in a panel that scales with its width', () => {
  it('is one of several, so this is not checking a single rule', () => {
    expect(INSIDE_A_SCALING_PANEL.length).toBeGreaterThan(2)
  })

  it('never states its text size in pixels', () => {
    const guilty = INSIDE_A_SCALING_PANEL.filter((sel) => /font-size:\s*[\d.]+px/.test(ruleFor(sel)))
    expect(guilty, `these opt out of the panel's scaling: ${guilty.join(', ')}`).toEqual([])
  })

  it('and the panels still say what they scale by', () => {
    /* Without these the rules above are em against nothing in particular and
       the whole mechanism is gone, which would pass the test above happily. */
    expect(css).toMatch(/\.sidepane\{--pscale:/)
    expect(css).toMatch(/\.mempane\{--pscale:/)
    expect(css).toMatch(/\.sidepane,\.mempane\{font-size:calc\(var\(--fsz\)\*1px\*var\(--pscale/)
  })
})
