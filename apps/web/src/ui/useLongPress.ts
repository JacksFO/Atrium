import { useCallback, useEffect, useRef } from 'react'

/** Long enough to be deliberate, short enough not to feel like a wait. */
const HELD = 500
/** A finger that travels this far is scrolling, not asking for a menu. */
const MOVED = 10

/**
 * A long press, which is what a right-click is on a phone.
 *
 * Every menu in this app is the only way to reach what is in it — replying,
 * editing, deleting, pinning, somebody's roles, a channel's settings. Bound
 * to `contextmenu` alone, all of that was simply absent on a phone, and
 * absent in the way that looks like it was never built.
 *
 * `pointer` rather than `touch`, so one path covers a phone, a tablet and a
 * pen. Mouse presses are ignored outright: a right-click already works, and a
 * slow left-click is not a request for a menu.
 *
 * Passive listeners, because this only ever reads the press — a non-passive
 * one on pointerdown makes every drag on the page worse whether or not it
 * turns out to be a press.
 */
export function useLongPress(onPress: (x: number, y: number, target: Element) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const from = useRef<{ x: number; y: number } | null>(null)

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    from.current = null
  }, [])

  useEffect(() => {
    /* Cancelled on a scroll as well as on a move: a list that scrolls under a
       still finger is the page moving, not the finger. */
    document.addEventListener('scroll', cancel, true)
    return () => document.removeEventListener('scroll', cancel, true)
  }, [cancel])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    cancel()
    if (e.pointerType === 'mouse') return
    const { clientX: x, clientY: y } = e
    const target = e.currentTarget
    from.current = { x, y }
    timer.current = setTimeout(() => {
      timer.current = null
      onPress(x, y, target)
      /* A short tick, where the device has one, so the press is felt to have
         been noticed rather than only seen. */
      try { navigator.vibrate?.(8) } catch { /* not every device has one */ }
    }, HELD)
  }, [cancel, onPress])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const start = from.current
    if (!start) return
    if (Math.abs(e.clientX - start.x) > MOVED || Math.abs(e.clientY - start.y) > MOVED) {
      cancel()
    }
  }, [cancel])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
  }
}
