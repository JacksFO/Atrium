/**
 * How loud the microphone is, right now.
 *
 * One of these, used by both the bar in settings and the gate in a call, so
 * the marker somebody lines up against their own voice means exactly what
 * will happen when they are actually talking. Two meters measuring the same
 * microphone in two slightly different ways is how a settings screen ends up
 * lying about the thing it is there to set.
 *
 * The unit is arbitrary and only has to be used consistently: the average
 * absolute sample of a frame, scaled so ordinary speech lands somewhere in
 * the teens and twenties and the bar's top end is 50. That is the same range
 * AutoGate's floor and ceiling are written in.
 */


/**
 * And where the bar itself runs out, which is further.
 *
 * The bar used to stop at the same place the gate does, and a voice does not:
 * measured on a real microphone, ordinary talking peaks around 78 against a
 * ceiling of 50. So the bar sat pinned at full for every word - reported as
 * the bar not moving while talking, which is exactly what it was doing.
 *
 * The gate's ceiling is not the thing to change: it is where a line drawn by
 * hand stops, and past there a voice is being asked to shout. This is only
 * how far the picture goes, and the line is drawn on the same scale so the
 * two still mean the same thing against each other.
 */
export const BAR_MAX = 100

export type Meter = {
  /** Give the microphone back and stop measuring. */
  stop: () => void
}

/**
 * Watch a microphone and report how loud it is, about fifty times a second.
 *
 * Answers null when this machine has no audio to give — no getUserMedia, no
 * AudioContext, or the person said no. Every caller has to draw something
 * sensible in that case rather than assume a number is coming: a settings
 * pane that waits for a level that never arrives is a pane that never loads.
 */
export async function listen(
  deviceId: string,
  onLevel: (level: number) => void,
  constraints: MediaTrackConstraints = {},
): Promise<Meter | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null
  const Ctx: typeof AudioContext | undefined = typeof AudioContext !== 'undefined'
    ? AudioContext
    : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { ...constraints, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
    })
  } catch {
    /* Refused, or the device is gone. Not an error worth showing: the pane
       still works, it simply cannot draw a level. */
    return null
  }

  const meter = listenTo(stream, onLevel)
  if (!meter) {
    for (const track of stream.getTracks()) { try { track.stop() } catch { /* gone */ } }
    return null
  }
  return {
    stop: () => {
      meter.stop()
      /* The tracks too, because this one opened them. A microphone left
         running is the light staying on after somebody closed the settings
         screen. */
      for (const track of stream.getTracks()) { try { track.stop() } catch { /* gone */ } }
    },
  }
}

/**
 * The same measurement, on audio somebody else already has open.
 *
 * A call has the microphone published already, so opening it a second time
 * to measure it is a second capture of one device - which some machines
 * refuse outright and all of them charge for. This measures what is being
 * sent, which is also the more honest thing to measure.
 *
 * Does not stop the tracks it was handed: they belong to whoever opened them.
 */
export function listenTo(
  stream: MediaStream,
  onLevel: (level: number) => void,
): Meter | null {
  const Ctx: typeof AudioContext | undefined = typeof AudioContext !== 'undefined'
    ? AudioContext
    : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null

  const ctx = new Ctx()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  /* Enough smoothing that a consonant does not strobe the ring. */
  analyser.smoothingTimeConstant = 0.4
  source.connect(analyser)

  /* Half the window, which is how many frequency bins an FFT of it has. */
  const bins = new Uint8Array(analyser.frequencyBinCount)
  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    /*
     * A stopped clock reads midnight.
     *
     * A suspended context makes the analyser answer zeros, which is
     * indistinguishable from a perfectly silent room - and a gate acting on
     * that holds somebody's microphone shut for the whole call while every
     * reading agrees nothing is happening. Browsers suspend contexts freely:
     * an autoplay policy, a backgrounded tab, a machine going to sleep.
     *
     * So nothing is reported at all until it is running again, and another
     * resume is asked for. Saying nothing is what lets whoever is listening
     * notice the silence and open up, which a zero would never do.
     */
    if (ctx.state !== 'running') {
      void ctx.resume?.().catch(() => { /* it will be asked again in 20ms */ })
      return
    }
    analyser.getByteFrequencyData(bins)
    /*
     * The root mean square across the spectrum, in the bytes the analyser
     * hands over - which are a decibel scale, not an amplitude one.
     *
     * That is the whole of it, and it is why this is written out again rather
     * than left as it was. The client before this one measured exactly this,
     * and every constant in AutoGate - the margin of 1.9, the flat 5, the
     * floor of 3 and ceiling of 50 - was tuned against it. The rewrite
     * measured the time domain instead, the mean departure from silence, and
     * scaled it by a factor picked to make ordinary speech land in the teens.
     * Ordinary speech did. Quiet speech did not: decibels compress, so on the
     * old measure a soft voice sits close behind a loud one, and on a linear
     * one it collapses towards the floor while the line stays where it was.
     *
     * Reported as talking quietly not getting through, and it is the same
     * thresholds judging a different quantity.
     */
    /* Unclamped, as the gate was always given it: the bar clamps when it
       draws, and pinning the number at the ceiling would put a shout exactly
       on the line rather than over it. */
    onLevel(levelOf(bins))
  }, 20)

  return {
    stop: () => {
      if (timer) { clearInterval(timer); timer = null }
      try { source.disconnect() } catch { /* already torn down */ }
      void ctx.close().catch(() => { /* nothing to undo */ })
    },
  }
}

/**
 * How loud, in the units every threshold in this feature is written in.
 *
 * The root mean square across the spectrum, in the bytes the analyser hands
 * over - which are a decibel scale, not an amplitude one. Pure, so the thing
 * the gate is judging can be tested without a microphone.
 */
export function levelOf(bins: Uint8Array): number {
  if (bins.length === 0) return 0
  let sum = 0
  for (const v of bins) sum += v * v
  return Math.sqrt(sum / bins.length)
}

/*
 * There was a spectralShape here, and what it measured is worth keeping even
 * though the code is not.
 *
 * It came from chasing a quiet voice that would not open the gate, on the
 * theory that loudness could not tell a voice from a fan and the spectrum
 * could. That was true and beside the point - the real fault was that the
 * level being judged had been changed from a decibel scale to a linear one
 * while the thresholds stayed where they were.
 *
 * Measured on a real microphone before it came out, it said two things:
 *
 *   Energy in 300Hz-3.4kHz is not a usable signal here. It read 4% while
 *   talking and 7% while silent - lower for the voice than for the room - so
 *   on that hardware most of the energy sits outside the band a voice is
 *   supposed to live in, low down. Any rule built on it would have been
 *   backwards.
 *
 *   Spectral flatness is. One minus it read 57% while talking and 0% while
 *   silent, which is the clean separation amplitude never gave: a voice is a
 *   pitch and its harmonics, hiss and fans are flat.
 *
 * So if a gate is ever wanted that can refuse a loud steady noise rather than
 * learn to live with it, peakiness is the thing to build it on, and the band
 * is not. Nothing needs that today.
 */
