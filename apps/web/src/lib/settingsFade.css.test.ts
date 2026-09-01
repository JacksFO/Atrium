import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The settings window is faded until you want it.
 *
 * It sits over the app, and most of the time you are looking at settings you
 * are checking something against what is behind them. So it is half there
 * while the pointer is elsewhere and solid the moment the pointer is on it.
 *
 * Three ways that goes wrong, and all three are silent — the window simply
 * looks broken rather than throwing anything:
 *
 *  - fading the window without lifting the dimming behind it shows more of
 *    the backdrop rather than more of the app, which is the opposite of the
 *    point;
 *  - fading on hover alone leaves somebody typing in the search box, with the
 *    pointer parked elsewhere, watching the thing they are typing into fade;
 *  - a touch screen never hovers, so the window would stay at half for ever
 *    with no way to bring it back.
 */

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

/** The one rule that decides how solid the window is. */
function windowRule(): string {
  const at = css.indexOf('.settings.setwin{')
  expect(at, 'the settings window rule is still there').toBeGreaterThan(0)
  return css.slice(at, css.indexOf('\n.', css.indexOf('opacity:var(--setfade', at)))
}

/** The number on a rule, found by the selector that carries it. */
function layer(selector: string, from = 0): number {
  const at = css.indexOf(selector, from)
  expect(at, `${selector} is still there`).toBeGreaterThan(0)
  const found = /z-index:(\d+)/.exec(css.slice(at, at + 260))
  expect(found, `${selector} still sets a z-index`).not.toBeNull()
  return Number(found![1])
}

describe('where the settings window sits on a phone', () => {
  /*
   * The way into settings is your own name at the bottom of the channel
   * drawer. On a phone that drawer is fixed above the conversation, and the
   * settings window was underneath it - so opening settings appeared to do
   * nothing at all, and swiping the drawer shut revealed a window that had
   * been open the whole time.
   *
   * Asked as a comparison rather than for a particular number, because the
   * bug is the order and not the value.
   */
  it('is above the drawer it was opened from', () => {
    const phone = css.indexOf('@media (max-width:820px){')
    const drawer = layer('.shell>.rail,.shell>.sidepane{', phone)
    const settings = layer('.setscrim{z-index', phone)
    expect(settings).toBeGreaterThan(drawer)
  })

  /* And still under the things that belong on top of it: a dialog opened
     from settings, and a message about something that just happened. */
  it('and below the dialogs and messages that go over it', () => {
    const phone = css.indexOf('@media (max-width:820px){')
    const settings = layer('.setscrim{z-index', phone)
    expect(settings).toBeLessThan(layer('.modal.over{'))
    expect(settings).toBeLessThan(layer('.toasts{'))
  })
})

describe('the dimming behind it', () => {
  /*
   * The scrim starts below the title bar so the window controls in that strip
   * keep working. The dimming stopped there as well, which drew a hard line
   * across the app - dark below, bright above - through whatever sat at the
   * top. Reported from a screenshot: "a line across the top that cuts through
   * things".
   */
  it('reaches the top of the window', () => {
    expect(css).toContain('.setscrim::before')
    const at = css.indexOf('.setscrim::before')
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule, 'it has to cover the strip above the scrim').toContain('bottom:100%')
    expect(rule, 'and be exactly as tall as that strip').toContain('height:var(--topbar-h)')
  })

  /* And takes nothing. That strip is the drag region and the minimise,
     maximise and close buttons; a scrim over them is a window that cannot
     be moved or closed. */
  it('without taking the clicks that belong to the window buttons', () => {
    const at = css.indexOf('.setscrim::before')
    expect(css.slice(at, css.indexOf('}', at))).toContain('pointer-events:none')
  })

  /* Both halves fade together, or the line comes back on hover. */
  it('and fades with the rest of it', () => {
    const at = css.indexOf('.setscrim::before')
    expect(css.slice(at, css.indexOf('}', at))).toContain('var(--setdim')
  })

  /* Asked for plainly, after seeing it: the app behind stays as it is. */
  it('and does not blur what is behind it', () => {
    const at = css.indexOf('.setscrim{')
    expect(css.slice(at, css.indexOf('}', at))).not.toContain('backdrop-filter')
  })
})

describe('the settings window', () => {
  it('is not fully solid to begin with', () => {
    expect(windowRule()).toContain('opacity:var(--setfade,.5)')
  })

  it('and goes solid under the pointer', () => {
    expect(css).toContain('.settings.setwin:hover,.settings.setwin:focus-within{--setfade:1}')
  })

  /* Hover alone is not enough. Somebody typing into the search box with the
     pointer somewhere else is still using the window. */
  it('and while anything in it has the keyboard', () => {
    const rule = css.slice(css.indexOf('.settings.setwin:hover'))
    expect(rule.slice(0, rule.indexOf('}'))).toContain(':focus-within')
  })

  it('and lifts the dimming behind it at the same time', () => {
    /* Or fading the window only reveals more backdrop, never more app. */
    expect(css).toContain('.setscrim:has(.setwin:hover),.setscrim:has(.setwin:focus-within){--setdim:58%}')
    expect(css).toContain('var(--setdim,20%)')
  })

  it('and never fades where nothing can hover', () => {
    const at = css.indexOf('@media (hover:none),(max-width:820px){\n  .settings.setwin{--setfade:1}')
    expect(at, 'a touch screen would be stuck at half for ever').toBeGreaterThan(0)
  })

  /* Somebody who asked for less movement gets the state, not the fade to it. */
  it('and does not animate for somebody who asked it not to', () => {
    const at = css.indexOf('@media (prefers-reduced-motion:reduce){\n  .settings.setwin{')
    expect(at, 'the reduced-motion block is still there').toBeGreaterThan(0)
    const block = css.slice(at, css.indexOf('\n}', at))
    expect(block).toContain('transition:none')
  })
})
