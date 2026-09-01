/**
 * Working out for somebody where "talking" starts.
 *
 * The activation threshold is the one voice setting nobody can set correctly
 * without help. It is a number in units nobody has, measured against a
 * microphone whose gain nobody knows, in a room whose noise nobody has
 * measured - so the honest way to pick it is to talk, watch a bar, and guess.
 * Asked for as wanting it detected instead, with manual left available for
 * people who would rather say.
 *
 * The idea is old and simple: a room has a noise floor, speech sits well
 * above it, and the threshold belongs in the gap.
 *
 * The first version took the floor to be the quietest moment of the last
 * second and a half, which is wrong in a way that only shows up in a real
 * room. Noise is not steady. A fan runs between eight and eighteen, so its
 * quietest moment is eight - and a line drawn a margin above eight is a line
 * that same fan crosses several times a second. Reported as the microphone
 * opening on background noise, because "the sensitivity auto goes down".
 *
 * So the floor is what the room usually sounds like rather than the least it
 * has briefly sounded like, and it is learned while the gate is shut -
 * because that is when what is being heard is, by definition, the room.
 *
 * Pure, and separate from anything that captures audio, so both the call and
 * the meter in settings can run the identical thing and the marker in the
 * settings bar means exactly what will happen in a call.
 */

/** The floor never puts the line below this: total silence is not the goal. */
export const GATE_MIN = 3
/**
 * Nor above it.
 *
 * Past here a real voice is being asked to shout - and it is also where the
 * level bar in settings runs out, so a line beyond this could not be drawn
 * on the thing it is meant to be read against.
 */
export const GATE_MAX = 50

/**
 * How far above the room the line sits.
 *
 * Both a multiple and a flat amount. A multiple alone is useless in a silent
 * room, where twice nearly nothing is nearly nothing; a flat amount alone is
 * useless in a loud one, where five above a fan is still the fan. Speech runs
 * at several times the level of the noise it is spoken over, which is the
 * whole reason this can work.
 */
const MARGIN = 1.9
const ABSOLUTE = 5

/** How far below the line the level falls before the gate may close. */
const HYSTERESIS = 0.75
/** And for how long, so a pause between words does not clip the next one. */
const HOLD_MS = 450

/**
 * Smoothing on the level itself, before anything looks at it.
 *
 * One reading is a fraction of a second of audio and jumps about wildly.
 * Deciding anything from a single one is how a gate ends up chattering.
 */
const SMOOTH_MS = 150

/** How quickly the floor follows the room, while the gate is shut. */
const LEARN_MS = 1200

/**
 * How long the gate may stay open before its being open is taken as evidence
 * that whatever opened it was not speech.
 */
const STUCK_MS = 5000
/** And how slowly the floor may move while that is going on. */
const STUCK_LEARN_MS = 15_000

/**
 * A second, faster reading of the level, used only to find the gaps.
 *
 * SMOOTH_MS is 150, and the gaps in speech are shorter than that - so through
 * the smoothed level a voice and a fan look exactly alike: both unbroken
 * sound. Measured over twenty seconds of each, at 150ms neither spends any
 * time at all below a third of its own peak and both run unbroken for the
 * whole twenty seconds. At 40ms a voice is under a third of its peak a fifth
 * of the time and never goes more than about a second and a half without a
 * gap, while a fan - steady or wobbling - still never dips at all.
 *
 * That is the whole difference between the two, and the gate could not see it
 * because it was looking through the wrong window. Modulation depth is not
 * the difference: a wobbling fan swings more than a monologue does.
 */
const QUICK_MS = 40

/**
 * How far back down towards the room the quick level must fall for the pause
 * to count as a gap.
 *
 * Towards the room rather than towards nothing, because a voice sits on top
 * of whatever else is in the room and the gaps between syllables fall back to
 * that, not to silence. Measured on a voice peaking at 24 over a room at 4,
 * the quick level runs between 7.9 and 21.6 - so "under a third of the peak"
 * wanted it below 7.2 and it never quite got there, and every one of those
 * gaps was counted as more unbroken noise. A third of the way up from the
 * room asks for 9.9 instead, which is what a gap in that voice actually
 * looks like.
 */
