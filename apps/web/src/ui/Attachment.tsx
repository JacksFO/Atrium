import { useState } from 'react'
import { usePausedWhenAway } from '../lib/usepaused'
import { Icon } from './Icon'
import type { Attachment as Att } from '../lib/wire'

/**
 * A file somebody sent, drawn as what it is.
 *
 * Everything was an <img>, whatever it was. A video came out as the browser's
 * broken-image icon with its filename beside it - reported as exactly that, a
 * torn page saying cute-baby-monkey-enjoys-milk.mp4 - and so did a sound
 * file, and so did anything else.
 *
 * The mime type has been on the wire all along; nothing read it.
 */

/** In the words somebody would use, not in bytes. */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

export function Attachment({ a, onOpen }: {
  a: Att
  /** Only a picture has anything to open bigger. */
  onOpen: (src: string, alt: string) => void
}) {
  const mime = a.mime || ''
  /*
   * A picture whose file is not there any more.
   *
   * There is one of these on the live server: a message from August whose
   * upload was lost, still shown, still referenced. Pointed at by an <img> it
   * is a torn page with a filename beside it - the same thing an avatar used
   * to do before it learned to draw the generated one instead.
   *
   * A picture cannot be invented, so this says what it was and that it is
   * gone, which is the honest version of the same idea. Only after the
   * browser has actually failed to load it: a slow one must not be written
   * off as missing.
   */
  const [gone, setGone] = useState(false)
  /* Hooks cannot be called inside the branch that needs this, and the branch
     is chosen per attachment - so it is taken here for every one of them and
     used by the one that draws a video. It costs a ref and one listener. */
  const gif = usePausedWhenAway<HTMLVideoElement>()

  if (gone) {
    return (
      <span className="attf attgone">
        <span className="attf-ic"><Icon name="dl" size={16} /></span>
        <span className="attn">{a.filename}<span className="lab">no longer here</span></span>
      </span>
    )
  }

  /*
   * A GIF, whatever it is made of.
   *
   * The providers hand over mp4 rather than an actual .gif - it is a fraction
   * of the size for the same few seconds - so a GIF arrives here as video and
   * has to be drawn as what people mean by the word, not as what it is. No
   * controls, no filename, starts itself, goes round for ever, silent.
   *
   * Before this it was drawn as an <img> pointed at an mp4, which is nothing
   * at all; then as a video player with a scrubber and a filename under it,
   * which is a GIF wearing the wrong clothes. This is the case that has to be
   * asked first, because the answer is not in the mime type.
   */
  if (a.is_gif) {
    return mime.startsWith('video/')
      ? (
        <video className="attgif" src={a.path} ref={gif}
          autoPlay loop muted playsInline preload="metadata" />
      )
      : (
        <button className="att" onClick={() => onOpen(a.path, a.filename)}>
          <img src={a.path} alt={a.filename} loading="lazy" onError={() => setGone(true)} />
        </button>
      )
  }

  if (mime.startsWith('image/')) {
    return (
      <span className="attpic">
        {/*
          * The small copy in the conversation, the whole one when opened.
          *
          * A picture here is drawn a few hundred pixels wide and was fetching
          * the full file to do it - so twenty pictures in a channel was
          * twenty full images downloaded by everybody who scrolled past,
          * every one of them out of the upstream of whoever is hosting.
          *
          * The full picture is still what opens, because that is the moment
          * somebody actually wants it. Anything sent before thumbnails
          * existed, and anything with no sensible small copy, has none - so
          * this falls back to the full one and is merely slower.
          */}
        <button className="att" onClick={() => onOpen(a.path, a.filename)}>
          <img src={a.thumb_path || a.path} alt={a.filename} loading="lazy"
            onError={() => setGone(true)} />
        </button>
        {/*
          * No name, no size, no type.
          *
          * This used to say all three under every picture, on the reasoning
          * that a file somebody picked off their own disk is known to them by
          * its name. Asked for the other way, and the other way is right: a
          * picture in a conversation is the thing itself, and "image.png 27
          * KB" under it is a caption for something that needs no caption.
          *
          * Still said for a file with nothing to show - see the row at the
          * end of this. There the name is all there is to go on, and a
          * download with no name is one nobody can decide about.
          */}
      </span>
    )
  }

  /*
   * Nothing is fetched until somebody presses play. `preload="metadata"` asks
   * for the few bytes that give a length and a first frame, which is what
   * makes the player the right size before it plays - a channel of videos
   * that each downloaded themselves on sight would be somebody's month.
   */
  if (mime.startsWith('video/')) {
    return (
      <div className="attv">
        {/* As with a picture: the player is the thing, and a caption under
            it is words about something already on screen. */}
        <video src={a.path} controls preload="metadata" playsInline />
      </div>
    )
  }

  if (mime.startsWith('audio/')) {
    return (
      <div className="atta">
        <span className="attn">{a.filename}<span className="lab">{fileSize(a.bytes)}</span></span>
        <audio src={a.path} controls preload="metadata" />
      </div>
    )
  }

  /*
   * Anything else is a file, and the honest thing to offer is the file. Named
   * and sized, because both are what somebody decides on before downloading
   * something a stranger sent.
   */
  return (
    <a className="attf" href={a.path} download={a.filename}
      target="_blank" rel="noreferrer noopener">
      <span className="attf-ic"><Icon name="dl" size={16} /></span>
      <span className="attn">{a.filename}<span className="lab">{fileSize(a.bytes)}</span></span>
    </a>
  )
}
