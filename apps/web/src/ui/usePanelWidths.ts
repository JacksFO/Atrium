import { useCallback, useEffect, useRef } from 'react'
import type { Settings } from '../lib/settings'

/**
 * The widths somebody dragged the panels to.
 *
 * Written to the document as custom properties rather than as inline styles
 * on the panels themselves. An inline style beats every media query there is,
 * so a width set that way survives into the phone layout and puts the
 * conversation off the side of the screen — which is exactly how the old
 * client's phone layout was overruled the moment it drew itself.
 *
 * Only what changed is written. Setting a property to the value it already
 * has still invalidates style for the whole subtree, and doing it on every
 * render is a flicker on every keystroke.
 */

export type GripKey = 'rail' | 'side' | 'right'

type Grip = {
  /** The property the stylesheet lays the column out from. */
  prop: string
  /** Which setting holds it. */
  key: 'railTile' | 'sideWidth' | 'membersWidth'
  min: number
  max: number
  /**
   * A second property, and the width it counts as one at.
   *
   * The rail already worked this way — its tile is the one number the icons,
   * the badges and the spacing are all worked out from — and beside it the
   * other two looked broken: dragging the channel list to twice the width
   * gave the same small text with more empty space next to it.
   */
  scale?: string
  at?: number
}

export const GRIPS: Record<GripKey, Grip> = {
  rail: { prop: '--tile', key: 'railTile', min: 52, max: 132 },
  side: { prop: '--sidew', key: 'sideWidth', min: 200, max: 480, scale: '--sides', at: 278 },
  right: { prop: '--rightw', key: 'membersWidth', min: 190, max: 480, scale: '--rights', at: 254 },
}

export const fit = (g: Grip, want: number): number =>
  Math.max(g.min, Math.min(g.max, Number.isFinite(want) && want > 0 ? want : g.at ?? g.min))

/** Puts the widths on the document, and hands back a way to drag one. */
export function usePanelWidths(
  settings: Settings,
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void,
) {
  /* What was last written, so nothing is written twice. */
  const at = useRef<Record<string, string>>({})

  const put = useCallback((prop: string, value: string) => {
    if (at.current[prop] === value) return
    at.current[prop] = value
    document.documentElement.style.setProperty(prop, value)
  }, [])

  const apply = useCallback((key: GripKey, px: number) => {
    const g = GRIPS[key]
    const w = fit(g, px)
    put(g.prop, `${w}px`)
    if (g.scale && g.at) put(g.scale, String(Math.round((w / g.at) * 1000) / 1000))
  }, [put])

  /* On every change to the saved widths, including the first draw — a layout
     somebody arranged should be there when the app opens, not after they
     touch something. */
  useEffect(() => {
    for (const key of Object.keys(GRIPS) as GripKey[]) {
      apply(key, settings[GRIPS[key].key])
    }
  /* The three widths, not the whole settings object - which changes when
     anything at all changes, and would re-apply the layout on every
     unrelated preference. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply, settings.railTile, settings.sideWidth, settings.membersWidth])

  /**
   * Dragging one.
   *
   * Followed on the document rather than on the handle, because the pointer
   * leaves a nine-pixel strip the instant it starts moving — bound to the
   * handle, a drag stops the moment it begins.
   */
  const drag = useCallback((key: GripKey, from: 'left' | 'right') => (
    (e: React.PointerEvent) => {
      e.preventDefault()
      const g = GRIPS[key]
      const startX = e.clientX
      const startW = fit(g, settings[g.key])

      const move = (ev: PointerEvent) => {
        const by = from === 'left' ? startX - ev.clientX : ev.clientX - startX
        apply(key, startW + by)
      }
      const up = (ev: PointerEvent) => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        const by = from === 'left' ? startX - ev.clientX : ev.clientX - startX
        /* Saved once, at the end. Saving on every move writes to storage a
           hundred times for one drag. */
        set(g.key, fit(g, startW + by))
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
    }
  ), [apply, set, settings])

  return { drag }
}
