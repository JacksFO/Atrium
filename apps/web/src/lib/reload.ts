/**
 * Reloading, without leaving the machine holding things.
 *
 * A bare location.reload() tears the page down while a call is still running:
 * a microphone and possibly a screen are captured, several peer connections
 * are open, and a socket is mid-conversation. Chromium usually copes and
 * sometimes does not, and the failure is the app sitting there doing nothing
 * for several seconds before it comes back - reported as reloading being slow,
 * timing out, or falling over.
 *
 * So the loud things are let go of first, and then the page reloads. Every
 * step is best-effort and none of them can prevent the reload: a teardown
 * that hangs is exactly the thing this is meant to stop, so a timer reloads
 * regardless.
 */

/** How long teardown gets before the reload happens anyway. */
const AT_MOST_MS = 400

/**
 * Let go of every camera, microphone and screen this page is holding.
 *
 * By way of the elements playing them, because that is what there is: the
 * room object lives inside a hook and this is called from three different
 * places, none of which have it. Every track the page can see is stopped,
 * which is every track it is playing.
 */
function releaseMedia(): void {
  const playing = document.querySelectorAll<HTMLMediaElement>('video,audio')
  for (const el of playing) {
    try {
      const stream = el.srcObject as MediaStream | null
      el.pause()
      el.srcObject = null
      if (stream) for (const track of stream.getTracks()) track.stop()
    } catch {
      /* Already gone, or never ours. Either is fine. */
    }
  }
}

let going = false

/**
 * Reload, once.
 *
 * The guard is not tidiness. The button sits there looking unpressed while
 * the page tears down, so it gets pressed again - and a second reload
 * starting on top of the first is the shape of "it crashed".
 */
export function reloadApp(): void {
  if (going) return
  going = true

  try { releaseMedia() } catch { /* nothing here may stop the reload */ }

  /*
   * A frame for the release to take effect, and a ceiling so a hang cannot
   * leave somebody looking at a page that will not come back.
   *
   * Whichever gets there first, and only that one. In a browser the first
   * navigation usually stops the second from mattering - usually is not a
   * reason to fire two reloads at a window that is already tearing itself
   * down, which is the failure this whole function exists to avoid.
   */
  let gone = false
  const go = () => {
    if (gone) return
    gone = true
    location.reload()
  }
  window.setTimeout(go, AT_MOST_MS)
  requestAnimationFrame(() => window.setTimeout(go, 0))
}

/** For tests, which need a fresh one each time. */
export function resetReloadGuard(): void {
  going = false
}
