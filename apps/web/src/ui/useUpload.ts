import { useCallback, useState } from 'react'
import { importGif, sendableUrl, type Gif } from '../lib/gifs'
import type { Api } from '../lib/api'
import type { OutgoingAttachment } from '../lib/wire'
import { shrinkForUpload, thumbFor } from '../lib/shrinkimage'

/** What the server will take, and what it will not. */
/**
 * What this server takes, said here so somebody is told before the wait.
 *
 * It has to be the server's list and it was not. This refused video and PDF,
 * which the server accepts - so a video could arrive in a channel from
 * somewhere else and be played, and could not be attached from here. And it
 * offered avif and bmp, which the server does not take, so choosing one got
 * as far as the upload and came back refused.
 *
 * The server's list is in ALLOWED_MIME in its index.ts. These two have to
 * agree, and a test says so rather than trusting that they do.
 */
const ALLOWED = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm',
  'application/pdf',
])
/** Said here as well as by the server, so somebody is told before the wait. */
const MAX_BYTES = 12_000_000

export type Pending = OutgoingAttachment & { preview: string }

/**
 * A picture on its way into a message.
 *
 * Two steps, and the second one is where this went wrong before. The bytes go
 * up on their own and the server answers with a *signed* url; that whole
 * string then goes on the message under the key `url`. The old client sent it
 * as `path`, and the server's check is `if (!f?.url) continue` — so the
 * attachment was not refused, it was skipped. The message arrived perfectly
 * and the picture was simply not in it, with nothing said anywhere.
 *
 * Refused before the wait rather than after it. A file the server will not
 * take is worth saying so about immediately, not once the bytes have gone up
 * and come back as an error.
 */
export function useUpload(server: Api) {
  const [pending, setPending] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const add = useCallback(async (file: File) => {
    setError('')
    if (!ALLOWED.has(file.type)) {
      setError(`${file.type || 'That kind of file'} is not one this server takes.`)
      return
    }
    if (file.size > MAX_BYTES) {
      setError('That file is very large — try a smaller one.')
      return
    }

    setBusy(true)
    try {
      /*
       * Made the size it is actually looked at, before it goes.
       *
       * The saving lands three times over, which is why it happens here
       * rather than on the server: the sender's own upstream carries a tenth
       * as much, the disk holds a tenth as much, and everybody who scrolls
       * past it downloads a tenth as much - and the server needs no image
       * library, no CPU and no change at all.
       *
       * Never a reason not to send something: anything it cannot decode, or
       * that does not come out meaningfully smaller, goes exactly as it was.
       * A GIF is refused outright - a canvas draws one frame of one, so
       * shrinking it would quietly turn an animation into a picture of its
       * first moment.
       */
      const sending = await shrinkForUpload(file)
      const got = await server.upload(sending, sending.name)

      /*
       * And a small copy, for the size it is drawn at.
       *
       * Sent after the picture rather than instead of it, and allowed to
       * fail: a thumbnail that does not arrive costs everybody a larger
       * download and nothing else, so it must never be the reason a message
       * cannot be sent. A GIF gets none - a canvas draws one frame of one.
       */
      let thumb: string | undefined
      try {
        const small = await thumbFor(sending)
        if (small) thumb = (await server.upload(small, small.name)).url
      } catch {
        /* No thumbnail. The picture goes as it is. */
      }

      setPending((list) => [...list, {
        /* Exactly as it was handed back. The server takes the stored name off
           it itself, and a signature that has been trimmed is a file the
           server no longer recognises as one you uploaded. */
        url: got.url,
        filename: sending.name,
        is_gif: sending.type === 'image/gif',
        ...(thumb ? { thumb } : {}),
        preview: URL.createObjectURL(sending),
      }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That would not upload.')
    } finally {
      setBusy(false)
    }
  }, [server])

  /**
   * A GIF from the panel, which is somebody else's file until this server has
   * a copy of it.
   *
   * Imported rather than attached by its address. The send path checks every
   * attachment against the ledger written when a file was uploaded here, and
   * a provider URL has no row there — so the message is not sent without the
   * picture, it is refused entirely. That is what picking a GIF did in the
   * client this replaces: it said nothing and sent nothing.
   */
  const addGif = useCallback(async (g: Gif) => {
    setError('')
    setBusy(true)
    try {
      const file = await importGif(server, g)
      setPending((list) => [...list, {
        url: file.url,
        filename: file.filename,
        is_gif: true,
        /* The provider's own copy, shown while it waits — the stored one is
           already on its way and this saves fetching the same picture twice
           to look at it. */
        preview: sendableUrl(g),
      }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That GIF would not save here.')
    } finally {
      setBusy(false)
    }
  }, [server])

  const remove = useCallback((url: string) => {
    setPending((list) => {
      /* The preview was a handle on the file's bytes; letting go of the last
         one is what lets the browser forget them. */
      const going = list.find((p) => p.url === url)
      if (going) URL.revokeObjectURL(going.preview)
      return list.filter((p) => p.url !== url)
    })
  }, [])

  const clear = useCallback(() => {
    setPending((list) => {
      for (const p of list) URL.revokeObjectURL(p.preview)
      return []
    })
  }, [])

  /** What goes on the message, without the preview, which is ours alone. */
  const attachments = useCallback(
    (): OutgoingAttachment[] =>
      /* `is_gif` is left off rather than sent as undefined. It decides
         whether a filename is drawn under the picture and nothing else, and
         "absent" and "present but undefined" are different things to a server
         reading its own field. */
      pending.map(({ url, filename, is_gif, thumb }) => ({
        url,
        filename,
        ...(is_gif ? { is_gif: true } : {}),
        /* Left off entirely when there is none, for the same reason is_gif
           is: absent and present-but-undefined are different things to a
           server reading its own field. */
        ...(thumb ? { thumb } : {}),
      })),
    [pending],
  )

  return {
    pending, busy, error, add, addGif, remove, clear, attachments,
    clearError: () => setError(''),
  }
}
