import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { config } from './config.js'
import { looksLike, SNIFF_BYTES } from './filetype.js'

/**
 * Fetch a picture from somewhere else and keep our own copy.
 *
 * For the GIF picker: choosing one sets it as an avatar, and an avatar is
 * drawn for everybody who can see you - so writing the provider's address
 * onto the row would hand them the address of every person who scrolled past
 * your name. The file lives here instead, exactly like an upload.
 *
 * Whether the URL is one we are willing to fetch at all is decided before
 * this is called, by isProviderUrl, and that is the security of the thing.
 * What is decided here is everything after: how big it may be, how long it
 * may take, and whether the bytes are what they claim to be.
 *
 * Its own file so those rules can be tested against a server that answers
 * badly on purpose - too much, too slowly, or with something that is not a
 * picture at all.
 */

/** What each format is stored as. The same list uploads use. */
const EXT: Record<string, string> = {
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/png': '.png',
  'image/jpeg': '.jpg',
}

export type Fetched = { url: string; bytes: number }

export async function saveFromUrl(from: string): Promise<Fetched> {
  const res = await fetch(from, {
    /*
     * A provider's media URL is the file itself. Anything answering "go and
     * ask over there instead" is either broken or trying something - and
     * following it would step straight around the check on where we may go,
     * which is the only thing standing between this and a request to the
     * machine next door.
     */
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: { accept: 'image/gif,image/webp,image/*' },
  })
  if (!res.ok) throw new Error(`the picture could not be fetched (${res.status})`)

  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > config.maxUploadBytes) throw new Error('that picture is too large')

  const body = Buffer.from(await res.arrayBuffer())
  // Checked again on what actually arrived: a content-length is a claim, and
  // a response with no length at all makes no claim whatsoever.
  if (body.length > config.maxUploadBytes) throw new Error('that picture is too large')
  if (body.length < SNIFF_BYTES) throw new Error('that is not a picture')

  /*
   * What it is, decided from the bytes.
   *
   * Not from the content-type header, which is somebody else's claim about
   * somebody else's file - the same rule uploads follow. Both providers serve
   * real GIFs and WebP; anything else is not what was asked for.
   */
  const mime = Object.keys(EXT).find((m) => looksLike(m, body.subarray(0, SNIFF_BYTES)))
  if (!mime) throw new Error('that is not a picture')

  const id = randomUUID()
  const stored = `${id}${EXT[mime]}`
  await writeFile(resolve(config.uploadDir, stored), body)
  return { url: `/uploads/${stored}`, bytes: body.length }
}
