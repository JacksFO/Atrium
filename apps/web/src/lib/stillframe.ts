/**
 * Stopping an animated avatar when nobody is looking at the window.
 *
 * Reported: a GIF avatar carried on playing while the app sat on a second
 * monitor, being decoded and composited every frame for nobody. Everything
 * else that moves is a CSS animation and can be paused from the stylesheet,
 * and a GIF in a message is a <video> and can be paused outright - an <img>
 * playing a GIF is the one thing with no way to say stop.
 *
 * So it gets replaced, while unwatched, by a picture of the frame it was
 * showing: one drawImage into a small canvas, at the size it is drawn on
 * screen rather than the size of the file. Nothing is stored, nothing is
 * uploaded, nothing is asked of the server, and the moment the window is
 * looked at again the original is back from the browser's cache.
 */

/**
 * Whether a stored image can animate, from its name alone.
 *
 * GIF and WebP. WebP was left out at first as "rare", which was wrong within
 * the hour: choosing a GIF from the provider does not store the file you were
 * shown, it stores whatever the fetch came back as - and that route asks for
 * `image/gif,image/webp,image/*` and names the file after the type it got. So
 * a picture chosen as a GIF is very often saved as a .webp, and an avatar
 * chosen the way people actually choose one went on moving.
 *
 * A still WebP is copied to a canvas for nothing, which costs one drawImage
 * when the window loses focus and produces a picture identical to the one it
 * replaced. Telling the two apart means reading the file rather than its
 * name, which is a great deal of work to save that.
 */
export function canAnimate(path: string | null | undefined): boolean {
  if (!path) return false
  // The name ends at the query: the avatar route leaves its signature right
  // there on the path, unlike the icon one.
  const name = path.split('?')[0]!.split('#')[0]!
  return /\.(gif|webp)$/i.test(name)
}

/**
 * The part of a picture that `object-fit: cover` would show.
 *
 * The avatar is a square and the file rarely is, so drawing the whole image
 * into a square canvas would squash it - a still that does not match the
 * thing it replaced is worse than one that keeps moving, because it looks
 * like the picture changed rather than stopped.
 */
export function coverRect(
  naturalWidth: number, naturalHeight: number, boxWidth: number, boxHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (naturalWidth <= 0 || naturalHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(0, naturalWidth), sh: Math.max(0, naturalHeight) }
  }
  const want = boxWidth / boxHeight
  const have = naturalWidth / naturalHeight

  if (have > want) {
    // Wider than the box: keep the full height and trim the sides evenly.
    const sw = naturalHeight * want
    return { sx: (naturalWidth - sw) / 2, sy: 0, sw, sh: naturalHeight }
  }
  // Taller than the box, or the same shape: trim top and bottom instead.
  const sh = naturalWidth / want
  return { sx: 0, sy: (naturalHeight - sh) / 2, sw: naturalWidth, sh }
}

/**
 * The frame an image is showing now, as a data URL, or null if it cannot be
 * had - a picture still loading, a canvas the browser will not give up, or a
 * context it declines to create. Every one of those means "carry on as you
 * were", never an error: this is a saving, not a feature.
 */
export function freeze(img: HTMLImageElement): string | null {
  try {
    if (!img.complete || !img.naturalWidth || !img.naturalHeight) return null

    /*
     * The size it is drawn at, taken from the element rather than passed in.
     *
     * A square number was passed in at first, which is right for an avatar
     * and wrong for a banner - and asking the element removes the question
     * entirely, since whatever shape it is on screen is the shape the still
     * has to be.
     *
     * Its own size, not the file's: a 512px picture shown at 38 makes a still
     * a hundred and eighty times the area for no visible difference, and this
     * is held in memory for as long as the window is unwatched.
     */
    const rect = img.getBoundingClientRect()
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    const w = Math.round(rect.width * ratio)
    const h = Math.round(rect.height * ratio)
    if (w < 1 || h < 1) return null

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const { sx, sy, sw, sh } = coverRect(img.naturalWidth, img.naturalHeight, w, h)
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)

    /*
     * WebP where it is understood, PNG where it is not.
     *
     * This string is held in memory for as long as the window is unwatched,
     * and a banner is a photograph two hundred thousand pixels across - as
     * PNG that is a few hundred kilobytes, and as WebP a few tens of them,
     * for a still nobody is looking at closely enough to tell apart. An
     * avatar is small enough either way.
     *
     * Transparency survives both, which rules out JPEG: an avatar with a
     * transparent corner would gain a black one.
     *
     * A browser that does not know WebP hands back a PNG without saying so,
     * so the answer is checked rather than assumed.
     */
    const small = canvas.toDataURL('image/webp', 0.9)
    return small.startsWith('data:image/webp') ? small : canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
