/**
 * A picture, made the size it is actually looked at, before it is sent.
 *
 * Measured on the uploads this server already holds: twenty images taking
 * 25.0 MB, which come to 2.4 MB at 2048px as WebP - ten and a half times
 * smaller, for pictures nothing ever draws above 420px wide inline or about
 * 1400px opened full on a good monitor. One 6 MB phone photo costs the same
 * disk as eighteen thousand messages.
 *
 * The saving lands three times over, which is why it is done here rather than
 * on the server: the sender's own upstream carries a tenth as much, the disk
 * holds a tenth as much, and every person who scrolls past it downloads a
 * tenth as much. And the server needs no image library, no CPU and no change
 * at all - it still just takes bytes and writes them down.
 *
 * What it will not touch:
 *
 *   GIFs          a canvas draws one frame, so shrinking one would quietly
 *                 turn an animation into a picture of its first moment
 *   video, files  not pictures
 *   small ones    already cheap, and re-encoding can make them bigger
 *   anything it   a picture that will not decode, a canvas the browser
 *   cannot do     refuses - the original goes, exactly as before
 */

/**
 * The longest edge a picture is stored at.
 *
 * 2048 rather than something nearer what is displayed, because this replaces
 * the original: it has to be enough to open, zoom into, and read the text in
 * a screenshot. At 2560 the same set comes to 3.2 MB and at 1280 to 1.4 MB,
 * so this is the knee of the curve rather than an arbitrary round number.
 */
export const LONG_EDGE = 2048

/** WebP at this quality is where the artefacts stop being findable. */
export const QUALITY = 0.86

/**
 * Below this, leave it alone.
 *
 * A small picture is already cheap, and re-encoding one is as likely to add
 * bytes as remove them - a flat PNG screenshot of a dialog box being the
 * classic case.
 */
export const SMALL_ENOUGH = 256 * 1024

/** How much smaller it has to come out to be worth swapping. */
export const WORTH_IT = 0.85

/** Still pictures a canvas can redraw without losing what they are. */
const REDRAWABLE = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])

export function couldShrink(
  type: string | undefined, bytes: number, smallEnough = SMALL_ENOUGH,
): boolean {
  if (!type || !REDRAWABLE.has(type.toLowerCase())) return false
  return bytes > smallEnough
}

/**
 * A picture of a person, at the size a person is actually drawn.
 *
 * An avatar is a circle about thirty pixels across in the member list and
 * eighty on a profile card. Measured on this server: one account's avatar was
 * a 2,948 KB PNG and their banner a 4,823 KB GIF - ten and a half megabytes
 * of pictures across five files, every one of them downloaded and decoded to
 * draw something the size of a fingernail. Reported as the member list and
 * the profile card being laggy, which is exactly what that is.
 *
 * The cap is generous rather than tight: 256 is four times what the largest
 * avatar on screen needs, so it still looks right on a high-DPI display, and
 * it is still around a hundredth of the bytes.
 *
 * A banner is drawn across the width of a card, so it gets more room.
 */
export const AVATAR_EDGE = 256
export const BANNER_EDGE = 1024

/**
 * Below this a profile picture is already cheap.
 *
 * Much lower than SMALL_ENOUGH, which exists for photographs shared in a
 * conversation. Two hundred kilobytes is nothing for a picture somebody might
 * open full screen, and a great deal for a circle.
 */
export const PROFILE_SMALL_ENOUGH = 16 * 1024

/**
 * How large an animated picture may be, since one cannot be resized here.
 *
 * A canvas draws a single frame, so shrinking a GIF would quietly turn an
 * animation into a picture of its first moment - which is why couldShrink
 * refuses them and why they arrive at their full size or not at all. Discord
 * solves this by resizing on their CDN and charging for animated avatars;
 * without an image library on the server the only lever here is what is
 * accepted.
 */
export const ANIMATED_LIMIT = 2 * 1024 * 1024

