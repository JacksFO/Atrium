/**
 * Shrink the avatars, banners and server icons already on disk.
 *
 *   pnpm shrink:images            say what would change
 *   pnpm shrink:images --write    do it
 *
 * New uploads are shrunk in the browser before they are sent. This is for
 * what was stored before that: measured on the live server, ten and a half
 * megabytes across five files, including a 2,948 KB PNG drawn as a circle
 * about thirty pixels across in the member list. Reported as the member list
 * and the profile card being laggy, which is what downloading and decoding
 * three megabytes to draw a fingernail feels like.
 *
 * Run through Electron rather than Node, because Electron's main process
 * carries an image decoder and resizer already - `nativeImage` - and the
 * alternative is a native image library the server has deliberately never
 * had. There is nothing here at runtime: it is a maintenance script that
 * borrows a tool the desktop build already depends on.
 *
 * What it will not touch:
 *
 *   animated GIFs   nativeImage decodes one frame, so resizing one would
 *                   turn an animation into a picture of its first moment -
 *                   the same reason the browser side refuses them
 *   small files     already cheap
 *   anything it     a picture that will not decode is left exactly as it is,
 *   cannot read     and said so at the end
 *
 * It writes a new file beside the old one and repoints the database rather
 * than overwriting, so a bad result is one UPDATE away from being undone -
 * but not for long. The orphan sweep removes anything unreferenced about an
 * hour after it is written, and repointing is exactly what makes the original
 * unreferenced. Copy the originals somewhere else first if the undo matters.
 */
import { app, nativeImage } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')

/** Matches the browser: an avatar or icon is drawn small, a banner wide. */
const EDGE = { avatar_path: 256, icon_path: 256, banner_path: 1024 }
/** Below this it is already cheap, and re-encoding can make it bigger. */
const SMALL_ENOUGH = 16 * 1024

const kb = (n) => `${(n / 1024).toFixed(0)} KB`

/** GIF89a / GIF87a. One frame is all nativeImage would give us. */
function isAnimated(buf) {
  return buf.length > 6 && buf.toString('latin1', 0, 4) === 'GIF8'
}

async function main() {
  const dataDir = process.env.DATA_DIR ?? join(ROOT, 'data')
  const uploadDir = process.env.UPLOAD_DIR ?? join(ROOT, 'uploads')
  const db = new DatabaseSync(join(dataDir, 'atrium.db'))

  const jobs = []
  for (const [table, id, column] of [
    ['users', 'id', 'avatar_path'],
    ['users', 'id', 'banner_path'],
    ['spaces', 'id', 'icon_path'],
  ]) {
    const rows = db.prepare(
      `SELECT ${id} AS row_id, ${column} AS path FROM ${table} WHERE ${column} IS NOT NULL`
    ).all()
    for (const r of rows) jobs.push({ table, id, column, rowId: r.row_id, path: r.path })
  }

  let before = 0
  let after = 0
  const skipped = []

  for (const job of jobs) {
    const name = String(job.path).split('/').pop()
    const full = resolve(uploadDir, name)
    if (!existsSync(full)) { skipped.push(`${name} - not on disk`); continue }

    const size = statSync(full).size
    before += size
    const buf = readFileSync(full)

    if (isAnimated(buf)) {
      after += size
      skipped.push(`${name} - ${kb(size)} animated, cannot be resized without flattening it`)
      continue
    }
    if (size <= SMALL_ENOUGH) { after += size; continue }

    const image = nativeImage.createFromBuffer(buf)
    if (image.isEmpty()) {
      after += size
      skipped.push(`${name} - ${kb(size)} would not decode`)
      continue
    }

    const { width, height } = image.getSize()
    const edge = EDGE[job.column]
    const longest = Math.max(width, height)
    const target = longest > edge
      ? (width >= height
          ? { width: edge, height: Math.max(1, Math.round(height * (edge / width))) }
          : { height: edge, width: Math.max(1, Math.round(width * (edge / height))) })
      : { width, height }

    const smaller = image.resize({ ...target, quality: 'best' })

    /*
     * Whichever encoder is smaller, rather than always PNG.
     *
     * PNG is lossless and the wrong choice for a photograph: a 1448x1086
     * banner came out at 1,177 KB as PNG and a fraction of that as JPEG. But
     * PNG is the right choice for a flat picture with sharp edges, and it is
     * the only one of the two that keeps transparency - which an avatar cut
     * into a circle may well rely on.
     *
     * So both are encoded and the smaller wins, unless the original had an
     * alpha channel to protect.
     */
    const png = smaller.toPNG()
    const jpeg = smaller.toJPEG(88)
    /*
     * PNG colour type, at byte 25 of the IHDR: 6 is RGBA and 4 is grey with
     * alpha, and 3 is a palette which carries its transparency in a separate
     * tRNS chunk. Checking only for 6 would have quietly flattened the other
     * two into a JPEG with a black background - on an avatar cut into a
     * circle, that is a black square with a face in it.
     */
    const isPng = buf.length > 26 && buf.toString('latin1', 1, 4) === 'PNG'
    const colourType = isPng ? buf[25] : -1
    const transparent = colourType === 6 || colourType === 4
      || (colourType === 3 && buf.includes(Buffer.from('tRNS')))
    const out = (!transparent && jpeg.length > 0 && jpeg.length < png.length) ? jpeg : png
    const ext = out === jpeg ? 'jpg' : 'png'

    // Only if it is actually smaller. A flat image re-encoded can grow.
    if (out.length >= size * 0.85) {
      after += size
      skipped.push(`${name} - ${kb(size)} already about right (${width}x${height})`)
      continue
    }

    after += out.length
    const stored = `${randomUUID()}.${ext}`
    console.log(
      `  ${name}\n    ${width}x${height} ${kb(size)}  ->  ` +
      `${target.width}x${target.height} ${kb(out.length)}   (${job.column})`
    )

    if (WRITE) {
      writeFileSync(resolve(uploadDir, stored), out)
      db.prepare(`UPDATE ${job.table} SET ${job.column} = ? WHERE ${job.id} = ?`)
        .run(`/uploads/${stored}`, job.rowId)
    }
  }

  console.log('')
  for (const s of skipped) console.log(`  left alone: ${s}`)
  console.log('')
  console.log(`  ${kb(before)} -> ${kb(after)}`)
  console.log(WRITE
    ? '  written, and the database repointed. The old files are still there.'
    : '  nothing written. Run with --write to do it.')
  db.close()
  app.quit()
}

app.whenReady().then(main).catch((err) => {
  console.error(err)
  app.exit(1)
})
