import type { Api } from './api'

/**
 * Making a cover small enough to send.
 *
 * Windows hands over whatever the player felt like providing - Spotify's is a
 * 211KB PNG, measured - and that is repeated to everybody in the server every
 * time a track changes. On a home connection, ten people and a change every
 * three minutes, that is real upload spent on an image drawn at 58 pixels.
 *
 * So it is redrawn small here, where there is a canvas to do it with, rather
 * than in the shell where there is not. The one that goes out is a few
 * kilobytes.
 */

/** How big the sent copy is. Drawn at 58, so this survives a sharp screen. */
export const ART_SIZE = 96

/**
 * The square to take out of a picture that is not square.
 *
 * Covers usually are, but a player is free to hand over anything, and a
 * rectangle squashed into a square box is worse than one honestly cropped.
 * The middle, because that is where the thing in a picture usually is.
 *
 * Pure, and separate from the drawing, because this is the part with an
 * answer worth checking.
 */
export function coverCrop(w: number, h: number): { x: number; y: number; side: number } {
  const side = Math.max(1, Math.min(w, h))
  return { x: Math.max(0, (w - side) / 2), y: Math.max(0, (h - side) / 2), side }
}

/**
 * A small JPEG of a cover, or nothing at all.
 *
 * Nothing rather than the original on any failure: the original is two
 * hundred kilobytes, the server will refuse it, and sending it anyway would
 * spend the upload to have it thrown away at the far end. A card with no
 * picture is a fine thing to have.
 */
export async function shrinkArt(dataUrl: string, size = ART_SIZE): Promise<string | undefined> {
  try {
    const img = new Image()
    img.src = dataUrl
    // decode rather than onload: it settles when the pixels are actually
    // ready to draw, and rejects rather than hanging on something malformed.
    await img.decode()

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    const { x, y, side } = coverCrop(img.naturalWidth || img.width, img.naturalHeight || img.height)
    ctx.drawImage(img, x, y, side, side, 0, 0, size, size)

    /* JPEG, because a cover is a photograph and PNG keeps every pixel of one
       at four times the size. 0.72 is where the artefacts stop being visible
       at this scale. */
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return undefined
  }
}

/**
 * The name a picture has here: the hash of its bytes.
 *
 * Both an address that can never be stale - so a browser may cache it for
 * ever - and a receipt the server re-checks, so claiming somebody else's name
 * and sending something else is caught by arithmetic rather than by trust.
 */
export async function nameFor(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The bytes behind a data URI, without a fetch and without a round trip. */
export function bytesOf(dataUrl: string): { type: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl)
  if (!match) return null
  try {
    const binary = atob(match[2]!)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return { type: match[1]!, bytes: out }
  } catch {
    return null
  }
}

/** Where a cover lives, once the server has it. Same-origin, so a path. */
export function artUrl(hash: string): string {
  return `/api/art/${hash}`
}

/**
 * Make a cover small, put it somewhere, and return its name.
 *
 * Uploaded only when the server does not already have it, which for an album
 * played twice, or by two people, is most of the time. Undefined on any
 * failure at all: the card is fine without a picture, and a name pointing at
 * nothing would be a broken image where a tidy blank one belongs.
 */
export async function publishArt(
  server: Api, dataUrl: string,
): Promise<string | undefined> {
  const small = await shrinkArt(dataUrl)
  if (!small) return undefined
  /* Uploaded only when the server does not already have it, which for an
     album played twice, or by two people, is most of the time. */
  return publishEncoded(server, small)
}

/**
 * A game's icon, from the raw pixels the shell read out of its executable.
 *
 * PNG rather than JPEG, unlike a cover: an icon has a shape, and JPEG has no
 * transparency to give it - the corners would come out as a black square
 * around it. A cover is a photograph and fills its square, so it keeps JPEG.
 *
 * Kept square by fitting rather than cropping. An icon is a whole thing and
 * cutting the sides off one is worse than a little space around it.
 */
export async function publishPixels(
  server: Api, width: number, height: number, rgba: Uint8Array, size = ART_SIZE,
): Promise<string | undefined> {
  try {
    if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return undefined

    // The pixels as they came, on a canvas of their own size.
    const source = document.createElement('canvas')
    source.width = width
    source.height = height
    const from = source.getContext('2d')
    if (!from) return undefined
    from.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)

    const square = document.createElement('canvas')
    square.width = size
    square.height = size
    const to = square.getContext('2d')
    if (!to) return undefined
    const scale = Math.min(size / width, size / height)
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    to.drawImage(source, 0, 0, width, height, (size - w) / 2, (size - h) / 2, w, h)

    return await publishEncoded(server, square.toDataURL('image/png'))
  } catch {
    return undefined
  }
}

/**
 * Put an already-small picture where everybody can fetch it, by name.
 *
 * Named by its own contents, so the same album art from two people, or from
 * the same person twice, is one upload and one file. The HEAD asks whether
 * the server already has it before sending a single byte, which for an album
 * played more than once is nearly always.
 *
 * Undefined on any failure at all. The card is fine without a picture, and a
 * name pointing at nothing is a broken image where a tidy blank belongs.
 */
async function publishEncoded(
  server: Api, dataUrl: string,
): Promise<string | undefined> {
  const parts = bytesOf(dataUrl)
  if (!parts) return undefined
  try {
    const hash = await nameFor(parts.bytes.buffer as ArrayBuffer)
    if (await server.has(artUrl(hash))) return hash
    await server.raw('PUT', artUrl(hash), new Blob([parts.bytes as BlobPart], { type: parts.type }), parts.type)
    return hash
  } catch {
    return undefined
  }
}
