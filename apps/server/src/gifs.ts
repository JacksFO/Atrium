import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { resolve } from 'node:path'
import { config } from './config.js'

export type Gif = {
  id: string
  /** Animated. What the picker shows, so a GIF looks like a GIF. */
  preview: string
  /** A single frame, used as the poster while the animation loads. */
  still: string
  /** Far cheaper to play than an animated GIF, and preferred when present. */
  mp4: string
  width: number
  height: number
  description: string
}

/**
 * GIF search, proxied.
 *
 * The API key stays on the server, and members' IP addresses are never
 * exposed to the provider — the same reason link previews go through the
 * media proxy rather than being fetched by the client.
 */
export function gifProvider(): 'klipy' | 'giphy' | null {
  if (config.klipyKey) return 'klipy'
  if (config.giphyKey) return 'giphy'
  return null
}

/**
 * Is this a URL one of the providers actually gave us?
 *
 * The point of the whole feature is that the server fetches the picture and
 * keeps its own copy - hotlinking would hand every viewer's address to GIPHY
 * on every render, which is the same reason link previews and images go
 * through the proxy.
 *
 * But "the server fetches a URL the client named" is server-side request
 * forgery written out longhand: without this, a member could point it at the
 * router on the far side of the firewall, or at anything else only this
 * machine can reach, and read the answer back out of their own avatar.
 *
 * So: https only, and a host belonging to a provider. Matched on the whole
 * label rather than with endsWith, because "evil-giphy.com" ends with
 * "giphy.com" and "giphy.com.attacker.net" begins with it.
 */
const GIF_HOSTS = ['klipy.com', 'giphy.com']

export function isProviderUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return GIF_HOSTS.some((h) => host === h || host.endsWith('.' + h))
}

/**
 * Search results, remembered for an hour.
 *
 * The picker spends a provider call per search and another per scroll, and
 * nothing was remembered between them - so ten people searching "cat" cost
 * ten calls for one answer. That matters because a test key is **100 calls an
 * hour for the whole app**, on KLIPY and on GIPHY alike, while the per-person
 * guard on the route allows sixty a minute. One person could spend the
 * entire hourly budget in under two minutes and the picker would then simply
 * stop working for everybody until the hour turned over.
 *
 * A small group searches the same handful of things, so this collapses most
 * of that. In memory and bounded: it is a saving, not a store, and it must
 * not become the largest thing in the process.
 */
const CACHE_TTL_MS = 60 * 60_000
const CACHE_MAX = 300
const searches = new Map<string, { at: number; gifs: Gif[] }>()

function cached(key: string): Gif[] | null {
  const hit = searches.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    searches.delete(key)
    return null
  }
  return hit.gifs
}

function remember(key: string, gifs: Gif[]): void {
  // Nothing is worth remembering about a search that found nothing; the next
  // person asking should get a real answer rather than an hour-old blank.
  if (gifs.length === 0) return
  searches.set(key, { at: Date.now(), gifs })
  // Map keeps insertion order, so the first key is the oldest written.
  while (searches.size > CACHE_MAX) {
    const oldest = searches.keys().next().value
    if (oldest === undefined) break
    searches.delete(oldest)
  }
}

/** Only for the tests, which must not inherit an answer from each other. */
export function forgetSearches(): void {
  searches.clear()
}

/**
 * The provider's budget, respected rather than discovered.
 *
 * A KLIPY test key is 100 calls an hour for the whole server, and a GIPHY
 * beta key is the same. The cache above removes the repeats; this is for the
 * rest, because a hundred *different* searches in an hour is reachable by one
 * bored person on a Friday night and the failure is silent: the provider
 * simply starts refusing, and the picker is broken for everybody until the
 * hour turns over with nothing saying why.
 *
 * Ninety rather than a hundred. Their window and this one do not start at the
 * same moment, so the two counts drift; stopping early is a worse search and
 * being refused is a broken one.
 *
 * A rolling hour rather than a fixed one, so the budget cannot be spent twice
 * either side of a boundary.
 *
 * Configurable, and that is the point rather than a nicety. Production access
 * is unlimited, so a hard ninety would stop being a protection the moment it
 * was granted and become the only thing left rationing GIFs - a limit nobody
 * put there on purpose, enforced by code whose comment says it is protecting
 * a limit that no longer exists. GIF_CALLS_PER_HOUR=0 lifts it.
 */
const HOURLY_CALLS = config.gifCallsPerHour
const HOUR_MS = 60 * 60_000
const spent: number[] = []

/** Thrown so the route can say something true rather than "unavailable". */
export const OVER_BUDGET = 'over the hourly GIF budget'

