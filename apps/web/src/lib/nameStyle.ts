import type { CSSProperties } from 'react'
import type { NameEffect, NameFont, User } from './wire'

/**
 * How somebody chose to have their name drawn.
 *
 * Three separate choices — a colour, a typeface and an effect — which people
 * combine. Squeezing them into one preset kept whichever won, so a pink
 * gradient arrived as a gradient with no pink in it, and a gradient with no
 * colour to paint from is transparent letters over nothing: not a plain name,
 * no name at all.
 *
 * In React this becomes a style object and a class name, which is the shape
 * the renderer wants. The old client built an HTML attribute string by hand,
 * and getting the quoting wrong there is an injection rather than a typo.
 */

/** The colours on offer. Chosen rather than free: a picker lets somebody make
 *  their own name unreadable, and on a dark ground most of the wheel is. */
export const NAME_COLOURS = [
  { id: 'default', hex: '', name: 'Default' },
  { id: 'red', hex: '#FF6B6B', name: 'Red' },
  { id: 'orange', hex: '#FF9F45', name: 'Orange' },
  { id: 'gold', hex: '#E8B45C', name: 'Gold' },
  { id: 'lime', hex: '#B6E36A', name: 'Lime' },
  { id: 'green', hex: '#5BD98A', name: 'Green' },
  { id: 'teal', hex: '#3FD9C8', name: 'Teal' },
  { id: 'cyan', hex: '#5CD8F0', name: 'Cyan' },
  { id: 'blue', hex: '#6FA8FF', name: 'Blue' },
  { id: 'indigo', hex: '#9B8CFF', name: 'Indigo' },
  { id: 'pink', hex: '#FF7FC4', name: 'Pink' },
  { id: 'silver', hex: '#C4CDD6', name: 'Silver' },
] as const

export const NAME_FONTS: Record<Exclude<NameFont, 'default'>, string> = {
  display: "'Bricolage Grotesque',sans-serif",
  serif: 'Georgia,serif',
  mono: "'JetBrains Mono',monospace",
  system: 'system-ui,-apple-system,sans-serif',
}

/**
 * The three effects that fill the letters themselves.
 *
 * For these the colour is handed over as a custom property and never set as
 * `color`: an inline colour beats the class that makes the text transparent,
 * and then all three render as flat colour and look identical to no effect.
 */
const PAINTS_ITS_OWN_TEXT = new Set<NameEffect>(['gradient', 'shimmer', 'outline'])

/** Only a real hex value is ever drawn with — the server checks this too, and
 *  this is the half that stops a bad row reaching the page. */
/** What everybody starts with, which is not a choice anybody made. */
export const DEFAULT_ACCENT = '#3FE0E8'

/** How long the shimmer takes to cross a name, matching app.css. */
const SHIMMER_SECONDS = 8

const hex6 = (v: string | undefined): string =>
  /^#[0-9a-f]{6}$/i.test(v ?? '') ? (v as string) : ''

export type NameLook = {
  /* Both are React's own shapes, so the renderer escapes them. */
  style: CSSProperties
  className: string
}

/**
 * What a name should look like.
 *
 * The custom properties are set whether or not the colour is also applied
 * directly, because the effects paint from them. Every fallback in the
 * stylesheet ends at a colour that always exists, so the worst case is a
 * plain name rather than an invisible one.
 */
export function nameLook(
  u: Pick<User, 'accent' | 'accent_2' | 'name_font' | 'name_effect'>,
  /**
   * The colour their highest coloured role gives them, if any.
   *
   * A fallback for the personal one, and — the part that was missing — the
   * thing the effects paint FROM when there is no personal one. Without it a
   * gradient on somebody who has only a role colour is a gradient from
   * var(--fg) to var(--fg): transparent letters over a colour that is already
   * the text colour, which looks exactly like no effect at all.
   */
  roleColour?: string,
): NameLook {
  /* Theirs wins over the role's, because they chose it. The default accent
     does not count as a choice: it is what everybody starts with, and letting
     it win would take the role colour away from every account that has never
     opened the picker. */
  const own = hex6(u.accent)
  const colour = own && own.toUpperCase() !== DEFAULT_ACCENT
    ? own
    : hex6(roleColour) || own
  const second = hex6(u.accent_2)
  const effect: NameEffect = u.name_effect ?? 'none'
  const font: NameFont = u.name_font ?? 'default'

  const style: CSSProperties & Record<string, string | undefined> = {}
  if (colour) style['--name-colour'] = colour
  if (second) style['--name-colour-2'] = second

  if (font !== 'default') {
    style.fontFamily = NAME_FONTS[font]
    if (font === 'display') {
      style.fontVariationSettings = "'wdth' 92"
      style.letterSpacing = '-.02em'
    }
    if (font === 'serif') style.fontStyle = 'italic'
    if (font === 'mono') {
      style.fontSize = '.92em'
      style.letterSpacing = '-.02em'
    }
  }

  /* Set directly only where the effect does not fill the letters itself. */
  if (colour && !PAINTS_ITS_OWN_TEXT.has(effect)) style.color = colour

  /*
   * The one effect that moves, put on the clock rather than on its element.
   *
   * A CSS animation starts when its element starts animating, so the same
   * name in three places - the bar at the bottom, a message, the member list
   * - began sweeping at three different moments and stayed that far apart for
   * ever. Reported as the effects being out of sync with each other.
   *
   * A negative delay says "start as though this much has already run", so
   * taking it from the wall clock modulo the loop puts every copy at the
   * phase the clock is at, whenever it happens to be drawn. Anything mounted
   * later joins in step rather than starting its own sweep.
   *
   * It does not make them cheaper, which is the other half of the question:
   * there is no sharing one animation between elements, and eight of these
   * on screen is still eight. It only makes them agree.
   */
  if (effect === 'shimmer') {
    style.animationDelay = `-${(Date.now() / 1000) % SHIMMER_SECONDS}s`
  }

  return { style, className: effect && effect !== 'none' ? `fx-${effect}` : '' }
}
