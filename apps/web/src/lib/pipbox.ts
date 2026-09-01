/**
 * Where the corner window is, and how big.
 *
 * Kept apart from the component because it is arithmetic, and arithmetic on
 * pointer events is the part that goes wrong: an edge that moves the opposite
 * way, a window that can be dragged off the screen and never got back, a
 * corner that grows past the viewport when somebody makes the window smaller.
 * None of that needs a browser to find out about.
 *
 * Screen coordinates, from the top left, because that is what a pointer
 * gives. It is drawn in the bottom right to begin with, but only until
 * somebody moves it - after that it is wherever they left it.
 */

export type Box = { x: number; y: number; w: number; h: number }
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/**
 * Small enough to be out of the way, large enough to make out a window in
 * somebody's shared screen. The first version was 250 wide, which was fine
 * for a face and too small to read anything on a desktop.
 */
export const PIP_W = 384
export const PIP_H = 248
/** Below this it stops being a picture and starts being a smudge. */
export const MIN_W = 200
export const MIN_H = 130
/** How far in from the edge it sits when nobody has moved it. */
const INSET = 16
/**
 * The bar at the bottom of the app, which the window used to clear by
 * sitting 96px up. Kept as the resting place rather than a rule, so a window
 * somebody has dragged over it stays where they put it.
 */
const BOTTOM = 96

/**
 * The shape of the picture inside, as width over height.
 *
 * Everything here takes one, because a window that is not the shape of what
 * is in it draws black bars: `object-fit: contain` will not crop somebody's
 * screen to fill a box, and it should not - the bars are the honest answer to
 * a window of the wrong shape. So the window is kept the right shape instead,
 * and then there is nothing to letterbox.
 *
 * Null while nothing is playing yet, when any shape is as good as another.
 */
export type Ratio = number | null

/** Squeeze a size to a ratio, and to what is allowed, keeping the ratio. */
function shaped(w: number, h: number, view: { w: number; h: number },
  ratio: Ratio, drive: 'w' | 'h'): { w: number; h: number } {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) {
    return {
      w: Math.max(MIN_W, Math.min(w, view.w)),
      h: Math.max(MIN_H, Math.min(h, view.h)),
    }
  }
  /* One dimension leads and the other follows it, so a drag never fights
     itself: an edge that set both would be two answers to one question. */
  let width = drive === 'w' ? w : h * ratio
  /* The smallest that satisfies both minimums at this shape - a tall stream
     hits the minimum width long before the minimum height. */
  const least = Math.max(MIN_W, MIN_H * ratio)
  const most = Math.min(view.w, view.h * ratio)
  width = Math.min(Math.max(width, least), Math.max(least, most))
  return { w: width, h: width / ratio }
}

/** Where it goes before anybody has an opinion. */
export function restingPlace(view: { w: number; h: number }, ratio: Ratio = null): Box {
  const { w, h } = shaped(
    Math.min(PIP_W, view.w - INSET * 2),
    Math.min(PIP_H, view.h - INSET * 2),
    view, ratio, 'w',
  )
  return { x: view.w - w - INSET, y: view.h - h - BOTTOM, w, h }
}

/**
 * Keep it reachable.
 *
 * Not "fully on screen": a window nudged half off the right edge is a window
 * somebody put there. What must never happen is losing the window itself, so
 * enough of it is always kept in view to take hold of.
 */
const GRAB = 56

export function clamp(box: Box, view: { w: number; h: number }, ratio: Ratio = null): Box {
  const { w, h } = shaped(box.w, box.h, view, ratio, 'w')
  return {
    w,
    h,
    x: Math.max(GRAB - w, Math.min(box.x, view.w - GRAB)),
    /* Never above the top: a window dragged off the top takes with it every
       edge you could take hold of to bring it back. */
    y: Math.max(0, Math.min(box.y, view.h - GRAB)),
  }
}

/** Moved by a pointer, from where it was when the drag started. */
export function movedBy(from: Box, dx: number, dy: number,
  view: { w: number; h: number }): Box {
  /* No ratio: moving cannot change the shape, and passing one here would let
     a drag quietly resize the window it is only carrying. */
  return clamp({ ...from, x: from.x + dx, y: from.y + dy }, view)
}

/**
 * Resized by dragging one edge or corner.
 *
 * The north and west edges move the window as well as size it - dragging the
 * left edge leftwards has to make it wider *and* start further left, or the
 * edge under the pointer runs away from the pointer. Getting that backwards
 * is the classic version of this bug and is why it is written down here.
 *
 * With a ratio, one dimension leads and the other follows, so the window
 * stays the shape of the picture however it is dragged - and the edge that
 * was not being dragged has to stay where it was, or the window walks across
 * the screen while somebody stretches it.
 */
export function resizedBy(from: Box, edge: Edge, dx: number, dy: number,
  view: { w: number; h: number }, ratio: Ratio = null): Box {
  let { x, y, w, h } = from

  if (edge.includes('e')) w = from.w + dx
  if (edge.includes('s')) h = from.h + dy
  if (edge.includes('w')) {
    w = from.w - dx
    x = from.x + dx
  }
  if (edge.includes('n')) {
    h = from.h - dy
    y = from.y + dy
  }

  /* A pure top or bottom edge is a question about height; everything else is
     a question about width, corners included - one pointer, one answer. */
  const drive = edge === 'n' || edge === 's' ? 'h' : 'w'
  const size = shaped(w, h, view, ratio, drive)

  /* Anchored to whichever edges were not dragged, so those stay put. */
  if (edge.includes('w')) x = from.x + from.w - size.w
  if (edge.includes('n')) y = from.y + from.h - size.h
  /* A pure side drag changes the height too, and grows it downwards rather
     than from the middle - the top edge was not the one being dragged. */

  return clamp({ x, y, w: size.w, h: size.h }, view, ratio)
}

const KEY = 'atrium.pip'

/** What was left last time, if it still fits this screen. */
export function remembered(view: { w: number; h: number }): Box | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const held = JSON.parse(raw) as Partial<Box>
    const box = { x: held.x, y: held.y, w: held.w, h: held.h }
    if (!Object.values(box).every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return null
    }
    return clamp(box as Box, view)
  } catch {
    /* No storage, or something else wrote nonsense into it. Either way the
       resting place is a perfectly good answer. */
    return null
  }
}

export function remember(box: Box): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(box))
  } catch {
    /* Private windows and full disks. Not worth a word to anybody. */
  }
}
