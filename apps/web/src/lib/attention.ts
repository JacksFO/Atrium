/**
 * Whether anybody is actually looking at this window.
 *
 * Set as an attribute on the root element so CSS can use it directly, which is
 * what stops a name shimmering away in a window on somebody's second monitor
 * while they are playing a game on the other one.
 *
 * visibilityState on its own is not enough. It reports hidden when the tab is
 * in the background or the window is minimised, and visible when the window is
 * merely unfocused - which is exactly the case that matters here. hasFocus()
 * is the half that catches it, and the same pair already governs whether GIFs
 * keep playing.
 */

let started = false

function update(): void {
  const watching = isWatching()
  document.documentElement.dataset.watching = watching ? 'yes' : 'no'
  for (const fn of listeners) fn(watching)
}

/** Idempotent: safe to call from more than one place, and does nothing twice. */
export function watchAttention(): void {
  if (started || typeof document === 'undefined') return
  started = true

  document.addEventListener('visibilitychange', update)
  window.addEventListener('blur', update)
  window.addEventListener('focus', update)
  update()
}

/**
 * The same answer, for components that need to act rather than restyle.
 *
 * CSS can pause an animation but it cannot pause a video, so anything that
 * has to stop decoding needs this in React rather than an attribute.
 */
const listeners = new Set<(watching: boolean) => void>()

export function isWatching(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState === 'visible' && document.hasFocus()
}

export function onAttentionChange(fn: (watching: boolean) => void): () => void {
  watchAttention()
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
