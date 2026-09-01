import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The colours every theme is built from.
 *
 * All of them come out of seven numbers through calc(), which is powerful and
 * silent: a calc that does not parse makes the custom property invalid, an
 * invalid property makes whatever uses it draw nothing, and nothing anywhere
 * says so. --acc2 was written that way and had never once rendered - the ring
 * round somebody speaking, the dot on a voice avatar and the sign-in gradient
 * were all painting with a colour that did not exist.
 *
 * It was found by rendering the tokens as swatches and seeing one come out
 * black. This is that check, made cheap.
 */

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

/** Every calc() in the file, with its parens balanced. */
function calcs(code: string): Array<{ line: number; body: string }> {
  const out: Array<{ line: number; body: string }> = []
  for (let i = code.indexOf('calc('); i !== -1; i = code.indexOf('calc(', i + 1)) {
    let depth = 0
    let j = i + 4
    for (; j < code.length; j++) {
      if (code[j] === '(') depth += 1
      else if (code[j] === ')') { depth -= 1; if (depth === 0) break }
    }
    out.push({ line: code.slice(0, i).split(String.fromCharCode(10)).length, body: code.slice(i + 5, j) })
  }
  return out
}

describe('the theme tokens', () => {
  it('are built from the theme numbers', () => {
    /* Or the file has been restructured and everything below is vacuous. */
    expect(css).toContain('--acc:oklch(')
    expect(css).toContain('--acc2:oklch(')
    expect(css).toContain('var(--tint)')
  })

  /*
   * calc() requires whitespace either side of + and -. Without it the whole
   * declaration is dropped, and because a bad custom property fails where it
   * is USED rather than where it is declared, nothing reports it.
   */
  it('have no calc with an unspaced + or -', () => {
    /* Comments first: this file's own explanation contains an example of the
       fault, and a scanner that reads its own prose finds it. */
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const found = calcs(code)
    /* Balanced parens matter: a calc can hold a var with a fallback, and
       stopping at the first ) reads half an expression - which is exactly why
       the first version of this scan missed the one real fault. */
    expect(found.length).toBeGreaterThan(20)

    const bad = found
      /* A hyphen inside a property name is not an operator. */
      .map((b) => ({
        line: b.line,
        body: b.body.replace(/var\(\s*--[\w-]+/g, 'V').replace(/--[\w-]+/g, 'V'),
      }))
      /* An operator needs something on its left, so a leading -1 is a sign. */
      .filter((b) => /[\w).%][+-][\w(.]/.test(b.body))
      .map((b) => `line ${b.line}: calc(${b.body})`)

    expect(bad, bad.join('; ')).toEqual([])
  })

  /* Two accents, and the second genuinely a different hue - the pair is what
     the build before this one used, and what the gradients expect. */
  it('and a second accent offset from the first', () => {
    expect(css).toContain('calc(var(--h) + 46)')
  })

  /*
   * The ambient field behind the glass.
   *
   * Panels are translucent, so with nothing behind them the blur pays for
   * nothing and every theme resolves to the same near-black. That field is
   * what the build before the port was recognised by.
   */
  it('and an ambient field for the panels to sit on', () => {
    const app = css.slice(css.indexOf('#app{'), css.indexOf('font-size:calc(var(--fsz)'))
    expect(app.match(/radial-gradient/g)).toHaveLength(4)
    expect(app).toContain('var(--bg)')
  })

  /* Glass that lets almost nothing through is not glass. The build before
     this one used .6; anything near 1 puts the field back out of sight. */
  it('and panels translucent enough to show it', () => {
    const dark = css.slice(css.indexOf("[data-mode='dark']"))
    const pa = dark.slice(0, dark.indexOf('}')).match(/--pa:([\d.]+)/)
    expect(pa).not.toBeNull()
    expect(Number(pa![1])).toBeLessThan(0.7)
  })
})

/**
 * One definition each.
 *
 * This stylesheet is edited by script often enough that a whole section was
 * appended twice: the newer copy came first, the stale one came last, and the
 * stale one won. The visible result was release notes that still clipped and
 * scrolled after being changed not to, which reads as the change not working
 * rather than as being overridden four hundred lines later.
 *
 * Not every duplicate is a fault - a rule deliberately restated under a media
 * query is normal - so this checks the ones that are single blocks by design,
 * outside any @media.
 */
describe('the stylesheet itself', () => {
  /* Top-level only: a rule inside @media is indented, and restating one there
     is the point of having media queries. */
  const topLevel = (selector: string): number =>
    css.split('\n').filter((line) => line.startsWith(`${selector}{`)).length

  for (const selector of [
    '.wnw-b', '.wnw-since', '.wnw-rels', '.wnw-head', '.whatsnew-wide',
    '.away-rows', '.notice', '.scale',
    /* #app is deliberately defined twice - once for layout and the ambient
       field, once to turn off text selection - so it is not in this list. Two
       rules adding different properties to one element is ordinary CSS; two
       copies of the same block is the fault. */
  ]) {
    it(`defines ${selector} once`, () => {
      const n = topLevel(selector)
      expect(n, `${selector} is defined ${n} times at the top level`).toBe(1)
    })
  }

  /* The whole reason the releases fold: an open one shows all of itself. A
     leftover height cap put the clipping straight back. */
  it('and nothing caps the height of an open release', () => {
    const at = css.indexOf('.wnw-b{')
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).not.toContain('max-height')
    expect(css).not.toContain('.whatsnew-wide .wnw-b{max-height')
  })
})
