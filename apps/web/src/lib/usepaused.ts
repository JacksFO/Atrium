import { useEffect, useRef } from 'react'
import { isWatching, onAttentionChange } from './attention'

/**
 * A video that stops while nobody is looking at the window.
 *
 * The sibling of useStillWhenAway, which does the same job for pictures by
 * freezing a frame onto a canvas. That trick does not work here: a video
 * cannot be frozen by drawing it somewhere, it has to be told to stop, and a
 * video that is not told keeps decoding for as long as the app is open.
 *
 * Which is what was happening to every GIF in every message. The providers
 * hand over mp4 rather than .gif, so a GIF in a conversation is a <video>
 * with autoPlay and loop on it - and nothing ever paused it. A handful of
 * them on screen decode and composite for ever: minimised, on another
 * monitor, behind a game, all night. Reported as the machine getting slower
 * the longer the app was left open, which is exactly what it looks like from
 * outside.
 *
 * Animated avatars and banners were reported three times for the same thing
 * and fixed for pictures. This is the half that was left: attention.ts says
 * in as many words that "the same pair already governs whether GIFs keep
 * playing", and for the ones in messages it never did.
 */
export function usePausedWhenAway<T extends HTMLMediaElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const settle = (watching: boolean) => {
      const el = ref.current
      if (!el) return
      if (!watching) { el.pause(); return }
      /*
       * Caught, because this rejects for ordinary reasons: a play that is
       * interrupted by the element going away, or by the window losing
       * attention again before the frame arrives. Neither is worth an
       * unhandled rejection in the console of a chat app.
       */
      void el.play().catch(() => { /* it will play when it can */ })
    }

    /*
     * Settled on the way in, not only on the next change.
     *
     * A conversation opened while the app is already on another monitor
     * mounts its videos with autoPlay, so they start - and without this
     * nothing would stop them until the window was looked at and looked away
     * from again. The same case the picture version was caught out by.
     */
    settle(isWatching())
    return onAttentionChange(settle)
  }, [])

  return ref
}
