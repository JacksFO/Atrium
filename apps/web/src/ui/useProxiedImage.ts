import { useEffect, useState } from 'react'
import type { Api } from '../lib/api'

/**
 * A linked picture, fetched by the server rather than by whoever is reading.
 *
 * Showing a linked image inline is the obvious feature and the obvious leak:
 * every person who scrolls past it fetches it themselves, so whoever posted
 * the link learns the IP address of everyone in the channel. On a private
 * server among friends that is an unpleasant thing to be able to do by
 * pasting a URL.
 *
 * `/api/media` has existed for exactly this since the proxy was written -
 * https only, image types only, size and time capped, redirects followed by
 * hand with every hop checked against the private ranges. Nothing ever called
 * it, because an <img src> cannot send an Authorization header and the route
 * requires one, so every linked picture was still being hotlinked.
 *
 * So the fetch happens here, where the token is, and the tag is handed an
 * object URL. The underlying GET is still cached by the browser - the route
 * answers with a day of cache-control - so scrolling past the same picture
 * twice does not fetch it twice.
 */
export function useProxiedImage(server: Api, url: string, on = true): {
  /** What to put in the tag: the object URL, or the original when not proxying. */
  src: string
  /** The server would not fetch it. The caller shows the link instead. */
  failed: boolean
} {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!on) return
    let alive = true
    let made = ''
    setFailed(false)
    setSrc('')

    void server.bytes(`/api/media?url=${encodeURIComponent(url)}`)
      .then((blob) => {
        if (!alive) return
        made = URL.createObjectURL(blob)
        setSrc(made)
      })
      .catch(() => { if (alive) setFailed(true) })

    return () => {
      alive = false
      /* Or every picture scrolled past stays in memory until the tab is
         closed, which on a busy channel is most of a gigabyte. */
      if (made) URL.revokeObjectURL(made)
    }
  }, [server, url, on])

  return { src: on ? src : url, failed }
}
