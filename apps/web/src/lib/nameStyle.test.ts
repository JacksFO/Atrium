import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { User } from './wire'
import { DEFAULT_ACCENT, nameLook } from './nameStyle'

/* A person, with only the parts a name is drawn from. */
const who = (over: Partial<User> = {}) => ({
  accent: '', accent_2: '', name_font: 'default' as const,
  name_effect: 'none' as const, ...over,
})

describe('a name with nothing chosen', () => {
  it('carries no colour, no face and no class', () => {
    const look = nameLook(who())
    expect(look.className).toBe('')
    expect(Object.keys(look.style)).toHaveLength(0)
  })
})

describe('a colour', () => {
  it('is applied, and also handed to the effects to paint from', () => {
    const look = nameLook(who({ accent: '#FF7FC4' }))
    expect(look.style.color).toBe('#FF7FC4')
    expect((look.style as Record<string, string>)['--name-colour']).toBe('#FF7FC4')
  })

  /* The server checks this too; this is the half that stops a bad row in the
     database reaching the page as an invalid declaration. */
  it('is refused unless it is a real hex value', () => {
    expect(nameLook(who({ accent: 'red' })).style.color).toBeUndefined()
    expect(nameLook(who({ accent: '#fff' })).style.color).toBeUndefined()
    expect(nameLook(who({ accent: 'javascript:alert(1)' })).style.color).toBeUndefined()
  })
})

describe('an effect', () => {
  it('becomes the class the stylesheet knows', () => {
    expect(nameLook(who({ name_effect: 'shimmer' })).className).toBe('fx-shimmer')
  })

  /* Three of them fill the letters themselves and need the text transparent.
     An inline colour beats the class that does that, and then all three
     render as flat colour and look identical to no effect at all. */
  it('that fills its own letters gets the colour as a property, not as color', () => {
    for (const fx of ['gradient', 'shimmer', 'outline'] as const) {
      const look = nameLook(who({ accent: '#FF7FC4', name_effect: fx }))
      expect(look.style.color).toBeUndefined()
      expect((look.style as Record<string, string>)['--name-colour']).toBe('#FF7FC4')
    }
  })

  it('while a glow, which does not, keeps the colour directly', () => {
    const look = nameLook(who({ accent: '#FF7FC4', name_effect: 'glow' }))
    expect(look.style.color).toBe('#FF7FC4')
  })

  /* Squeezing the three choices into one preset kept whichever won, so a pink
     gradient arrived as a gradient with no pink in it — and a gradient with no
     colour to paint from is transparent letters over nothing. */
  it('and a colour are worn together, not one instead of the other', () => {
    const look = nameLook(who({ accent: '#FF7FC4', name_effect: 'gradient' }))
    expect(look.className).toBe('fx-gradient')
    expect((look.style as Record<string, string>)['--name-colour']).toBe('#FF7FC4')
  })

  it('takes a second colour when one was chosen', () => {
    const look = nameLook(who({ accent: '#FF7FC4', accent_2: '#3FE0E8', name_effect: 'gradient' }))
    expect((look.style as Record<string, string>)['--name-colour-2']).toBe('#3FE0E8')
  })
})

describe('a typeface', () => {
  it('is applied with the tweaks that face needs', () => {
    const look = nameLook(who({ name_font: 'display' }))
    expect(look.style.fontFamily).toContain('Bricolage')
    expect(look.style.fontVariationSettings).toBe("'wdth' 92")
  })

  it('and the default one is left alone entirely', () => {
    expect(nameLook(who({ name_font: 'default' })).style.fontFamily).toBeUndefined()
  })

  it('is worn together with a colour', () => {
    const look = nameLook(who({ name_font: 'serif', accent: '#5BD98A' }))
    expect(look.style.fontStyle).toBe('italic')
    expect(look.style.color).toBe('#5BD98A')
  })
})

/**
 * A role's colour is what the effects paint from, when there is no other.
 *
 * This is the half that was missing, and it is invisible when wrong: a
 * gradient on somebody whose only colour comes from a role became a gradient
 * from var(--fg) to var(--fg) — transparent letters over the text colour,
 * which looks exactly like no effect at all. So every effect appeared broken
 * for everybody who had never opened the colour picker, which is most people.
 */
