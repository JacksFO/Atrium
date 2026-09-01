/**
 * The parts of a browser jsdom does not have.
 *
 * Only the ones the app genuinely calls, and each one behaves: an observer
 * that never fires is honest about a document with no layout, and a canvas
 * that hands back a working context keeps the generated art from throwing
 * where it is only decoration.
 */

/**
 * An observer that never fires on its own, and can be made to.
 *
 * jsdom lays nothing out, so a real one would never fire — and a stub that
 * can never fire makes every behaviour built on it untestable. This one
 * remembers what it is watching, so a test can say "that grew".
 */
class NoLayoutObserver {
  static live = new Set<NoLayoutObserver>()
  watching = new Set<Element>()
  constructor(readonly fire: () => void) { NoLayoutObserver.live.add(this) }
  observe(el: Element) { this.watching.add(el) }
  unobserve(el: Element) { this.watching.delete(el) }
  disconnect() { this.watching.clear(); NoLayoutObserver.live.delete(this) }
}

/** Tells every observer watching this element that it changed size. */
export function resized(el: Element): void {
  for (const o of NoLayoutObserver.live) if (o.watching.has(el)) o.fire()
}

/** What is being watched right now, for a test that wants to check. */
export function watchers(el: Element): number {
  let n = 0
  for (const o of NoLayoutObserver.live) if (o.watching.has(el)) n++
  return n
}

const g = globalThis as unknown as Record<string, unknown>
g.ResizeObserver ??= NoLayoutObserver
g.IntersectionObserver ??= NoLayoutObserver

/* Nothing in jsdom paints, so every drawing call is a no-op that must still
   answer. Returning null here is what a real browser does for a context it
   cannot give, and the app is written to cope with that. */
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext ??= (() => null) as never
}

if (typeof window !== 'undefined') {
  window.matchMedia ??= ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
  /* jsdom has no pointer capture, and a drag calls it. */
  Element.prototype.setPointerCapture ??= function () {}
  Element.prototype.releasePointerCapture ??= function () {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.scrollIntoView ??= function () {}
}