const GAP_UNDER = 3

/**
 * How long the peak that is measured against remembers.
 *
 * It decays rather than standing, or one loud moment would make everything
 * afterwards look like a gap and nothing would ever be learned again.
 */
const PEAK_MS = 10_000

/**
 * And how long without one before a sound is taken to be steady.
 *
 * Comfortably longer than the gap between phrases, so a pause for breath is
 * not mistaken for a fan, and far shorter than anybody's patience with a gate
 * that has stuck open.
 */
const STEADY_FOR_MS = 2500

/** Exponential smoothing that does not care how often it is called. */
function towards(current: number, target: number, dtMs: number, tauMs: number): number {
  const a = 1 - Math.exp(-Math.max(0, dtMs) / tauMs)
  return current + (target - current) * a
}

export type AutoGateOptions = {
  /** Where to start before anything has been heard. */
  floor?: number
  holdMs?: number
  /**
   * A line somebody set themselves, which turns the learning off.
   *
   * Here rather than in a second class so that manual and automatic differ
   * only in where the number comes from. Everything else about them - the
   * hysteresis, the hold through a pause - has to be identical, and the
   * surest way to keep two things identical is for there to be one of them.
   */
  fixed?: number | null
}

export class AutoGate {
  private floor: number
  private smooth = 0
  private openNow = false
  private quietMs = 0
  /** How long the gate has been open without properly closing. */
  private openMs = 0
  /** The quietest the room has been since it opened, for the stuck case. */
  private quietestWhileOpen = Number.POSITIVE_INFINITY
  /* The fast reading, and what it has been doing: how loud it has got since
     the gate opened, and how long since it last fell away to nothing. */
  private quick = 0
  private quickPeak = 0
  private sinceGapMs = 0
  private heardAnything = false
  private readonly holdMs: number
  private fixedAt: number | null

  constructor(opts: AutoGateOptions = {}) {
    this.floor = opts.floor ?? 2
    this.holdMs = opts.holdMs ?? HOLD_MS
    this.fixedAt = opts.fixed ?? null
  }

  /** Switch between a learned line and one somebody set, without a restart. */
  setFixed(value: number | null): void {
    this.fixedAt = value
  }

  /** The line, right now, in the same units as the levels being fed in. */
  get threshold(): number {
    if (this.fixedAt !== null) return this.fixedAt
    return Math.min(GATE_MAX, Math.max(GATE_MIN, this.floor * MARGIN + ABSOLUTE))
  }

  /** What it currently believes the room sounds like with nobody talking. */
  get noiseFloor(): number {
    return this.floor
  }

  get isOpen(): boolean {
    return this.openNow
  }