describe('where the colour comes from', () => {
  const gradient = { accent: '', accent_2: '', name_font: 'default', name_effect: 'gradient' }

  it('is the role, when nobody has chosen one', () => {
    const look = nameLook(gradient as never, '#FF0000')
    expect(look.style['--name-colour' as never]).toBe('#FF0000')
    expect(look.className).toBe('fx-gradient')
  })

  /* Theirs wins over the role's, because they chose it. */
  it('and their own when they have', () => {
    const look = nameLook({ ...gradient, accent: '#00FF00' } as never, '#FF0000')
    expect(look.style['--name-colour' as never]).toBe('#00FF00')
  })

  /*
   * The default accent is not a choice: it is what everybody starts with, and
   * letting it win takes the role colour away from every account that has
   * never opened the picker.
   */
  it('and the one everybody starts with does not count as choosing', () => {
    const look = nameLook({ ...gradient, accent: DEFAULT_ACCENT } as never, '#FF0000')
    expect(look.style['--name-colour' as never]).toBe('#FF0000')
  })

  /* And with neither, there is nothing to paint from and the stylesheet's own
     fallback takes over. */
  it('and nothing at all when there is neither', () => {
    const look = nameLook(gradient as never)
    expect(look.style['--name-colour' as never]).toBeUndefined()
  })

  /* An effect that fills the letters must not also be given a flat colour:
     an inline colour beats the class that makes the text transparent, and
     then all three render flat and look identical to no effect. */
  it('and an effect that fills its own letters is never given a flat colour', () => {
    for (const effect of ['gradient', 'shimmer', 'outline']) {
      const look = nameLook({ ...gradient, name_effect: effect, accent: '#00FF00' } as never)
      expect(look.style.color, effect).toBeUndefined()
    }
    /* Glow keeps its letters, so it does get one. */
    const glow = nameLook({ ...gradient, name_effect: 'glow', accent: '#00FF00' } as never)
    expect(glow.style.color).toBe('#00FF00')
  })
})

/**
 * The shimmer, in step with itself.
 *
 * A CSS animation begins when its element does, so the same name in the bar
 * at the bottom, in a message and in the member list started sweeping at
 * three different moments and stayed that far apart. Reported as the effects
 * being out of sync with each other.
 *
 * Worth being clear about what this is and is not: it makes them agree, and
 * it does not make them cheaper. There is no sharing one animation between
 * elements - eight names on screen is eight animations either way.
 */
describe('the sweep across a name', () => {
  const shimmering = () => nameLook(who({ name_effect: 'shimmer', accent: '#FF7FC4' }))

  it('is offset onto the clock rather than onto its element', () => {
    const look = shimmering()
    expect(look.className).toContain('fx-shimmer')
    expect(look.style.animationDelay, 'a negative delay, so it starts part-way through')
      .toMatch(/^-\d+(\.\d+)?s$/)
  })

  /*
   * The offset is the same for two names asked for at the same moment, which
   * is the whole point - and it is within one loop, or it would be asking the
   * animation to have started days ago.
   */
  it('and two of them drawn together agree', () => {
    const a = shimmering()
    const b = shimmering()
    expect(a.style.animationDelay).toBe(b.style.animationDelay)
    const seconds = Number(String(a.style.animationDelay).replace(/[-s]/g, ''))
    expect(seconds).toBeGreaterThanOrEqual(0)
    expect(seconds, 'inside one eight second loop').toBeLessThan(8)
  })

  /*
   * And the loop it is taken modulo is the loop the stylesheet actually runs.
   *
   * These are two numbers in two files that have to be the same one. Change
   * the sweep to six seconds in the CSS and the offset here still divides by
   * eight, so every name lands at a different point and the thing this exists
   * to fix comes back - with nothing failing to say so.
   */
  it('and the loop it divides by is the one the stylesheet uses', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')
    const at = css.indexOf('.fx-shimmer{')
    expect(at, '.fx-shimmer is still in the stylesheet').toBeGreaterThan(-1)
    const rule = css.slice(at, css.indexOf('}', at))
    const secs = /animation:\s*name-shimmer\s+(\d+(?:\.\d+)?)s/.exec(rule)
    expect(secs, 'the sweep still has a duration in seconds').toBeTruthy()
    /* Read back from the delay rather than from an exported constant, so this
       checks what a name is actually given. */
    const look = nameLook(who({ name_effect: 'shimmer' }))
    const used = Number(String(look.style.animationDelay).replace(/[-s]/g, ''))
    expect(used).toBeLessThan(Number(secs![1]))
    expect(Number(secs![1])).toBe(8)
  })

  /* And nothing else carries it: a name with no effect has no animation to
     offset, and one that does not move would be given a delay for nothing. */
  it('while the effects that do not move get none', () => {
    for (const effect of ['none', 'glow', 'gradient', 'outline'] as const) {
      const look = nameLook(who({ name_effect: effect, accent: '#FF7FC4' }))
      expect(look.style.animationDelay, effect).toBeUndefined()
    }
  })
})
