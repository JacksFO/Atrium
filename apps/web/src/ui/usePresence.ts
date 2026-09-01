import { useEffect } from 'react'
import { publishArt, publishPixels } from '../lib/artwork'
import { shell } from '../lib/shell'
import type { Api } from '../lib/api'
import type { Activity } from '../lib/wire'

/**
 * Tell the shell to watch, and pass on what it sees.
 *
 * Every other part of this was already built. The desktop shell reads what is
 * playing and what is running, matches it and hands up a finished line; the
 * server takes an activity frame and tells everybody who may see this person;
 * the client keeps them, formats them and has a card to draw them on. Nothing
 * joined the two ends, so rich presence was complete at both and connected in
 * the middle by nothing at all.
 *
 * The switches live on this machine, so this is the only thing that knows
 * whether to look - and it asks again whenever they change, which is what
 * turning one off has to mean: the shell stops reading and says so once,
 * rather than going quiet and leaving somebody shown as playing whatever they
 * last played.
 *
 * What arrives is already the finished line. The shell did the matching, so
 * nothing here has ever seen the list of what is running.
 */
/**
 * How long to let the app settle before asking the shell to start looking.
 *
 * Long enough to be past the load, short enough that nobody waits for it.
 */
const SETTLE_MS = 3_000

export function usePresence(
  server: Api,
  send: (frame: { t: 'activity'; activities: Activity[] }) => void,
  want: { game: boolean; music: boolean },
) {
  const { game, music } = want

  useEffect(() => {
    const bridge = shell()
    if (!bridge?.watchActivity || !bridge.onActivity) return

    let gone = false

    bridge.onActivity((incoming) => {
      /*
       * The cover is redrawn small, put somewhere, and named.
       *
       * What Windows hands over is whatever the player felt like providing -
       * Spotify's is a 211KB PNG - and sending that to everybody who can see
       * this person, on every track change, is most of a gigabyte an hour at
       * a hundred people, almost all of it for profiles nobody opens.
       *
       * So it goes up once and its name goes out instead, and only somebody
       * who actually looks at a profile fetches the picture. A cover that
       * will not redraw or will not upload is dropped: the card is fine
       * without one, and a name pointing at nothing is a broken image where
       * a tidy blank belongs.
       */
      void (async () => {
        const list = (incoming as Activity[] | null) ?? []
        const ready = await Promise.all(list.map(async (raw) => {
          /* A cover arrives as a data URI and a game's icon as raw pixels,
             because the shell has a media stream for one and a bitmap for the
             other. Both leave here as a name. */
          const { artPixels, ...a } = raw as Activity & {
            artPixels?: { width: number; height: number; rgba: Uint8Array }
          }
          if (artPixels) {
            const name = await publishPixels(
              server, artPixels.width, artPixels.height, new Uint8Array(artPixels.rgba))
            return name ? { ...a, art: name } : a
          }
          if (!a.art) return a
          const name = await publishArt(server, a.art)
          return name ? { ...a, art: name } : { ...a, art: undefined }
        }))
        /* The switches may have gone off while a cover was uploading. */
        if (!gone) send({ t: 'activity', activities: ready as Activity[] })
      })()
    })

    /*
     * Not during the load.
     *
     * Starting the watch makes the shell go and look, and looking is not
     * cheap in the app it runs on: reading a track's artwork is measured
     * at 424ms against 4ms without it, and a full look round the process list
     * at 4.7ms - both synchronous, both in the main process, which is the
     * process that also routes this window's input.
     *
     * Reloading tore the watch down and started it again, so that cost landed
     * exactly while somebody was waiting for the app to come back. The window
     * went unresponsive while its animations carried on, because those are
     * composited and the main process was busy. Reported as the desktop app
     * freezing on reload while a GIF avatar kept moving - and not happening
     * in a browser, which has no shell to be busy.
     *
     * A few seconds later costs nothing: this reports what somebody is doing
     * for as long as the app is open, and the first report being three
     * seconds late is not a thing anybody can notice.
     */
    const start = window.setTimeout(() => {
      void bridge.watchActivity?.({ game, music })
    }, SETTLE_MS)

    return () => {
      window.clearTimeout(start)
      gone = true
      /* Said out loud rather than simply stopping, so nobody is left shown as
         playing something they closed an hour ago. */
      void bridge.watchActivity?.({ game: false, music: false })
    }
  }, [server, send, game, music])
}