function spend(): void {
  if (!(HOURLY_CALLS > 0)) return
  const now = Date.now()
  while (spent.length > 0 && now - spent[0]! > HOUR_MS) spent.shift()
  if (spent.length >= HOURLY_CALLS) throw new Error(OVER_BUDGET)
  spent.push(now)
}

/** Only for the tests. */
export function forgetBudget(): void {
  spent.length = 0
}

type Media = { url?: string; width?: number; height?: number }

/**
 * KLIPY hands back one object per size, each holding one object per format:
 * `file.md.mp4.url`, `file.xs.jpg.url`, and so on. Some responses put the
 * formats straight on `file` with no size in between, so both are tried.
 *
 * Sizes are asked for smallest-usable-first. The picker draws a tile about a
 * hundred pixels tall and there is no sense pulling an HD copy for it.
 */
function klipyPick(file: unknown, format: string, sizes: string[]): Media | null {
  const box = file as Record<string, Record<string, Media> | undefined> | undefined
  for (const size of sizes) {
    const found = box?.[size]?.[format]
    if (found?.url) return found
  }
  const flat = (file as Record<string, Media> | undefined)?.[format]
  return flat?.url ? flat : null
}

const KLIPY_SIZES = ['md', 'sm', 'hd', 'xs']
const KLIPY_STILLS = ['xs', 'sm', 'md']

function klipyGif(row: Record<string, unknown>): Gif {
  const file = row.file ?? row.files
  const mp4 = klipyPick(file, 'mp4', KLIPY_SIZES)
  const gif = klipyPick(file, 'gif', KLIPY_SIZES)
  const webp = klipyPick(file, 'webp', KLIPY_SIZES)

  /*
   * webp is the same animation at a fraction of the bytes, so the picker
   * prefers it - but only when there is an mp4 to send.
   *
   * Picking a GIF sends `mp4 || preview` to the import, and the import stores
   * image/gif and video/mp4 and nothing else. So when a result has no mp4,
   * the preview *is* what gets imported, and choosing webp there would make
   * a tile that looks fine and refuses to send.
   */
  const preview = mp4 ? (webp ?? gif) : (gif ?? webp)
  const shape = mp4 ?? preview

  return {
    id: String(row.id ?? row.slug ?? ''),
    preview: String(preview?.url ?? ''),
    still: String(klipyPick(file, 'jpg', KLIPY_STILLS)?.url ?? ''),
    mp4: String(mp4?.url ?? ''),
    width: Number(shape?.width ?? 200),
    height: Number(shape?.height ?? 200),
    description: String(row.title ?? row.slug ?? 'GIF'),
  }
}

/**
 * KLIPY pages rather than taking an offset, and caps a page at 50.
 *
 * The client asks for "everything after the N already on screen", which is
 * the shape GIPHY takes directly. Dividing is exact while the page size does
 * not change mid-scroll, and the picker already drops any result it is
 * showing twice, so a seam costs a slightly short page rather than a repeat.
 */
async function klipyGifs(path: string, query: string, limit: number, offset: number): Promise<Gif[]> {
  const perPage = Math.min(Math.max(limit, 8), 50)
  const page = Math.floor(offset / perPage) + 1

  // The key is a path segment, not a parameter - encoded so a malformed one
  // cannot walk out of its own segment.
  const url = new URL(
    `https://api.klipy.com/api/v1/${encodeURIComponent(config.klipyKey)}/gifs/${path}`
  )
  if (query) url.searchParams.set('q', query)
  url.searchParams.set('per_page', String(perPage))
  url.searchParams.set('page', String(page))
  // Same ceiling the GIPHY branch asks for, and KLIPY spells it the same way.
  url.searchParams.set('rating', 'pg-13')

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`klipy responded ${res.status}`)
  return klipyResults(await res.json())
}

/**
 * A parsed KLIPY answer, turned into what the picker draws.
 *
 * Separate from the request so it can be tested against a fixture. This
 * mapping was written from KLIPY's published shape and from working code
 * using it, not from a live call against our own key — which makes it the
 * part most likely to be subtly wrong, and therefore the part worth pinning
 * down. `pnpm test:gifs:live` checks it against the real API once a key
 * exists.
 *
 * The results are at data.data. Some endpoints answer with the array
 * directly at data, so both are accepted rather than showing an empty picker
 * if that ever differs.
 */