  /**
   * Feed one measurement. Answers whether the microphone should be open.
   *
   * @param level the current loudness, in whatever unit is used consistently
   * @param dtMs  milliseconds since the last measurement
   */
  push(level: number, dtMs: number): boolean {
    const safe = Number.isFinite(level) ? Math.max(0, level) : 0

    /*
     * The first reading is taken whole. Easing into it from a guess made
     * before anything had been heard means a loud room takes several seconds
     * to be recognised, with the microphone wide open for all of them.
     */
    if (!this.heardAnything) {
      this.smooth = safe
      this.quick = safe
      this.floor = safe
      this.heardAnything = true
    } else {
      this.smooth = towards(this.smooth, safe, dtMs, SMOOTH_MS)
      this.quick = towards(this.quick, safe, dtMs, QUICK_MS)
    }

    /*
     * Whether what is being heard has gaps in it, which is what tells a voice
     * from a noise - and is asked whatever the gate is doing, because the
     * floor climbed hardest in the moments it was shut.
     *
     * The peak it is measured against decays, so a shout a minute ago does
     * not make everything since look like a gap. Against its own peak rather
     * than any absolute level, so this says nothing about how loud the thing
     * is, only whether it ever stops.
     */
    this.quickPeak = Math.max(this.quick, towards(this.quickPeak, this.quick, dtMs, PEAK_MS))
    const gapAt = this.floor + Math.max(0, this.quickPeak - this.floor) / GAP_UNDER
    if (this.quick < gapAt) this.sinceGapMs = 0
    else this.sinceGapMs += dtMs
    /* Speech, until it has gone this long without a gap. */
    const steady = this.sinceGapMs > STEADY_FOR_MS

    if (!this.openNow) {
      /*
       * Shut, so whatever is being heard is the room.
       *
       * This is the correction. Learning only while shut means speech never
       * teaches the floor what silence sounds like, so the line cannot climb
       * over the voice it exists to let through - and the floor settles on
       * what the room usually is rather than on the least it briefly was.
       */
      /*
       * And only what has no gaps in it.
       *
       * "Shut" is not the same as "nobody is talking". The gate closes for a
       * moment in the gaps between phrases, and the level being learned from
       * is smoothed over 150ms - so those moments are still full of speech,
       * and every one of them taught the floor a little more of the voice.
       * Over half a minute of talking that alone carried the floor from 3.9
       * to 13, which puts the line at 29 for a voice that peaks at 24.
       *
       * Worse for somebody quiet, where the line starts above the voice: the
       * gate never opens at all, so every word is learned as though it were
       * the room, and the line runs away from them.
       *
       * Only upwards, though. A floor that moves down can only make the gate
       * easier to open, and can never shut anybody out - so a room that has
       * genuinely gone quiet is followed at once, with no waiting to see
       * whether it is really steady. It is the climb that does the harm, and
       * only the climb that has to prove itself.
       */
      if (this.smooth < this.floor || steady) {
        this.floor = towards(this.floor, this.smooth, dtMs, LEARN_MS)
      }
      this.openMs = 0
      this.quietestWhileOpen = Number.POSITIVE_INFINITY
    } else {
      this.openMs += dtMs
      this.quietestWhileOpen = Math.min(this.quietestWhileOpen, this.smooth)
      /*
       * Open for a long time, which nobody is.
       *
       * A gate held open for five seconds without a break opened for
       * something that is not speech: a television, a fan that started after
       * the floor was learned, a room that simply got louder. Left alone it
       * would stay open for ever, because the floor only learns while shut.
       *
       * It follows the quietest moment since it opened rather than the level
       * now - talking dips towards silence between words, so a real voice
       * teaches it almost nothing, while a steady noise has no dips and is
       * learned. Slowly, so a long answer is never cut off mid-sentence.
       */
      if (this.openMs > STUCK_MS && steady && Number.isFinite(this.quietestWhileOpen)) {
        this.floor = towards(this.floor, this.quietestWhileOpen, dtMs, STUCK_LEARN_MS)
      }
    }

    const line = this.threshold

    /*
     * Opening asks the smoothed level, staying open asks the quick one.
     *
     * They are different questions and were being asked of the same number.
     * Opening wants to be sure: one reading is a fraction of a second of
     * audio and jumps about, and a gate that opens on any of them chatters.
     * Staying open wants to be current, and the smoothing is 150ms of the
     * past - so after somebody stopped talking the level took a third of a
     * second to fall through it before the hold below had even started.
     *
     * Measured: 780ms from the last word to the microphone closing, of which
     * 450 is the hold and 330 was the smoothing draining. The hold is doing
     * a job - it is what carries a pause between words - and the 330 is not.
     */
    if (!this.openNow) {
      if (this.smooth > line) {
        this.quietMs = 0
        this.openNow = true
        return true
      }
      return false
    }

    /*
     * Open already, so the question is whether to stay open - and asking the
     * smoothed level that was what made the tail long. It is 150ms of the
     * past, so it went on answering "still loud" for a third of a second
     * after the room had gone quiet, and only then did the hold below begin.
     *
     * Closing still needs the level to fall properly below the line and stay
     * there for the hold: otherwise a level sitting right on the threshold
     * chatters the gate open and shut several times a second, which sounds
     * worse than either state. The hold is what carries a pause between
     * words, and it is untouched.
     */
    if (this.quick > line * HYSTERESIS) {
      this.quietMs = 0
      return true
    }
    this.quietMs += dtMs
    if (this.quietMs < this.holdMs) return true
    this.openNow = false
    this.openMs = 0
    this.quietestWhileOpen = Number.POSITIVE_INFINITY
    return false
  }
}
