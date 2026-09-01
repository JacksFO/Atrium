/**
 * Is this file the kind of file it says it is?
 *
 * The upload route checks the type against an allowed list, but the type
 * came from whoever was uploading - so "image/png" was a claim, not a fact,
 * and any bytes at all could be stored under a .png.
 *
 * The surrounding defences already made that hard to exploit: there is no
 * SVG on the list, browsers are told never to second-guess a type, PDFs are
 * handed over as downloads rather than opened, and the web client has a
 * content policy. This closes the hole itself rather than relying on all
 * four of those staying true.
 *
 * Only the formats actually accepted are described here. Anything not
 * described is refused rather than waved through, so adding a type to the
 * allowed list without teaching this about it fails closed.
 */

/** How many bytes are needed before any of these can be judged. */
export const SNIFF_BYTES = 16

type Check = (head: Buffer) => boolean

const starts = (...bytes: number[]): Check =>
  (head) => bytes.every((b, i) => head[i] === b)

const ascii = (at: number, text: string): Check =>
  (head) => head.toString('latin1', at, at + text.length) === text

const all = (...checks: Check[]): Check => (head) => checks.every((c) => c(head))
const any = (...checks: Check[]): Check => (head) => checks.some((c) => c(head))

const SIGNATURES = new Map<string, Check>([
  ['image/png', starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
  // Every JPEG variant starts with the same marker; what follows differs.
  ['image/jpeg', starts(0xff, 0xd8, 0xff)],
  ['image/gif', any(ascii(0, 'GIF87a'), ascii(0, 'GIF89a'))],
  // A RIFF container that happens to hold WebP. The four bytes between are
  // the length, which is not ours to judge.
  ['image/webp', all(ascii(0, 'RIFF'), ascii(8, 'WEBP'))],
  // ISO base media: a box length, then the type. Covers MP4 and its cousins.
  ['video/mp4', ascii(4, 'ftyp')],
  // Matroska, of which WebM is a profile.
  ['video/webm', starts(0x1a, 0x45, 0xdf, 0xa3)],
  ['application/pdf', ascii(0, '%PDF-')],
])

/**
 * Whether the first bytes of a file match the type it was uploaded as.
 *
 * A short file is not given the benefit of the doubt: something claiming to
 * be a PNG and consisting of four bytes is not a PNG either.
 */
export function looksLike(mime: string, head: Buffer): boolean {
  const check = SIGNATURES.get(mime)
  if (!check) return false
  if (head.length < SNIFF_BYTES) return false
  return check(head)
}

/** The types this module can vouch for, so the caller can check its own list. */
export function describedTypes(): string[] {
  return [...SIGNATURES.keys()]
}
