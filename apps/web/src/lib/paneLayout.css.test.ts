import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Layout inside a pane somebody can resize.
 *
 * The columns of the home page were chosen by `@media (min-width: …)`, which
 * asks the window. The pane it lays out is a column of a grid whose widths
 * are dragged: pulling the conversations list wider takes room away from Home
 * without the window changing by a pixel, so the breakpoint never fired and a
 * two-column layout with a 420px minimum stayed inside a space too narrow for
 * it. Reported as Home and Friends not scaling when the panel is resized.
 *
 * A container query asks the thing that actually changes. This is a rule
 * rather than a check of one selector, because the next layout put inside a
 * pane will be written the same way the last one was.
 */

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

/** The blocks a rule sits inside, innermost last. */
function blocksAround(selector: string): string[] {
  const at = css.indexOf(selector)
  expect(at, `${selector} is not in the stylesheet`).toBeGreaterThan(0)

  const before = css.slice(0, at)
  const opened: string[] = []
  const query = /@(media|container|supports)[^{]*\{|\{|\}/g
  let m: RegExpExecArray | null
  while ((m = query.exec(before))) {
    if (m[0] === '}') opened.pop()
    else opened.push(m[0])
  }
  return opened
}

describe('what decides the layout inside a resizable pane', () => {
  it('is the pane, for the home page columns', () => {
    const holding = blocksAround('.homecols{grid-template-columns:minmax(0,1fr) minmax(420px')
    const queries = holding.filter((b) => b.startsWith('@'))
    expect(queries.some((q) => q.startsWith('@container'))).toBe(true)
    expect(queries.some((q) => q.startsWith('@media'))).toBe(false)
  })

  it('and for whether the side column is there at all', () => {
    const holding = blocksAround('.homeside{display:none}')
    const queries = holding.filter((b) => b.startsWith('@'))
    expect(queries.some((q) => q.startsWith('@container'))).toBe(true)
  })

  it('which needs the pane to be declared as one', () => {
    /* Without this the queries above match nothing and quietly do nothing,
       which looks exactly like the bug they were written to fix. */
    expect(css).toMatch(/\.chatpane\{[^}]*container-type:\s*inline-size/)
  })
})
