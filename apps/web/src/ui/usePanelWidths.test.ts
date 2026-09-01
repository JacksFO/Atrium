import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GRIPS } from './usePanelWidths'

/*
 * Nothing but the document may declare a width the drag writes.
 *
 * The drag sets these on the document, and a property declared on an element
 * beats the same property inherited into it. `#app{--sidew:278px}` was enough
 * to make every drag do nothing at all, silently, with the handle working and
 * the value being written the whole time. A media query that redeclares one
 * on anything but :root brings the same bug back at one window size only,
 * which is worse.
 */
describe('the widths are declared where they are written', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')
  const props = Object.values(GRIPS).flatMap(
    (g) => [g.prop, ...(g.scale ? [g.scale] : [])],
  )

  /* Every rule in the file, as selector plus body. */
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ sel: (m[1] ?? '').trim(), body: m[2] ?? '' }))

  it('finds the rules at all', () => {
    expect(rules.length).toBeGreaterThan(200)
    /* And really does see the declarations it is about to judge. */
    expect(rules.filter((r) => r.body.includes('--sidew:')).length)
      .toBeGreaterThan(0)
  })

  for (const prop of props) {
    it(`only :root declares ${prop}`, () => {
      const owners = rules
        .filter((r) => new RegExp(`(^|[;\s])${prop}\s*:`).test(r.body))
        .map((r) => r.sel.split('\n').pop()?.trim() ?? r.sel)
      for (const sel of owners) expect(sel).toBe(':root')
    })
  }
})
