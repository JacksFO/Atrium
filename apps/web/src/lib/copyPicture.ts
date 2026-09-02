/**
 * Put a picture on the clipboard, as a picture.
 *
 * Not a link. A link to an upload is signed and stops working after a week,
 * so copying one would hand somebody something that quietly dies - and making
 * it not die means unexpiring public URLs, which is a decision about who can
 * reach an upload rather than a menu item.
 *
 * The catch is that browsers only accept a short list of types on the
 * clipboard, and `image/png` is the only one that is safe to assume. Pictures
 * here are stored as WebP, because that is a tenth of the size - so the bytes
 * that came down the wire are exactly the bytes the clipboard will not take.
 * They are drawn onto a canvas and read back as PNG, which is the same
 * picture in the format the clipboard understands.
 */

/** Whether this browser can be handed an image at all. */
export function canCopyPictures(): boolean {
  return typeof ClipboardItem !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.clipboard?.write
}

/**
 * Fetch it, redraw it as PNG, and hand it over.
 *
 * The whole thing is inside the promise given to ClipboardItem rather than
 * awaited first. Safari drops the clipboard permission the moment the click
 * that started it finishes, so anything awaited before the write is a copy
 * that works everywhere it was tried and fails on one browser; a promise is
 * what the API takes for exactly this reason.
 *
 * Returns whether it worked, so a caller can say something rather than
 * leaving somebody looking at a menu that closed and did nothing.
 */
export async function copyPicture(path: string): Promise<boolean> {
  if (!canCopyPictures()) return false
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': asPng(path) }),
    ])
    return true
  } catch {
    /* Refused, offline, or a browser that will not take an image. Nothing to
       put back - the clipboard is either changed or it is not. */
    return false
  }
}

/** The picture at that path, as PNG bytes. */
async function asPng(path: string): Promise<Blob> {
  /* Same-origin and already signed, so it is fetched the way the <img> that
     drew it was - no credentials to add and no proxy to go through. */
  const res = await fetch(path)
  if (!res.ok) throw new Error(`could not read the picture: ${res.status}`)
  const blob = await res.blob()

  /* Already PNG: hand back what arrived rather than re-encoding it, which
     would cost time and lose nothing but is still work for no reason. */
  if (blob.type === 'image/png') return blob

  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (out) => (out ? resolve(out) : reject(new Error('could not encode'))),
        'image/png',
      )
    })
  } finally {
    /* The decoded picture is the big thing here - a 2048px screenshot is
       megabytes once it is pixels - and letting it go is not automatic. */
    bitmap.close()
  }
}
