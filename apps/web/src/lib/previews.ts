import type { Api } from './api'

/**
 * What a link turns out to be.
 *
 * Fetched through this server, which reads only the head of the page and
 * never lets the address it was given reach the local network — and which
 * means the site is never told who is looking, the same reason pictures go
 * through the media proxy.
 */

export type Preview = {
  url: string
  title: string
  description: string
  image: string
  site: string
  /** A still of a video with no way to play it is not a preview of a video. */
  video: string
  videoType: string
  videoWidth: number
  videoHeight: number
  /** The colour the site says it is, for the stripe down the side. */
  accent: string
}

/**
 * Asked once per address, however many messages mention it.
 *
 * A channel where somebody pasted the same link four times is one request,
 * not four — and a re-render is none, which matters because the list redraws
 * every time anybody types. Held for the life of the page: the server caches
 * these itself with its own lifetime, and a second cache with a second
 * lifetime is two answers to when something is stale.
 */
const asked = new Map<string, Promise<Preview | null>>()

export function previewOf(server: Api, url: string): Promise<Preview | null> {
  const known = asked.get(url)
  if (known) return known

  /* The route answers `{ preview: ... }`, and this read the fields straight
     off the response. `r.title` was therefore always undefined, so every link
     came back as nothing and no card was ever drawn — with both ends working
     perfectly and the server's answer correct. */
  const going = server
    .get<{ preview?: Partial<Preview> | null }>(
      `/api/preview?url=${encodeURIComponent(url)}`,
    )
    .then((r) => {
      const p = r?.preview
      return p && (p.title || p.image || p.video) ? shape(p) : null
    })
    .catch(() => null)

  asked.set(url, going)
  return going
}

/** For a test, and for signing out — nothing should outlive an account. */
export function forgetPreviews(): void {
  asked.clear()
}

const shape = (r: Partial<Preview>): Preview => ({
  url: String(r.url ?? ''),
  title: String(r.title ?? ''),
  description: String(r.description ?? ''),
  image: String(r.image ?? ''),
  site: String(r.site ?? ''),
  video: String(r.video ?? ''),
  videoType: String(r.videoType ?? ''),
  videoWidth: Number(r.videoWidth) || 0,
  videoHeight: Number(r.videoHeight) || 0,
  accent: String(r.accent ?? ''),
})

/**
 * Whether a link is a picture in its own right.
 *
 * Then it is shown as itself rather than as a card describing it — a card
 * whose picture is the whole of what it describes is a picture with a caption
 * saying "picture".
 */
/*
 * Not svg, deliberately.
 *
 * An SVG in an <img> tag cannot run script - that much is true and is why
 * this used to include it. What changed is that a linked picture is now
 * fetched through this server and handed to the tag as a blob url made by
 * our own origin. The tag is still safe; a person is not. Right-click, open
 * image in a new tab, and the browser renders it as a *document* - and a
 * blob url opened that way inherits the origin that created it. Script
 * inside the file then runs on Atrium's origin, holding the session.
 *
 * The media proxy already refuses image/svg+xml, so the two now agree
 * rather than one offering what the other will not serve. An SVG link is a
 * link, or a card if the page has one.
 */
const IMAGE_KIND = /^(png|jpe?g|gif|webp|avif|bmp)$/

/*
 * Parameters that name what the thing *is*, not where something else lives.
 *
 * The difference matters and is the whole reason this is a list rather than
 * a search of the query string: `?format=jpg` says this address is a jpeg,
 * while `?to=a.png` says the page will send you to one, and treating the
 * second as a picture would draw a broken image where a card belonged.
 */
const KIND_KEYS = ['format', 'fm']

export function looksLikeImage(url: string): boolean {
  try {
    const at = new URL(url)
    if (/\.(png|jpe?g|gif|webp|avif|bmp)$/.test(at.pathname.toLowerCase())) return true
    /*
     * Some hosts keep the type in the query and leave the path bare.
     *
     * Twitter's image CDN is the one that turned up: the address of a
     * picture posted there is /media/<id>?format=jpg&name=large, with no
     * extension anywhere in the path. Asking only the path meant a linked
     * picture came out as a bare link with nothing to look at - and there
     * was no card either, because the address answers with a jpeg rather
     * than a page with anything to read off it.
     */
    for (const key of KIND_KEYS) {
      const said = at.searchParams.get(key)
      if (said && IMAGE_KIND.test(said.toLowerCase())) return true
    }
    return false
  } catch {
    /* Not an address at all, which the renderer will have left as words. */
    return false
  }
}
