import { useEffect, useRef, useState } from 'react'
import { isWatching, onAttentionChange } from './attention'
import { canAnimate, freeze } from './stillframe'

/**
 * An animated picture, stopped while the window is not being looked at.
 *
 * Reported about an avatar, and then again about somebody else's banner - so
 * this is a hook rather than something living inside one component. Anything
 * that shows a picture somebody chose can hold still the same way.
 *
 * Hand back the ref for the <img> and the src to draw. When the window has
 * somebody's attention that is the picture itself; when it does not, it is a
 * still of the frame that was showing, and the original comes straight back
 * from the browser's cache on return.
 *
 * A picture that cannot animate gets none of this - no listener, no canvas,
 * no second render - which is most of them.
 */
export function useStillWhenAway(path: string | null | undefined, src: string) {
  const img = useRef<HTMLImageElement>(null)
  const [still, setStill] = useState<string | null>(null)
  const animated = canAnimate(path)

  useEffect(() => {
    if (!animated) { setStill(null); return }

    /* A pending "try again when it has loaded", so it can be taken back. */
    let waiting: (() => void) | null = null
    const stopWaiting = () => { waiting?.(); waiting = null }

    const settle = (watching: boolean) => {
      stopWaiting()
      if (watching) { setStill(null); return }
      const el = img.current
      if (!el) return
      /*
       * Taken from the element on screen rather than by loading the file
       * again: it is already decoded, and it is showing the frame somebody
       * would have been looking at.
       */
      const shot = freeze(el)
      if (shot) { setStill(shot); return }

      /*
       * Nothing to copy yet.
       *
       * A profile opened while the app is already in the background mounts
       * its pictures unwatched, and there is no frame to take until they have
       * loaded - so the avatar and the banner on that card went on moving
       * while everything that was already on screen had stopped. Caught by a
       * test that found two stills and one that was not.
       *
       * Nothing else here: a picture that never loads has nothing to freeze,
       * which is the right outcome rather than a thing to report.
       */
      const again = () => {
        waiting = null
        if (isWatching()) return
        const late = freeze(el)
        if (late) setStill(late)
      }
      el.addEventListener('load', again, { once: true })
      waiting = () => el.removeEventListener('load', again)
    }

    /* Already in the background when this appears - a member list scrolled,
       or a profile opened, while the app sits on another monitor. */
    settle(isWatching())
    const stop = onAttentionChange(settle)
    return () => { stopWaiting(); stop() }
  }, [animated, path])

  return { img, src: still ?? src, frozen: still !== null }
}