/** The size it comes out at: the same shape, no longer than the cap. */
export function fitWithin(
  width: number, height: number, edge = LONG_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const longest = Math.max(width, height)
  if (longest <= edge) return { width: Math.round(width), height: Math.round(height) }
  const scale = edge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Whatever it was called, now with the extension it actually is. */
export function shrunkName(name: string): string {
  const clean = (name || 'picture').replace(/\.(png|jpe?g|webp)$/i, '')
  return `${clean}.webp`
}

/**
 * Whether the smaller one is enough smaller to be the one that is kept.
 *
 * A picture that barely moves is a picture that was already about right, and
 * swapping it would spend quality on nothing.
 */
export function worthKeeping(originalBytes: number, shrunkBytes: number): boolean {
  if (shrunkBytes <= 0) return false
  return shrunkBytes < originalBytes * WORTH_IT
}

/**
 * Decode, honouring which way up the camera was holding it.
 *
 * A phone writes the picture in the sensor's orientation and a tag saying
 * how to turn it. Drawing that into a canvas without asking gives a photo on
 * its side - which would be a new bug introduced by a saving, and the sort
 * that only shows up on somebody else's phone.
 */
async function decode(file: File): Promise<{ close(): void; width: number; height: number; source: CanvasImageSource }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        width: bitmap.width, height: bitmap.height, source: bitmap,
        close: () => bitmap.close(),
      }
    } catch {
      // Older browsers refuse the option rather than ignoring it.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((ok, no) => {
      img.onload = () => ok()
      img.onerror = () => no(new Error('will not decode'))
      img.src = url
    })
    return {
      width: img.naturalWidth, height: img.naturalHeight, source: img,
      close: () => URL.revokeObjectURL(url),
    }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

/**
 * The file to actually send.
 *
 * Always returns something sendable: the smaller one when there is a smaller
 * one worth having, and otherwise the file it was given. Nothing here is
 * allowed to stop somebody sharing a picture.
 */
/**
 * How wide a picture is actually looked at in a conversation.
 *
 * A message column is a few hundred pixels and a picture in it is drawn
 * smaller than that. 512 covers it on a high-density screen without being a
 * second copy worth arguing about - about a twentieth of the bytes.
 */
export const THUMB_EDGE = 512

/**
 * A small copy of a picture, or nothing.
 *
 * Nothing is a perfectly good answer and the caller must handle it: a GIF has
 * no still copy worth having, a picture already smaller than this gains
 * nothing, and a browser that cannot write WebP should not be sending a
 * second file that is no smaller than the first.
 *
 * Made here rather than on the server because the server has no image
 * library, and adding one means a native build on Windows for something the
 * browser already does. The sender pays a little upload once; everybody who
 * scrolls past pays a twentieth for ever.
 */
export async function thumbFor(file: File): Promise<File | null> {
  if (!couldShrink(file.type, file.size, 0)) return null
  const small = await shrinkForUpload(file, { edge: THUMB_EDGE, smallEnough: 0 })
  /* shrinkForUpload hands back the original when it could not do better.
     That is the signal there is no thumbnail worth sending. */
  if (small === file) return null
  return new File([small], `thumb-${small.name}`, { type: small.type })
}

export async function shrinkForUpload(
  file: File,
  { edge = LONG_EDGE, smallEnough = SMALL_ENOUGH }: { edge?: number; smallEnough?: number } = {},
): Promise<File> {
  if (!couldShrink(file.type, file.size, smallEnough)) return file

  let decoded: Awaited<ReturnType<typeof decode>> | null = null
  try {
    decoded = await decode(file)
    const { width, height } = fitWithin(decoded.width, decoded.height, edge)
    if (!width || !height) return file

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(decoded.source, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((done) => {
      canvas.toBlob((b) => done(b), 'image/webp', QUALITY)
    })
    // A browser that cannot write WebP hands back a PNG, or nothing at all.
    if (!blob || blob.type !== 'image/webp') return file
    if (!worthKeeping(file.size, blob.size)) return file

    return new File([blob], shrunkName(file.name), {
      type: 'image/webp',
      lastModified: file.lastModified,
    })
  } catch {
    return file
  } finally {
    try { decoded?.close() } catch { /* nothing to undo */ }
  }
}
