import { useEffect } from 'react'
import { shell } from '../lib/shell'

/**
 * Talking only while a key is held.
 *
 * The key is registered with the operating system rather than listened for on
 * the page, which is the whole point: it has to work while the app is behind
 * a game. A page listener hears nothing when the window is not focused, and
 * push-to-talk that only works when you are already looking at the app is
 * push-to-talk that does nothing.
 *
 * Nothing here in a browser. There is no way to hear a key the window did not
 * receive, and pretending otherwise would be a setting that silently is not
 * what it says.
 */
export function usePushToTalk(
  accelerator: string | null,
  inCall: boolean,
  setTalking: (down: boolean) => void,
) {
  /* Registering the key with the system. */
  useEffect(() => {
    const app = shell()
    if (!app) return
    void app.setPushToTalk(accelerator || null)
    /* Given back when the setting is cleared or the app closes, so the key
       stops being taken from everything else in the app. */
    return () => { void app.setPushToTalk(null) }
  }, [accelerator])

  /* Hearing it. */
  useEffect(() => {
    const app = shell()
    if (!app || !accelerator) return
    app.onPushToTalk((down) => {
      /* Only while there is a call to talk into. Outside one the key would
         be unmuting somebody who has not joined anything, and then leaving
         them unmuted when they do. */
      if (!inCall) return
      setTalking(down)
    })
  }, [accelerator, inCall, setTalking])
}
