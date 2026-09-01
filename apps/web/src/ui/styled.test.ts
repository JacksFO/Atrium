import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every class the app draws is a class the stylesheet knows about.
 *
 * A class name is not checked by anything — not the compiler, not a test that
 * renders markup and looks for it. So a renamed rule, or a class invented
 * while writing a component and never styled, leaves an element with no
 * layout at all: it does not throw, it does not warn, it just sits there
 * looking like a mistake nobody made on purpose.
 *
 * That is how the channel list ended up unable to scroll — its container was
 * named for what it held rather than for the rule that styled it, so a server
 * with more channels than fit simply lost the ones past the bottom.
 */

const UI = join(__dirname)
const css = readFileSync(join(__dirname, '..', 'app.css'), 'utf8')

/**
 * Classes that exist to be found rather than to be styled.
 *
 * Named one at a time and with a reason. A blanket exception would let the
 * next unstyled class in as well, which is the thing this is for.
 */
const MARKERS = new Set([
  /* Roles and shared servers are different things drawn the same way, and one
     class for both made an assertion about either of them ambiguous. */
  'pshared',
])

/** Every class named in a plain className="..." across the UI. */
function classesInUse(): Map<string, string> {
  const out = new Map<string, string>()
  for (const file of readdirSync(UI).filter((f) => f.endsWith('.tsx'))) {
    const src = readFileSync(join(UI, file), 'utf8')
    /* Plain strings only — a template literal holds an expression, and
       picking class names out of one is guesswork this should not be doing. */
    for (const m of src.matchAll(/className="([a-z0-9 -]+)"/g)) {
      for (const c of (m[1] ?? '').split(' ')) {
        if (c && !out.has(c)) out.set(c, file)
      }
    }
    /* The static half of a template literal is still a plain class:
       `nm ${look}` names `nm`, whatever the expression turns out to be. */
    for (const m of src.matchAll(/className=\{`([a-z0-9 -]+)/g)) {
      for (const c of (m[1] ?? '').split(' ')) {
        if (c && !out.has(c)) out.set(c, file)
      }
    }
  }
  return out
}

describe('the stylesheet and the markup', () => {
  it('agree about every class', () => {
    const missing: string[] = []
    for (const [c, file] of classesInUse()) {
      if (MARKERS.has(c)) continue
      /*
       * String.raw, because this is a regular expression written inside a
       * template literal.
       *
       * `\.` was read by the template as an escaped dot and handed to the
       * regex as a bare one, which matches any character; `\s` became a
       * literal "s". So the test asked for "any character, the class name,
       * then one of s{.,:>+~)" - which passes a class styled as `.foo{` and
       * fails one styled as `.foo .bar{`, because a space was not in the set
       * it thought it had written. Two classes with rules were reported as
       * having none.
       */
      const styled = new RegExp(String.raw`\.${c}[\s{.,:>+~)]`)
      if (!styled.test(css)) missing.push(`${c} (${file})`)
    }
    expect(missing).toEqual([])
  })

  /* The check is only worth having if it can fail. */
  it('and would say so if they did not', () => {
    expect(/\.notaclassanywhere[\s{.,:>+~)]/.test(css)).toBe(false)
  })
})
