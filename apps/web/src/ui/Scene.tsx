import { useEffect, useRef } from 'react'
import { paintAvatar, paintScene, type Theme } from './art'
import { useTheme } from './theme'

/**
 * A generated picture, painted onto a canvas.
 *
 * Painted after layout rather than during render, because a canvas has no
 * size until it is on the page — and drawing into one that has none produces
 * a picture at the wrong shape which is then stretched to fit. The old client
 * invented a size when it could not measure one, which is why faces came out
 * as flat rectangles when the window was not focused.
 *
 * Repainted when the theme changes, because the colours come from it, and
 * when the box changes size — the same seed at a new size is a new picture.
 */
function useCanvas(
  draw: (cv: HTMLCanvasElement, T: Theme) => void,
  deps: unknown[],
) {
  const ref = useRef<HTMLCanvasElement>(null)
  const theme = useTheme()

  useEffect(() => {
    const cv = ref.current
    if (!cv) return

    /*
     * Off the critical path.
     *
     * These paint a few hundred shapes each, and a screenful of them is every
     * avatar without a picture, every server tile, and the wallpaper - all
     * mounting in the same commit. Painted inside the effect they all ran
     * before the browser could get back to handling a click, which is a load
     * that draws and then does nothing for a moment.
     *
     * A frame later costs a blank canvas nobody sees and gives the input back.
     */
    let frame = requestAnimationFrame(() => { draw(cv, theme) })

    /*
     * A ResizeObserver rather than a window listener: a panel being dragged
     * wider changes this canvas without the window changing at all, and that
     * is exactly the case that left banners stretched.
     *
     * Its first callback is skipped. Observing fires one immediately with the
     * size it already has, so every canvas in the app was painted twice on
     * load - once here and once for a resize that had not happened.
     */
    let first = true
    const ro = new ResizeObserver(() => {
      if (first) { first = false; return }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { draw(cv, theme) })
    })
    ro.observe(cv)
    return () => { cancelAnimationFrame(frame); ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, ...deps])

  return ref
}

export function Scene({ seed, tall, height }: {
  seed: number
  tall?: boolean
  height?: number
}) {
  const ref = useCanvas(
    (cv, T) => paintScene(cv, T, seed, height),
    [seed, height],
  )
  return <canvas ref={ref} className={tall ? 'tall' : undefined} />
}

export function AvatarArt({ seed }: { seed: number }) {
  const ref = useCanvas((cv, T) => paintAvatar(cv, T, seed), [seed])
  return <canvas ref={ref} />
}
