import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Where a control is the box around the input rather than the input.
 *
 * Two places draw a pill with something typed inside it, and the pill is what
 * says it has focus - it changes border and background through
 * `:focus-within`. The input inside is meant to be invisible: no border, no
 * background of its own.
 *
 * The browser draws a focus ring anyway, and it draws it on the *input*. In a
 * dark card that is a white rounded rectangle sitting inside a styled pill,
 * which reads as an unstyled box somebody forgot about - reported exactly that
 * way, of the message box on a profile. The composer had suppressed it since
 * it was written and the profile box never had.
 *
 * So this is a rule rather than a check of one selector: anything that says it
 * has focus on behalf of what is inside it has to take the inner ring off, or
 * the two indicators fight and the browser's wins on looks.
 */

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

/** The class on every `X:focus-within` rule, as its own selector. */
function wrappersShowingFocus(): string[] {
  return [...new Set(
    [...css.matchAll(/^\.([a-z0-9-]+):focus-within\s*\{/gim)].map((m) => m[1] as string),
  )]
}

/** The declarations of `.X input`, or null where there is no such rule. */
function ruleFor(wrapper: string): string | null {
  const at = css.search(new RegExp(`^\.${wrapper} input[^:{]*\{`, 'im'))
  if (at < 0) return null
  return css.slice(at, css.indexOf('}', at))
}

describe('a pill that carries the focus for what is typed in it', () => {
  it('is a pattern this stylesheet actually uses', () => {
    /* Otherwise the rule below passes by having nothing to check. */
    expect(wrappersShowingFocus().length).toBeGreaterThan(0)
  })

  it('takes the browser ring off the input inside it', () => {
    const guilty = wrappersShowingFocus()
      .filter((w) => {
        const rule = ruleFor(w)
        /* A wrapper with no input inside is not this pattern - the row of
           buttons that lights up when tabbed into, for instance. */
        return rule !== null && !/outline\s*:\s*none/.test(rule)
      })

    expect(guilty, `these show focus themselves but leave the inner ring on: ${guilty.join(', ')}`)
      .toEqual([])
  })

  it('and the message box on a profile is one of them', () => {
    /* Named because it is the one that was reported, so a rewrite that drops
       the pill entirely fails here rather than quietly passing above. */
    expect(wrappersShowingFocus()).toContain('saybox')
    expect(ruleFor('saybox')).toMatch(/outline\s*:\s*none/)
  })
})