export function klipyResults(body: unknown): Gif[] {
  const inner = (body as { data?: unknown } | undefined)?.data
  const rows = Array.isArray(inner)
    ? inner
    : Array.isArray((inner as { data?: unknown } | undefined)?.data)
      ? ((inner as { data: unknown[] }).data)
      : []

  return (rows as Record<string, unknown>[])
    .filter((r) => r && typeof r === 'object')
    .map(klipyGif)
    .filter((g) => g.id && (g.mp4 || g.preview))
}

export async function searchGifs(query: string, limit = 48, offset = 0): Promise<Gif[]> {
  const provider = gifProvider()
  if (!provider) return []

  const key = `${provider}:search:${query}:${limit}:${offset}`
  const known = cached(key)
  if (known) return known

  /*
   * After the cache, deliberately. A search somebody has already made costs
   * nothing and must keep working when the budget is gone - that is the whole
   * point of remembering them.
   */
  spend()
  const gifs = await fetchSearch(provider, query, limit, offset)
  remember(key, gifs)
  return gifs
}

async function fetchSearch(
  provider: 'klipy' | 'giphy', query: string, limit: number, offset: number,
): Promise<Gif[]> {
  if (provider === 'klipy') return klipyGifs('search', query, limit, offset)

  const url = new URL('https://api.giphy.com/v1/gifs/search')
  url.searchParams.set('q', query)
  url.searchParams.set('api_key', config.giphyKey)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('rating', 'pg-13')
  if (offset) url.searchParams.set('offset', String(offset))

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`giphy responded ${res.status}`)
  const data = (await res.json()) as any

  return (data.data ?? []).map((r: any): Gif => {
    const images = r.images ?? {}
    const video = images.fixed_height_small ?? images.fixed_height ?? {}
    return {
      id: String(r.id),
      // The animated rendition. This used to point at *_still, which is
      // exactly one frame - which is why every result sat there motionless.
      // webp first: same animation, a fraction of the bytes of a GIF.
      preview: String(video.webp ?? video.url ?? images.fixed_height?.url ?? ''),
      still: String(images.fixed_height_small_still?.url ?? images.fixed_height_still?.url ?? ''),
      mp4: String(video.mp4 ?? images.original_mp4?.mp4 ?? ''),
      width: Number(video.width ?? 200),
      height: Number(video.height ?? 200),
      description: String(r.title ?? 'GIF'),
    }
  }).filter((g: Gif) => g.mp4 || g.preview)
}

export async function trendingGifs(limit = 48, offset = 0): Promise<Gif[]> {
  const provider = gifProvider()
  if (!provider) return []

  const key = `${provider}:trending:${limit}:${offset}`
  const known = cached(key)
  if (known) return known

  /*
   * KLIPY has a trending endpoint of its own. GIPHY's is a separate route
   * that takes no query, and searching for the word instead has been what
   * this did since it was written - left alone, because it works and GIPHY is
   * now the fallback rather than the provider.
   */
  spend()
  const gifs = provider === 'klipy'
    ? await klipyGifs('trending', '', limit, offset)
    : await fetchSearch('giphy', 'trending', limit, offset)

  remember(key, gifs)
  return gifs
}

/*
 * The CDNs the import is willing to fetch from.
 *
 * GIPHY's are listed one at a time because they are a known, closed set of
 * numbered hosts. KLIPY's are not published anywhere, so they are matched by
 * domain instead - by whole label, so "klipy.com.attacker.net" is not a
 * KLIPY host and neither is "notklipy.com".
 *
 * That is the same boundary isProviderUrl already draws, and it is the
 * boundary that matters: the risk this guards against is the server being
 * pointed at something only the server can reach, and no name under
 * klipy.com is that. Guessing at "media.klipy.com" would have been tighter
 * on paper and wrong in practice the first time somebody picked a GIF - the
 * live check says everything actually comes from static.klipy.com. That is
 * one observed host on one day rather than a published list, which is why it
 * is written here as a note and not as the rule.
 */
const ALLOWED_HOSTS = new Set([
  'media.giphy.com',
  'i.giphy.com', 'media0.giphy.com', 'media1.giphy.com', 'media2.giphy.com',
  'media3.giphy.com', 'media4.giphy.com',
])

const ALLOWED_DOMAINS = ['klipy.com']

export function importableHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (ALLOWED_HOSTS.has(host)) return true
  return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith('.' + d))
}

/**
 * Copy a chosen GIF onto this server and return it as a normal attachment.
 *
 * Storing it rather than hotlinking means the GIF still works if the provider
 * goes away, no member's IP is ever sent to the provider, and it behaves
 * identically to an uploaded file everywhere else in the app.
 */
/**
 * A filename from the GIF's own title.
 *
 * Every imported GIF used to be called "gif.mp4", which is unhelpful the
 * moment there is more than one in a channel - they are indistinguishable in
 * the attachment list and in a downloads folder.
 */
