/*
 * The same GIF is fetched once, stored once, and costs nothing thereafter.
 *
 * Picking a GIF copies it onto this server, so it keeps working if the
 * provider drops it and nobody's address is ever sent to the provider. Every
 * send used to write a fresh copy under a fresh name: four on disk here
 * averaging 1.28 MB, and a group of friends reuses the same handful all
 * evening, so it was a bill that had not arrived rather than one that was not
 * coming.
 *
 * Two things now stop it, and they are tested separately because they cover
 * different cases. The file is named after its own contents, which catches the
 * same GIF arriving from two different addresses. And the address it came from
 * is remembered, which is what makes a repeat cost no download either.
 *
 * fetch is stubbed. Nothing here touches the network, the real database, or
 * the real uploads folder.
 */
import { mkdtempSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const work = mkdtempSync(join(tmpdir(), 'jc-gif-'))
mkdirSync(join(work, 'data'), { recursive: true })
mkdirSync(join(work, 'uploads'), { recursive: true })
process.env.DATA_DIR = join(work, 'data')
process.env.UPLOAD_DIR = join(work, 'uploads')

const { importGif } = await import('../../apps/server/dist/gifs.js')

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

/* A stand-in for a provider: always the same few bytes, and it counts. */
let fetches = 0
const body = (text) => ({
  ok: true,
  status: 200,
  headers: { get: (h) => (h === 'content-type' ? 'video/mp4' : null) },
  body: new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(text)); c.close() },
  }),
})
globalThis.fetch = async (url) => { fetches++; return body(String(url).includes('other') ? 'DIFFERENT BYTES' : 'THE SAME BYTES') }

const files = () => readdirSync(join(work, 'uploads')).filter((f) => !f.startsWith('.'))

// ---- the same address twice ----
const first = await importGif('https://media.giphy.com/one.mp4', 'a gif')
check('the first one is fetched', fetches === 1, { fetches })
check('and stored', files().length === 1, files())
check('and marked as a GIF rather than a file', first.isGif === true, first)

const second = await importGif('https://media.giphy.com/one.mp4', 'a gif')
check('the second send does not fetch it again', fetches === 1, { fetches })
check('and writes nothing new', files().length === 1, files())
check('pointing at the same file', second.url === first.url, { first: first.url, second: second.url })
/* Two messages showing it are still two attachments. */
check('but with an id of its own', second.id !== first.id, { first: first.id, second: second.id })

// ---- the same GIF found at a different address ----
const elsewhere = await importGif('https://media1.giphy.com/one-again.mp4', 'a gif')
check('a GIF found somewhere else is fetched', fetches === 2, { fetches })
check('but recognised by its contents and not stored twice',
  files().length === 1 && elsewhere.url === first.url, { files: files(), url: elsewhere.url })

// ---- a genuinely different GIF ----
const other = await importGif('https://media.giphy.com/other.mp4', 'another')
check('a different GIF is stored separately', files().length === 2, files())
check('under a different name', other.url !== first.url, { other: other.url })

// ---- and the shortcut never outlives the file ----
const before = fetches
unlinkSync(join(work, 'uploads', first.url.split('/').pop()))
await importGif('https://media.giphy.com/one.mp4', 'a gif')
/*
 * The row is a shortcut, not a promise. If the sweeper has taken the file
 * away, trusting the row would hand out a broken picture for ever - fetching
 * it again costs one download.
 */
check('a file that has gone is fetched again rather than promised',
  fetches === before + 1, { before, after: fetches })
check('and is back on disk', files().length === 2, files())

/* The database still has its file open; the directory is the OS's problem. */
try { rmSync(work, { recursive: true, force: true }) } catch { /* left in temp */ }
console.log('\n  ' + (bad === 0 ? 'a GIF is fetched once and stored once' : bad + ' wrong'))
process.exitCode = bad === 0 ? 0 : 1
