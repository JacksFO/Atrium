/**
 * Notification sounds, synthesised rather than shipped.
 *
 * Two short sine tones through a gain envelope: no audio files in the bundle,
 * nothing to load before the first ping, and it works offline. A soft attack
 * and release matter — a raw square wave clicks unpleasantly, and a sound you
 * hear fifty times an evening has to be forgettable.
 */

/*
 * Whether anything should be heard at all.
 *
 * Set by the app rather than read from storage here: this file knows how to
 * make a sound and nothing about where a preference lives, and the two stores
 * this has been through so far are the reason to keep it that way.
 */
let allowed = true

export function setSoundEnabled(on: boolean): void { allowed = on }

const soundEnabled = (): boolean => allowed

let ctx: AudioContext | null = null

function context(): AudioContext | null {
  // Browsers refuse to create or resume audio before a user gesture. Failing
  // quietly is correct: a missing ping is better than a thrown error.
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export type Tone = {
  freq: number
  at: number
  length: number
  gain: number
  /** How long the level takes to come up. Longer is softer. */
  attack?: number
  /*
   * What turns a tone into an instrument.
   *
   * A second oscillator runs at `ratio` times the pitch and is wired into the
   * first one's frequency, bending it thousands of times a second - which
   * adds partials the ear hears as a material. Whole-number ratios give wood
   * and struck strings; awkward ones give bells, whose overtones are not
   * whole multiples of their note either.
   *
   * `index` is how far it bends, and `bright` is how quickly that bending
   * dies away - faster than the volume does, so the note is sharp at the
   * strike and mellow as it rings out. Every real struck thing does that, and
   * leaving it out is most of what makes a synthesised note sound cheap.
   */
  ratio?: number
  index?: number
  bright?: number
}

/**
 * Sound one tone at a moment.
 *
 * Every sound here goes through this, and the ones with no `ratio` come out
 * exactly as they always did - a plain sine through a gain envelope. The
 * extra oscillator only exists for the tones that ask for it.
 */
function sound(audio: AudioContext, now: number, tone: Tone): void {
  const start = now + tone.at
  const attack = tone.attack ?? 0.012

  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(tone.freq, start)

  if (tone.ratio) {
    const bender = audio.createOscillator()
    const depth = audio.createGain()
    const index = tone.index ?? 1
    bender.type = 'sine'
    bender.frequency.setValueAtTime(tone.freq * tone.ratio, start)
    depth.gain.setValueAtTime(tone.freq * index, start)
    // Never to zero: an exponential ramp cannot reach it.
    depth.gain.exponentialRampToValueAtTime(
      Math.max(1, tone.freq * index * 0.02), start + tone.length * (tone.bright ?? 0.5))
    bender.connect(depth).connect(osc.frequency)
    bender.start(start)
    bender.stop(start + tone.length + 0.02)
  }

  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(tone.gain, start + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.length)

  osc.connect(gain).connect(audio.destination)
  osc.start(start)
  osc.stop(start + tone.length + 0.02)
}

function play(tones: Tone[]): void {
  if (!soundEnabled()) return
  const audio = context()
  if (!audio) return
  const now = audio.currentTime
  for (const tone of tones) sound(audio, now, tone)
}

/**
 * Every sound in the app, as notes rather than as code.
 *
 * Lifted out of the functions that trigger them so they can be read, and
 * checked, as music. The one thing anybody could hear was wrong with the ring
 * was that its two tones were 3.52 semitones apart - which is nothing, a
 * quarter-tone between a minor and a major third - and no test could say so
 * while the numbers were scattered through twelve function bodies.
 *
 * sound.test.ts now measures every interval in here against the nearest real
 * one. It is the only property of a sound worth asserting: whether it is
 * pleasant is a matter for ears, but whether it is in tune is arithmetic.
 */
export const TONES = {
  ring: [
    { freq: 587.33, at: 0,    length: 0.5, gain: 0.22, attack: 0.004, ratio: 4, index: 0.9, bright: 0.18 },
    { freq: 440.00, at: 0.15, length: 0.5, gain: 0.19, attack: 0.004, ratio: 4, index: 0.9, bright: 0.18 },
    { freq: 587.33, at: 0.30, length: 0.5, gain: 0.19, attack: 0.004, ratio: 4, index: 0.9, bright: 0.18 },
    { freq: 739.99, at: 0.45, length: 0.9, gain: 0.20, attack: 0.004, ratio: 4, index: 0.9, bright: 0.18 },
  ],
  /*
   * The four short ones, warmed.
   *
   * Not a note has moved: they were already within a hundredth of a semitone
   * of a real interval, which is the part that was wrong with the ring and
   * was never wrong with these. What changed is the shape of each note.
   *
   * A slower attack, so it arrives rather than clicks. A longer tail, so it
   * stops rather than being cut off. And a second oscillator an octave up at
   * a third of the depth, which gives a sine some body - the difference
   * between a note and a beep, and the same trick that made the ring a
   * marimba, used far more gently here because these play fifty times an
   * evening and have to stay forgettable.
   */
  ping: [
    { freq: 880, at: 0, length: 0.24, gain: 0.12, attack: 0.018, ratio: 2, index: 0.35, bright: 0.3 },
    { freq: 1174, at: 0.075, length: 0.3, gain: 0.085, attack: 0.018, ratio: 2, index: 0.35, bright: 0.3 },
  ],
  mention: [
    { freq: 932, at: 0, length: 0.22, gain: 0.14, attack: 0.016, ratio: 2, index: 0.3, bright: 0.28 },
    { freq: 1661, at: 0.085, length: 0.34, gain: 0.095, attack: 0.016, ratio: 2, index: 0.25, bright: 0.28 },
  ],
  reconnect: [
    { freq: 784, at: 0, length: 0.09, gain: 0.08 },
    { freq: 523, at: 0.06, length: 0.10, gain: 0.07 },
    { freq: 784, at: 0.13, length: 0.18, gain: 0.08 },
  ],
  answered: [
    { freq: 660, at: 0, length: 0.18, gain: 0.09, attack: 0.014, ratio: 2, index: 0.4, bright: 0.3 },
    { freq: 990, at: 0.065, length: 0.26, gain: 0.075, attack: 0.014, ratio: 2, index: 0.4, bright: 0.3 },
  ],
  hangup: [
    { freq: 660, at: 0, length: 0.2, gain: 0.085, attack: 0.014, ratio: 2, index: 0.4, bright: 0.3 },
    { freq: 440, at: 0.09, length: 0.38, gain: 0.08, attack: 0.018, ratio: 2, index: 0.5, bright: 0.3 },
  ],
  watchStart: [
    { freq: 494, at: 0, length: 0.11, gain: 0.10 },
    { freq: 988, at: 0.075, length: 0.17, gain: 0.09 },
  ],
  watchStop: [
    { freq: 988, at: 0, length: 0.11, gain: 0.09 },
    { freq: 494, at: 0.075, length: 0.19, gain: 0.08 },
  ],
  shareStart: [
    { freq: 698, at: 0, length: 0.10, gain: 0.09 },
    { freq: 880, at: 0.07, length: 0.11, gain: 0.10 },
    { freq: 880, at: 0.17, length: 0.20, gain: 0.08 },
  ],
  shareStop: [
    { freq: 880, at: 0, length: 0.10, gain: 0.08 },
    { freq: 698, at: 0.07, length: 0.11, gain: 0.08 },
    { freq: 698, at: 0.17, length: 0.22, gain: 0.07 },
  ],
  voiceJoin: [
    { freq: 440, at: 0, length: 0.09, gain: 0.09 },
    { freq: 587, at: 0.06, length: 0.10, gain: 0.09 },
    { freq: 880, at: 0.12, length: 0.20, gain: 0.10 },
  ],
  voiceLeave: [
    { freq: 880, at: 0, length: 0.09, gain: 0.09 },
    { freq: 587, at: 0.06, length: 0.10, gain: 0.08 },
    { freq: 440, at: 0.12, length: 0.22, gain: 0.08 },
  ],
  someoneJoined: [{ freq: 988, at: 0, length: 0.13, gain: 0.07 },
  ],
  someoneLeft: [{ freq: 587, at: 0, length: 0.15, gain: 0.06 },
  ],
} satisfies Record<string, Tone[]>

/**
 * A message arrived in a channel you are not looking at.
 *
 * A rising fourth. It used to be a rising fifth, which was also the sound of
 * a mention, of the connection coming back, and of a call being answered -
 * four different events, one shape, told apart only by pitch. Nobody learns
 * four sounds that are the same sound played higher.
 */
export function playPing(): void {
  play(TONES.ping)
}

/**
 * Someone mentioned you by name.
 *
 * The widest rising step of anything here short of an octave, and the
 * brightest. It has to be tellable from an ordinary message at a glance,
 * because the whole difference between them is whether it is about you.
 */
export function playMention(): void {
  play(TONES.mention)
}

/**
 * The connection came back.
 *
 * Down and back up to where it started - the only sound here that turns
 * around, which is exactly what it is reporting. As a rising pair it was
 * indistinguishable from a message arriving, so the one sound that means
 * "something was wrong and is now fine" sounded like nothing being wrong.
 */
export function playReconnect(): void {
  play(TONES.reconnect)
}

let ringTimer: number | null = null

/**
 * Incoming call ring: a repeating two-tone pattern.
 *
 * Deliberately not gated on soundEnabled() — that setting silences message
 * pings. Someone ringing you is not a notification you scroll past later.
 */
/*
 * Four wooden notes: D, A, D, F sharp, struck quickly and left to ring.
 *
 * Chosen by ear from a bench of six, after two rounds of getting it wrong in
 * two different ways.
 *
 * The first version was 620 and 760 hertz alternating, which is 3.52
 * semitones apart - a quarter-tone between a minor and a major third,
 * belonging to no interval at all. Every other sound in this file lands
 * within a hundredth of a semitone of a real one; that was the sour note
 * somebody could hear without being able to name.
 *
 * Putting it in tune was not enough, and that is the more useful lesson: a
 * sine wave has one frequency and nothing else in it, so however it is
 * shaped, it can only ever sound like a test tone. These notes are struck
 * rather than held, and each carries a second oscillator at four times its
 * pitch bending the first - which is what a mallet on wood sounds like, and
 * costs one more oscillator than a beep did.
 */
/* The ring lives in TONES.ring with everything else. */

/** How often the phrase repeats. Long enough to leave a silence in between. */
const RING_EVERY_MS = 2600

export function startRinging(): void {
  if (ringTimer !== null) return
  const ring = () => {
    const audio = context()
    if (!audio) return
    const now = audio.currentTime
    for (const tone of TONES.ring) sound(audio, now, tone)
  }
  ring()
  ringTimer = window.setInterval(ring, RING_EVERY_MS)
}

export function stopRinging(): void {
  if (ringTimer === null) return
  clearInterval(ringTimer)
  ringTimer = null
}

/** The other side picked up. */
export function playAnswered(): void {
  play(TONES.answered)
}

/** The call ended or was declined. Falling, so it reads as "over". */
export function playHangup(): void {
  play(TONES.hangup)
}

/**
 * Somebody started watching your screen.
 *
 * A rising octave - the widest jump of anything here. This one arrives while
 * you are looking at the thing you are sharing rather than at Atrium, so
 * it has to carry without being looked at. Its pair below is the same octave
 * falling.
 *
 * It began life as 660 to 990, which was note for note the sound of a call
 * being answered. Check the table in sound.test.ts before adding another.
 */
export function playWatchStart(): void {
  play(TONES.watchStart)
}

/** Somebody stopped watching. The same two notes, the other way round. */
export function playWatchStop(): void {
  play(TONES.watchStop)
}

/**
 * Somebody in the call put a screen up.
 *
 * Not the same event as playWatchStart, which is somebody watching YOURS.
 * This one is heard by everybody else in the channel, and it is the whole
 * reason it exists: a screen used to appear with no sound at all, so unless
 * you happened to be looking at the call you did not know there was anything
 * to look at.
 *
 * The shape is a note repeated, which nothing else here does - every other
 * motif moves on every note. Half-heard, that repeat is what says "screen"
 * rather than "somebody arrived", and the direction of the first step says
 * which way. A major third rather than a fifth or an octave for the same
 * reason: both of those are already spoken for.
 *
 * Check the table in sound.test.ts before adding another.
 */
export function playShareStart(): void {
  play(TONES.shareStart)
}

/** And took it down again. The same three notes the other way up. */
export function playShareStop(): void {
  play(TONES.shareStop)
}

/**
 * Voice, coming and going.
 *
 * These are told apart by shape rather than by pitch alone, because there
 * are now several two-note motifs and half-heard they blur into each other.
 * Your own connection gets three notes - it is the big event, and it happens
 * to you. Somebody else arriving gets one short blip, because it happens
 * several times an evening and must not become something to brace for.
 */
export function playVoiceJoin(): void {
  play(TONES.voiceJoin)
}

/** Leaving the call. The same three notes walked back down. */
export function playVoiceLeave(): void {
  play(TONES.voiceLeave)
}

/** Somebody else joined the channel you are in. One note, and a quiet one. */
export function playSomeoneJoined(): void {
  play(TONES.someoneJoined)
}

/** Somebody else left. The same blip, lower. */
export function playSomeoneLeft(): void {
  play(TONES.someoneLeft)
}