function gifFilename(title: string, ext: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${slug || 'gif'}${ext}`
}

export async function importGif(remoteUrl: string, title = ''): Promise<{
  id: string; url: string; filename: string; mime: string; bytes: number; isGif: true
}> {
  const parsed = new URL(remoteUrl)

  // Only the providers' own CDNs. Without this the endpoint is an open proxy
  // that would happily fetch anything on the local network.
  if (parsed.protocol !== 'https:' || !importableHost(parsed.hostname)) {
    throw new Error('that is not a GIF provider URL')
  }

  /*
   * The database is reached for here rather than at the top of the file.
   *
   * Importing db.js opens the database and runs the migrations as a side
   * effect of the import itself. Everything else in here is a pure function
   * over a URL - which is what gifs.test.ts checks, and it is the check that
   * decides whether this server will fetch from an address somebody hands it.
   * A module-level import took that whole file out of the run: it reported
   * "0 tests" and a failure to resolve node:sqlite, and the open-proxy guard
   * stopped being tested without anybody being told.
   */
  const { db } = await import('./db.js')

  /*
   * Already here? Then nothing needs fetching, hashing or writing.
   *
   * The file is checked rather than trusted: a row pointing at something the
   * sweeper has taken away would otherwise hand out a broken picture for
   * ever, where fetching it again costs one download.
   */
  const known = db
    .prepare('SELECT stored, mime, bytes FROM gif_imports WHERE remote_url = ?')
    .get(remoteUrl) as unknown as { stored: string; mime: string; bytes: number } | undefined
  if (known && existsSync(resolve(config.uploadDir, known.stored))) {
    return {
      id: randomUUID(),
      url: `/uploads/${known.stored}`,
      filename: gifFilename(title, known.stored.slice(known.stored.lastIndexOf('.'))),
      mime: known.mime,
      bytes: known.bytes,
      isGif: true,
    }
  }

  const res = await fetch(parsed, { signal: AbortSignal.timeout(15000) })
  if (!res.ok || !res.body) throw new Error(`could not fetch the GIF (${res.status})`)

  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim()
  const ext = type === 'video/mp4' ? '.mp4' : type === 'image/gif' ? '.gif' : null
  if (!ext) throw new Error(`unexpected GIF type: ${type || 'unknown'}`)

  /*
   * Named after its own contents, so the same GIF is only ever stored once.
   *
   * Every send used to write a fresh copy under a fresh uuid. Nobody had sent
   * a duplicate yet when this was measured - four GIFs on disk, four distinct
   * - but they average 1.28 MB here and a group of friends reuses the same
   * handful constantly, so it was a bill that had not arrived rather than one
   * that was not coming.
   *
   * Written under a temporary name first: the hash is only known once the
   * last byte has arrived, and a half-downloaded file must never be sitting
   * at the name a later send would take as proof the GIF is already here.
   */
  const digest = createHash('sha256')
  const temp = resolve(config.uploadDir, `.importing-${randomUUID()}${ext}`)

  let bytes = 0
  const source = Readable.fromWeb(res.body as never)
  source.on('data', (chunk: Buffer) => { bytes += chunk.length; digest.update(chunk) })

  try {
    await pipeline(source, createWriteStream(temp))
  } catch {
    await unlink(temp).catch(() => {})
    throw new Error('could not save the GIF')
  }

  if (bytes > config.maxUploadBytes) {
    await unlink(temp).catch(() => {})
    throw new Error('that GIF is larger than the server allows')
  }

  const stored = `${digest.digest('hex').slice(0, 32)}${ext}`
  const target = resolve(config.uploadDir, stored)

  if (existsSync(target)) {
    // Already here, byte for byte. Nothing to keep.
    await unlink(temp).catch(() => {})
  } else {
    await rename(temp, target).catch(async () => {
      await unlink(temp).catch(() => {})
      throw new Error('could not save the GIF')
    })
  }

  db.prepare(
    `INSERT INTO gif_imports (remote_url, stored, mime, bytes, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(remote_url) DO UPDATE SET stored = excluded.stored,
       mime = excluded.mime, bytes = excluded.bytes`
  ).run(remoteUrl, stored, type, bytes, Date.now())

  /*
   * A fresh id even when the file is not fresh. The id is the attachment
   * row's primary key rather than the file's name, and two messages showing
   * the same GIF are still two attachments.
   */
  return {
    id: randomUUID(),
    url: `/uploads/${stored}`,
    filename: gifFilename(title, ext),
    mime: type,
    bytes,
    isGif: true,
  }
}
