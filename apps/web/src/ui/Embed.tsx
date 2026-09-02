import { useEffect, useState } from 'react'
import { Lightbox } from './Lightbox'
import { linksIn, safeHref } from '../lib/markdown'
import { looksLikeImage, previewOf, type Preview } from '../lib/previews'
import { useProxiedImage } from './useProxiedImage'
import type { Api } from '../lib/api'

/**
 * What the links in a message turn out to be.
 *
 * A picture is shown as itself; anything else becomes a card, once this
 * server has had a look at it. Nothing is drawn until the answer arrives and
 * nothing is drawn if there is no answer — a card that says only the address
 * it was made from is the address again, in a box.
 */
export function Embeds({ server, body, on }: {
  server: Api
  body: string
  /** Somebody who does not want them gets none, and none are asked for. */
  on: boolean
}) {
  /* At most three. A message that is a list of twenty links is a list, and
     turning it into twenty cards buries whatever was said around them. */
  const links = on ? linksIn(body, 3) : []
  if (links.length === 0) return null

  return (
    <>
      {links.map((url) => (
        looksLikeImage(url)
          ? <BareImage key={url} server={server} url={url} />
          : <Card key={url} server={server} url={url} />
      ))}
    </>
  )
}

function BareImage({ server, url }: { server: Api; url: string }) {
  const [big, setBig] = useState(false)
  const href = safeHref(url)
  /* Through the server, so the host of the picture never sees who is
     reading. The hook is called before the early return because a hook has
     to be. */
  const { src, failed } = useProxiedImage(server, href || '')
  if (!href) return null
  /* It would not fetch: a link is better than a broken picture, and better
     than quietly falling back to fetching it from here, which would be the
     leak this exists to close happening exactly when it is least expected. */
  if (failed) {
    return (
      <a className="bareimglink" href={href} target="_blank" rel="noreferrer noopener">
        {href}
      </a>
    )
  }
  if (!src) return null
  return (
    <>
      {/* A picture somebody linked is a picture, so it opens like one — it
          was a button with no handler, which looks exactly like a control
          that does not work. */}
      <button className="bareimg" onClick={() => setBig(true)}>
        <img src={src} alt="" loading="lazy" />
      </button>
      {big && <Lightbox src={src} alt="" onClose={() => setBig(false)} />}
    </>
  )
}

/**
 * The picture on a preview card, through the server as well.
 *
 * The card's words were always fetched here - that is what the "asked for by
 * this server on your behalf" in Chat settings is about - but its picture was
 * not, so the card leaked exactly what the fetch avoided. A card with no
 * picture is still a card, so a failure here simply draws nothing.
 */
function CardImage({ server, url, title }: { server: Api; url: string; title: string }) {
  const [big, setBig] = useState(false)
  const { src, failed } = useProxiedImage(server, url)
  if (failed || !src) return null
  return (
    <>
      {/*
        * It opens, like every other picture in the app.
        *
        * A card's picture is cropped to the width of the card and 300 pixels
        * tall, which for the thing somebody was actually sent - a map, a
        * screenshot, a chart - is a thumbnail of it and not a look at it. The
        * picture beside it in the same message opens, and the one somebody
        * links on its own opens; this was the only one that did not, and a
        * picture that does nothing when clicked reads as one that is broken
        * rather than one that is small on purpose.
        *
        * The card's own link is still the title, and this is a button, so
        * pressing the picture opens it here rather than sending somebody to
        * the site to find it.
        */}
      <button className="emedia" onClick={() => setBig(true)}>
        {/* Named after the card it is on, the way an attached picture is
            named after its file - a button whose only content is a picture
            with no alt is announced as "button" and nothing else. Empty when
            the card had no title, which is the correct alt for a picture
            that is decoration beside words somebody has already heard. */}
        <img src={src} alt={title} loading="lazy" />
      </button>
      {big && <Lightbox src={src} alt={title} onClose={() => setBig(false)} />}
    </>
  )
}

function Card({ server, url }: { server: Api; url: string }) {
  const [preview, setPreview] = useState<Preview | null>(null)

  useEffect(() => {
    let alive = true
    void previewOf(server, url).then((p) => { if (alive) setPreview(p) })
    return () => { alive = false }
  }, [server, url])

  /*
   * The still behind a video, through the server like every other picture.
   *
   * A poster loads when the card is drawn, not when anybody presses play, so
   * leaving it direct would have leaked on sight the very thing the rest of
   * this stopped leaking. The video itself is still fetched from where it
   * lives - that only happens once somebody deliberately presses play, and
   * the proxy is for images and would be carrying the whole file otherwise.
   *
   * Called unconditionally: hooks cannot sit behind the early returns below.
   */
  const { src: poster } = useProxiedImage(server, preview?.image ?? '', !!preview?.image)

  if (!preview) return null

  /* Where the card points, which is the address the *server* resolved rather
     than the one that was typed — a shortener answers with where it goes, and
     a card that links back to the shortener says nothing about where it ends
     up. Checked all the same: a redirect is still somebody else's string. */
  const href = safeHref(preview.url || url)
  if (!href) return null

  return (
    <div className="embed" style={preview.accent ? { ['--ec' as string]: preview.accent } : undefined}>
      {preview.site && <div className="esite">{preview.site}</div>}
      {preview.title && (
        <a className="etitle" href={href} target="_blank" rel="noopener noreferrer">
          {preview.title}
        </a>
      )}
      {preview.description && <div className="edesc">{preview.description}</div>}

      {preview.video ? (
        /* The shape is known before the video is, so the box holds it before
           anything loads and nothing below it jumps when it arrives. */
        <div
          className="vwrap"
          style={{
            aspectRatio: preview.videoWidth && preview.videoHeight
              ? `${preview.videoWidth} / ${preview.videoHeight}`
              : '16 / 9',
          }}
        >
          <video
            src={preview.video}
            poster={poster || undefined}
            controls
            playsInline
            /* Nothing is fetched until somebody presses play. A channel with
               six links in it should not be six videos being downloaded. */
            preload="none"
          />
        </div>
      ) : preview.image ? (
        <CardImage server={server} url={preview.image} title={preview.title} />
      ) : null}
    </div>
  )
}
