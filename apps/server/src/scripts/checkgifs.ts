/**
 * Check the GIF provider for real.
 *
 *   pnpm test:gifs:live
 *
 * The KLIPY mapping in gifs.ts was written from their published shape and
 * from working code using it, not from a live call — there was no key to
 * make one with. So it is the part most likely to be quietly wrong, and this
 * is how that gets settled rather than discovered by somebody whose GIF will
 * not send.
 *
 * It asks the three questions a unit test cannot:
 *
 *   1. Does the answer parse into results at all, or has the shape moved?
 *   2. Are the CDN hosts ones importGif will accept? Guessing at a provider's
 *      hostnames is exactly how the GIF ledger nearly shipped broken.
 *   3. Does fetching one actually return image/gif or video/mp4 — the only
 *      two types the import stores?
 *
 * Nothing is written and nothing is stored. It does spend from the hourly
 * budget though - three provider calls and two media fetches - so it is a
 * check to run when something changed, not a thing to sit in a loop.
 */
import { gifProvider, importableHost, searchGifs, trendingGifs, type Gif } from '../gifs.js'

let bad = 0
const check = (what: string, ok: boolean, got?: unknown) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

const provider = gifProvider()
console.log(`\n  provider: ${provider ?? 'none configured'}\n`)

if (!provider) {
  console.log('  Set KLIPY_API_KEY (or GIPHY_API_KEY) in .env and run this again.\n')
  process.exit(1)
}

/** Every URL a result carries, so none of them goes unchecked. */
function urlsOf(g: Gif): string[] {
  return [g.preview, g.still, g.mp4].filter(Boolean)
}

async function look(label: string, gifs: Gif[]): Promise<void> {
  console.log(`  --- ${label} ---`)
  check('came back with results', gifs.length > 0, gifs.length)
  if (gifs.length === 0) return

  const withVideo = gifs.filter((g) => g.mp4).length
  const withStill = gifs.filter((g) => g.still).length
  const sized = gifs.filter((g) => g.width > 0 && g.height > 0).length

  check('every result has something to draw', gifs.every((g) => g.preview || g.mp4))
  check('every result has an id', gifs.every((g) => g.id.length > 0))
  check('most have an mp4, which is what gets sent', withVideo > gifs.length / 2,
    `${withVideo}/${gifs.length}`)
  check('most have a still for the poster frame', withStill > gifs.length / 2,
    `${withStill}/${gifs.length}`)
  check('all have real dimensions', sized === gifs.length, `${sized}/${gifs.length}`)
  check('descriptions are not all the placeholder',
    gifs.some((g) => g.description && g.description !== 'GIF'))

  /*
   * The one that catches a wrong host list. Every URL the picker will hand
   * back must be one the import is willing to fetch, or picking a GIF fails
   * with "that is not a GIF provider URL" and nothing says why.
   */
  const hosts = new Set<string>()
  const refused: string[] = []
  for (const g of gifs) {
    for (const raw of urlsOf(g)) {
      let host: string
      try {
        host = new URL(raw).hostname
      } catch {
        refused.push(raw)
        continue
      }
      hosts.add(host)
      if (!importableHost(host)) refused.push(raw)
    }
  }
  check('every URL is on a host the import accepts', refused.length === 0,
    refused.slice(0, 3))
  console.log(`       hosts seen: ${[...hosts].join(', ')}`)
}

/*
 * And then actually fetch one, because a URL that parses is not the same as
 * a file that arrives as a type the import will store.
 */
async function fetchable(what: string, url: string, storable: boolean): Promise<void> {
  if (!url) return check(`there is a ${what} to fetch`, false)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim()
    check(`the ${what} fetches`, res.ok, `${res.status} ${type}`)
    /*
     * Only the file that would actually be sent has to be storable. The tile
     * in the grid is a picture the browser draws and nothing more - it is
     * webp in practice, which the import refuses and correctly never sees.
     */
    if (storable) {
      check(`and the ${what} is a type the import stores`,
        type === 'image/gif' || type === 'video/mp4', type)
    }
  } catch (err) {
    check(`the ${what} fetches`, false, String(err))
  }
}

const trending = await trendingGifs(24, 0)
await look('trending', trending)

const found = await searchGifs('cat', 24, 0)
await look('search for "cat"', found)

console.log('  --- and one really downloads ---')
const sample = found[0] ?? trending[0]
if (!sample) {
  check('there was a result to try', false)
} else {
  // Exactly what picking it would send: the client sends `mp4 || preview`.
  await fetchable('file that would be sent', sample.mp4 || sample.preview, true)
  await fetchable('tile in the grid', sample.preview, false)
}

/*
 * The rule the mapper exists to keep: a result with no mp4 must offer a GIF
 * rather than a webp, because on that result the preview is what gets sent
 * and the import stores image/gif and video/mp4 and nothing else.
 *
 * Counted rather than asserted blind. Everything KLIPY returned today has an
 * mp4, so an assertion here would pass without testing anything - which is
 * worth knowing rather than being quietly reassured by.
 */
const silent = [...trending, ...found].filter((g) => !g.mp4)
console.log(`  --- results with no mp4: ${silent.length} ---`)
if (silent.length === 0) {
  console.log('       (none today, so the fallback is untested against the live API)')
} else {
  await fetchable('fallback for a result with no mp4', silent[0]!.preview, true)
}

/*
 * Paging, because KLIPY takes a page number where GIPHY takes an offset and
 * the conversion is arithmetic that nothing else checks.
 */
console.log('  --- and page two is a different page ---')
const second = await searchGifs('cat', 24, 24)
const first = new Set(found.map((g) => g.id))
const fresh = second.filter((g) => !first.has(g.id)).length
check('page two came back', second.length > 0, second.length)
check('and is mostly not page one again', fresh > second.length / 2,
  `${fresh}/${second.length} new`)

console.log(bad === 0 ? '\n  all good\n' : `\n  ${bad} FAILED\n`)
process.exit(bad === 0 ? 0 : 1)
