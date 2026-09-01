import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Theme } from './art'

/**
 * The look of the place.
 *
 * Ten themes out of seven numbers each: an accent hue, a base hue, how much
 * colour there is, how much of it reaches the neutrals, how round things are,
 * light or dark, and whether panels are glass. Only the hues move between
 * them — the lightness steps are fixed, so a theme cannot come out
 * unreadable.
 *
 * The numbers go onto the root as custom properties, which is what the
 * stylesheet is written against. They are written only when they change: the
 * old client set two dozen of them on every render with the same values
 * almost every time, and setting one recalculates everything drawn from it —
 * with glass on, that composites every panel's backdrop blur again. That was
 * the flicker on every click.
 */

export type ThemeDef = Theme & {
  id: string
  n: string
  rad: number
  glass: 'on' | 'off'
  fx: 'none' | 'glow' | 'grid' | 'scan' | 'paper'
}

export const THEMES: readonly ThemeDef[] = [
  /* Atrium's neutrals are its own, and they were wrong. The build before the
     port put every panel on #0A141B - a navy with real colour in it - and the
     port's 208/0.65 came out grey. 240 and 1.3 land on the old one; measured
     by rendering both and comparing, not by reading the numbers. */
  { id: 'atrium', n: 'Atrium', h: 194, bh: 240, tint: 0.9, nt: 1.3, rad: 16, mode: 'dark', glass: 'on', fx: 'none' },
  { id: 'lagoon', n: 'Lagoon', h: 178, bh: 190, tint: 1, nt: 0.85, rad: 18, mode: 'dark', glass: 'on', fx: 'glow' },
  { id: 'fern', n: 'Fern', h: 146, bh: 138, tint: 0.85, nt: 0.7, rad: 12, mode: 'dark', glass: 'off', fx: 'grid' },
  { id: 'clay', n: 'Clay', h: 26, bh: 36, tint: 0.95, nt: 0.9, rad: 14, mode: 'dark', glass: 'on', fx: 'none' },
  { id: 'rust', n: 'Rust', h: 12, bh: 24, tint: 1, nt: 1, rad: 10, mode: 'dark', glass: 'off', fx: 'none' },
  { id: 'dusk', n: 'Dusk', h: 290, bh: 274, tint: 0.9, nt: 0.85, rad: 20, mode: 'dark', glass: 'on', fx: 'glow' },
  { id: 'steel', n: 'Steel', h: 222, bh: 226, tint: 0.4, nt: 0.3, rad: 8, mode: 'dark', glass: 'off', fx: 'none' },
  { id: 'ink', n: 'Ink', h: 206, bh: 212, tint: 0.5, nt: 0.1, rad: 5, mode: 'dark', glass: 'off', fx: 'scan' },
  { id: 'sand', n: 'Sand', h: 40, bh: 66, tint: 0.6, nt: 0.6, rad: 14, mode: 'light', glass: 'off', fx: 'paper' },
  { id: 'mist', n: 'Mist', h: 204, bh: 212, tint: 0.5, nt: 0.4, rad: 16, mode: 'light', glass: 'off', fx: 'none' },
]

export const themeById = (id: string): ThemeDef => THEMES.find((t) => t.id === id) ?? THEMES[0]!

const ThemeContext = createContext<Theme>(THEMES[0]!)

/** The colours, for anything that paints rather than styles. */
export const useTheme = (): Theme => useContext(ThemeContext)

/**
 * Put a theme onto the root, and hand the colours to whatever paints.
 *
 * Every write is compared first. Nothing here changes what is written — only
 * how often.
 */
export function ThemeProvider({ id, fontSize, look, children }: {
  id: string
  fontSize: number
  /** The rest of what the stylesheet reads off the root. */
  look: {
    density: string
    wallpaper: boolean
    lineHeight: number
    reduceMotion: boolean
  }
  children: React.ReactNode
}) {
  const t = themeById(id)
  const [root, setRoot] = useState<HTMLElement | null>(null)

  /*
   * The document, not the app's own element.
   *
   * Menus, pickers and dialogs are drawn through a portal to the body so they
   * are placed against the window rather than against whatever panel opened
   * them — which puts them *outside* #app. Set there, every one of them lost
   * every colour the theme defines: a context menu with no background is a
   * transparent one, and an input with no tokens is a browser default.
   *
   * Variables inherit, so setting them at the top reaches both.
   */
  useEffect(() => setRoot(document.documentElement), [])

  useEffect(() => {
    if (!root) return
    const set = (k: string, v: string) => {
      if (root.style.getPropertyValue(k) !== v) root.style.setProperty(k, v)
    }
    const attr = (k: string, v: string) => {
      if (root.dataset[k] !== v) root.dataset[k] = v
    }
    set('--h', String(t.h))
    set('--bh', String(t.bh))
    set('--tint', String(t.tint))
    set('--nt', String(t.nt))
    set('--rad', String(t.rad))
    set('--fsz', String(fontSize))
    set('--lh', (look.lineHeight / 100).toFixed(2))
    attr('mode', t.mode)
    attr('glass', t.glass)
    attr('dens', look.density)
    attr('wall', look.wallpaper ? 'on' : 'off')
    /* Less motion switches the ambient wash off outright rather than slowing
       it: somebody who asked for less motion did not ask for slower motion. */
    attr('fx', look.reduceMotion ? 'none' : t.fx)
    attr('reduce', look.reduceMotion ? 'on' : 'off')
  }, [root, t, fontSize, look])

  const colours = useMemo<Theme>(
    () => ({ h: t.h, bh: t.bh, tint: t.tint, nt: t.nt, mode: t.mode }),
    [t],
  )

  return <ThemeContext.Provider value={colours}>{children}</ThemeContext.Provider>
}
