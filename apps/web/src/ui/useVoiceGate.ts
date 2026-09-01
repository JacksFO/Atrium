import { useEffect } from 'react'
import { AutoGate } from '../lib/autogate'

/**
 * How old a reading may be before it is not evidence any more.
 *
 * Twenty milliseconds apart in the ordinary case, so a quarter of a second is
 * a long silence from something that should be talking constantly.
 */
const STALE_MS = 250
import { listenTo, type Meter } from '../lib/micmeter'

/**
 * Send only while somebody is actually talking.
 *
 * Without this the choice was a key held down or a microphone open to the
 * whole room for the length of the call — every cough, every keyboard, every
 * conversation happening behind you, sent to everybody and paid for by all of
 * them.
 *
 * Measured on a clone of the track being published, not on the track itself
 * and not on a second capture of the device.
 *
 * The track itself is the trap this fell into first: the gate works by
 * switching that track off, so a meter reading it hears silence the moment
 * the gate shuts, decides the room is quiet, and keeps it shut for ever. A
 * gate starts shut, so that latched on the first reading and the microphone
 * never opened at all. `voiceGateLoop.test.ts` plays a call through both
 * wirings.
 *
 * The answer to that was a second getUserMedia, which is two captures of one
 * device - and two independent chains of echo cancellation, noise
 * suppression and automatic gain. What is measured is then not what is sent:
 * the two gains ramp separately, so the meter can be reading a rising level
 * while the published track is still quiet, or the reverse. Reported as the
 * voice cutting out while the bar sat above the line.
 *
 * A clone shares the capture rather than opening another, and carries its own
 * on/off - so it goes on hearing the room while the published one is
 * switched off, which is the whole of what the second capture was for. This
 * is what the client before this one did.
 *
 * Off entirely while push-to-talk is set. Two things deciding when the
 * microphone opens is one thing too many, and the key is the more explicit
 * of the two — somebody who set one has already answered this question.
 */
export function useVoiceGate({ active, auto, line, micStream, gate }: {
  /** In a call, not muted, and not on push-to-talk. */
  active: boolean
  /** Work the line out, rather than use the one below. */
  auto: boolean
  /** The line, when it is theirs to set. */
  line: number
  /** What is being sent, to take a copy of. */
  micStream: () => MediaStream | null
  gate: (open: boolean) => boolean
}): void {
  useEffect(() => {
    if (!active) return
    let meter: Meter | null = null
    let heard: MediaStreamTrack | null = null
    let watching: MediaStreamTrack | null = null
    const detector = new AutoGate({ fixed: auto ? null : line })
    let last = Date.now()
    /* When a reading last arrived, as opposed to when one was expected. */
    let heardAt = Date.now()
    let stopped = false

    const listenToTrack = (track: MediaStreamTrack): void => {
      /*
       * If cloning is refused, measure nothing and gate nothing. Reading the
       * published track directly is the one thing that must not happen: it
       * would shut the microphone and then never hear anything loud enough to
       * open it again.
       */
      let copy: MediaStreamTrack
      try { copy = track.clone() } catch { gate(true); return }
      heard = copy
      watching = track
      meter = listenTo(new MediaStream([copy]), (level) => {
        const now = Date.now()
        const since = now - last
        last = now
        heardAt = now
        let open = detector.push(level, since)
        /*
         * Fail open, never closed.
         *
         * A background tab has its timers throttled, so a reading can be a
         * second old rather than twenty milliseconds old - and a stale
         * reading must not be allowed to hold somebody's microphone shut.
         * Wrong in this direction is a little noise; wrong in the other is
         * talking to people who cannot hear you and not knowing.
         */
        if (since > STALE_MS) open = true
        gate(open)
      })
      /* No AudioContext on this machine: leave what is published open rather
         than shut, because a gate that cannot measure anything and defaults
         to closed is a call nobody can be heard on. */
      if (!meter) { try { copy.stop() } catch { /* gone */ } ; heard = null; gate(true) }
    }

    const drop = (): void => {
      meter?.stop()
      meter = null
      if (heard) { try { heard.stop() } catch { /* gone */ } }
      heard = null
      watching = null
    }

    /*
     * Waited for, and watched afterwards.
     *
     * Joining, acquiring the device and publishing all happen after this runs,
     * so there is nothing to copy at first. And the track can be replaced
     * later - a different microphone chosen, or a phone returning to the
     * foreground - at which point the copy is of something nobody is sending
     * any more, and every reading from it is about the wrong device.
     */
    const published = (): MediaStreamTrack | null =>
      micStream()?.getAudioTracks()[0] ?? null

    const check = setInterval(() => {
      if (stopped) return

      /*
       * Nothing heard for a while, so open up.
       *
       * The meter says nothing at all while its audio context is suspended -
       * a tab in the background, an autoplay policy, a machine that slept -
       * because a suspended analyser answers zeros and a zero is
       * indistinguishable from a silent room. Silence from the meter is the
       * signal; this is what acts on it, and without it the gate would simply
       * hold whatever it decided last, which is usually shut.
       */
      if (Date.now() - heardAt > STALE_MS) gate(true)

      const track = published()
      if (track === watching) return
      drop()
      if (track) listenToTrack(track)
      else gate(true)
    }, 200)

    /*
     * And open the moment the app is looked at again.
     *
     * The call library decides a track needs re-acquiring partly from whether
     * it is switched on, and asks that on a phone every time the app returns
     * to the foreground - so a gate that happened to be shut at that moment,
     * which is most of them, made it throw the microphone away and open a new
     * one. Opening first costs nothing, since the next reading is twenty
     * milliseconds away, and takes the question off the table.
     */
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      gate(true)
      /* Any reading from before the app went away is stale, so start again
         rather than deciding on it. */
      last = Date.now()
      heardAt = Date.now()
    }
    document.addEventListener('visibilitychange', onVisible)

    const first = published()
    if (first) listenToTrack(first)

    return () => {
      stopped = true
      clearInterval(check)
      document.removeEventListener('visibilitychange', onVisible)
      drop()
      /* Open on the way out, always. Whatever stopped this - the setting
         turned off, the call ended, a mute - must not leave a microphone
         shut by a thing that is no longer running. */
      gate(true)
    }
  }, [active, auto, line, micStream, gate])
}
