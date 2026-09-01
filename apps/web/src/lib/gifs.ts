import type { Api } from './api'
import type { OutgoingAttachment } from './wire'

/**
 * GIFs, searched through this server and stored by it before they are sent.
 *
 * The search is proxied so the provider's key stays on the server and nobody
 * here has their address handed to it — the same reason link previews go
 * through the media proxy.
 *
 * And a GIF has to be *imported* before it can go on a message. The panel
 * hands back the provider's own CDN address, and the send path checks every
 * attachment against the ledger this server writes when a file is uploaded to
 * it. A provider URL has no row there, so the message is not sent without the
 * picture — it is refused outright, saying the file is not one you uploaded.
 * That is exactly what picking a GIF did in the client this replaces: it said
 * nothing and sent nothing.
 */

export type Gif = {
  id: string
  /** Animated, and what the panel shows: a GIF should look like a GIF. */
  preview: string
  /** One frame, as the poster while the animation loads. */
  still: string
  /** Far cheaper to play than the same thing as a GIF, and preferred. */
  mp4: string
  width: number
  height: number
  description: string
}

export type GifPage = {
  /** Null when this server has no provider configured, which is not an error. */
  provider: 'klipy' | 'giphy' | null
  gifs: Gif[]
  offset: number
}

/** How they must be credited, which both providers require wherever they show. */
export const CREDIT: Record<string, string> = { klipy: 'KLIPY', giphy: 'GIPHY' }

const clean = (g: Partial<Gif>): Gif => ({
  id: String(g.id ?? ''),
  preview: String(g.preview ?? ''),
  still: String(g.still ?? ''),
  mp4: String(g.mp4 ?? ''),
  width: Number(g.width) || 0,
  height: Number(g.height) || 0,
  description: String(g.description ?? ''),
})

/**
 * A page of them: what was searched for, or what is going around today.
 *
 * `offset` rather than a page number, because that is what the route takes —
 * asked without it, every page of a search was the first one and the panel's
 * scroll fetched the same twenty over and over.
 */
export async function searchGifs(
  server: Api, query: string, offset = 0,
): Promise<GifPage> {
  const q = query.trim()
  const r = await server.get<Partial<GifPage> & { gifs?: Partial<Gif>[] }>(
    `/api/gifs?q=${encodeURIComponent(q)}&offset=${offset}`,
  )
  return {
    provider: r.provider ?? null,
    gifs: (r.gifs ?? []).map(clean),
    offset: Number(r.offset) || offset,
  }
}

/**
 * Which of a GIF's addresses to send.
 *
 * The mp4 wherever there is one: it is a fraction of the bytes of the same
 * thing as a GIF and far less to decode, and it is what everything here is
 * built to play. The animated preview is the fallback; a still frame is not
 * one, because a GIF that does not move is not a GIF.
 */
export const sendableUrl = (g: Gif): string => g.mp4 || g.preview || ''

/**
 * The same picture, as an attachment this server can vouch for.
 *
 * Imported first, which is what writes the row the send path looks for. What
 * comes back is an ordinary upload of this server's own, and everything after
 * this point treats it as one.
 */
export async function importGif(server: Api, g: Gif): Promise<OutgoingAttachment> {
  const url = sendableUrl(g)
  if (!url) throw new Error('that GIF has no address to fetch')
  const saved = await server.post<{ url?: string; filename?: string; error?: string }>(
    '/api/gifs/import', { url, description: g.description },
  )
  if (!saved?.url) throw new Error(saved?.error || 'that GIF could not be saved here')
  return { url: saved.url, filename: saved.filename || 'gif', is_gif: true }
}
