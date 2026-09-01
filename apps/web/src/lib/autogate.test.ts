import { describe, expect, it } from 'vitest'
import { AutoGate, GATE_MAX, GATE_MIN } from './autogate'

/** Feed a steady level for a while, at the 80ms the real callers use. */
function hold(gate: AutoGate, level: number, ms: number): boolean {
  let open = gate.isOpen
  for (let t = 0; t < ms; t += 80) open = gate.push(level, 80)
  return open
}

/**
 * Noise that moves, which is the only kind there is.
 *
 * A fan is not a number. It runs between a low and a high several times a
 * second, and treating its low as "the room" is exactly what put the line
 * underneath it.
 */
function fan(gate: AutoGate, low: number, high: number, ms: number): boolean {
  let open = gate.isOpen
  for (let t = 0; t < ms; t += 80) {
    // A slow wobble and a fast one, so it is neither a constant nor a square
    // wave - both of which are easier than the real thing.
    const v = (low + high) / 2
      + ((high - low) / 2) * Math.sin(t / 200)
      + ((high - low) / 6) * Math.sin(t / 47)
    open = gate.push(v, 80)
  }
  return open
}

describe('working out where talking starts', () => {
  it('stays shut in a quiet room', () => {
    const g = new AutoGate()
    expect(hold(g, 1.5, 5000)).toBe(false)
  })

  it('opens the moment somebody speaks', () => {
    const g = new AutoGate()
    hold(g, 1.5, 5000)
    // One measurement, not a run of them: an attack delay is heard as the
    // first word being eaten.
    expect(g.push(30, 80)).toBe(true)
  })

  it('holds through the pause between words', () => {
    const g = new AutoGate()
    hold(g, 1.5, 3000)
    g.push(30, 80)
    expect(hold(g, 0.5, 240)).toBe(true)
  })

  it('and closes once the pause is really a stop', () => {
    const g = new AutoGate()
    hold(g, 1.5, 3000)
    g.push(30, 80)
    expect(hold(g, 0.5, 1200)).toBe(false)
  })

  /*
   * The reported failure, and the reason the floor was rewritten.
   *
   * "if there is background noise it always randomly activates the mic
   * because the sensistity auto goes down". Taking the floor to be the
   * quietest recent moment put it at the bottom of the fan's swing, and a
   * line a margin above the bottom of a swing is a line the top of that same
   * swing crosses several times a second.
   */
  it('is not opened by a fan that goes up and down', () => {
    const g = new AutoGate()
    fan(g, 8, 18, 6000)            // let it learn the room
    expect(fan(g, 8, 18, 6000)).toBe(false)
    // And the line sits above the loud half of it, not the quiet half.
    expect(g.threshold).toBeGreaterThan(18)
  })

  it('nor by a noisier one', () => {
    const g = new AutoGate()
    fan(g, 15, 30, 8000)
    expect(fan(g, 15, 30, 8000)).toBe(false)
  })

  /* And the fix is not "never open", which would pass every check above. */
  it('but a voice over that fan still opens it', () => {
    const g = new AutoGate()
    fan(g, 8, 18, 6000)
    expect(hold(g, 45, 240)).toBe(true)
  })

  it('and a voice over the noisier one does too', () => {
    const g = new AutoGate()
    fan(g, 15, 30, 8000)
    expect(hold(g, 70, 300)).toBe(true)
  })

  /*
   * Talk for a while, the floor learns your voice, the line climbs over it,
   * and you are cut off mid-sentence. Spoken rather than held - a run of
   * words with the gaps between them, which is what the floor is entitled to
   * assume of anybody.
   */
  it('does not cut somebody off for talking too long', () => {
    const g = new AutoGate()
    hold(g, 1.5, 3000)
    let open = false
    for (let word = 0; word < 30; word++) {
      open = hold(g, 30, 800)   // a phrase
      hold(g, 1.5, 240)         // and a breath
    }
    expect(open).toBe(true)
  })

  /*
   * The other half of that bargain. A gate held open for half a minute
   * without a single dip did not open for speech - a television left on, a
   * fan that started after the room was learned - and the floor only learns
   * while shut, so left alone it would stay open for ever.
   */
  it('lets go of something that turns out to be noise, not speech', () => {
    const g = new AutoGate()
    hold(g, 1.5, 2000)
    expect(hold(g, 26, 2000)).toBe(true)     // opens, reasonably
    expect(hold(g, 26, 40_000)).toBe(false)  // and thinks better of it
  })

  /*
   * Joining a call next to a fan. Until the room is known the line sits at
   * its floor, which means wide open - so how long that lasts is how long
   * everybody else hears the fan.
   */
  it('recognises a loud room at once', () => {
    const g = new AutoGate()
    expect(hold(g, 14, 400)).toBe(false)
  })

  it('believes a fan switching off within a few seconds', () => {
    const g = new AutoGate()
    fan(g, 10, 18, 8000)
    const before = g.threshold
    hold(g, 1, 4000)
    expect(g.threshold).toBeLessThan(before / 2)
  })

  it('keeps the line inside sensible bounds', () => {
    const silent = new AutoGate({ floor: 0 })
    hold(silent, 0, 2000)
    expect(silent.threshold).toBeGreaterThanOrEqual(GATE_MIN)

    const roar = new AutoGate()
    hold(roar, 120, 2000)
    expect(roar.threshold).toBeLessThanOrEqual(GATE_MAX)
  })

  it('shrugs off a measurement that is not a number', () => {
    const g = new AutoGate()
    expect(g.push(Number.NaN, 80)).toBe(false)
    expect(Number.isFinite(g.threshold)).toBe(true)
  })

  /*
   * The same behaviour at a different tick rate. A caller reading every 20ms
   * must not learn four times as fast as one reading every 80ms.
   */
  it('behaves the same however often it is asked', () => {
    const slow = new AutoGate()
    for (let t = 0; t < 6000; t += 80) slow.push(14, 80)
    const fast = new AutoGate()
    for (let t = 0; t < 6000; t += 20) fast.push(14, 20)
    expect(Math.abs(slow.threshold - fast.threshold)).toBeLessThan(1)
  })

  it('and a line somebody set is used exactly as given', () => {
    const g = new AutoGate({ fixed: 20 })
    hold(g, 1, 4000)
    expect(g.threshold).toBe(20)
    expect(hold(g, 15, 400)).toBe(false)
    expect(hold(g, 30, 240)).toBe(true)
  })
})

/**
 * Talking without stopping, which is what actually broke.
 *
 * Reported as "if I keep talking the bar keeps going up and up, so then my
 * voice is underneath the bar and it doesn't go through" - and that is
 * exactly what it did. After five seconds open, the gate decides it was
 * opened by noise and starts moving the floor towards the quietest moment
 * since it opened. The comment said a real voice teaches it almost nothing
 * because talking dips towards silence between words. It does - but the
 * level being looked at is smoothed over 150ms, and the gaps in speech are
 * shorter than that, so the dips were never in the number. Keep talking and
 * the floor learns your voice, the line climbs over it, and you are cut off
 * by having spoken for too long.
 *
 * The measurements, over twenty seconds of each, are what settled the fix.
 * Through the 150ms level, talking and a fan are identical: neither spends
 * any time below a third of its own peak, and both run unbroken for the full
 * twenty seconds. Through a 40ms one, talking is under a third of its peak a
 * fifth of the time and never goes more than a second and a half without a
 * gap, while a fan never dips at all.
 *
 * Not modulation depth, which was the obvious idea and is wrong: a wobbling
 * fan swings more than a monologue does.
 */
describe('somebody who does not pause for breath', () => {
  /*
   * Syllables at about four a second. The power makes the gaps between them
   * narrow and deep rather than a gentle wave - which is what a voice is, and
   * is the whole reason a fast look can see them.
   */
  const talking = (gate: AutoGate, peak: number, room: number, ms: number): boolean => {
    let open = gate.isOpen
    for (let t = 0; t < ms; t += 20) {
      const syll = Math.abs(Math.sin((t / 1000) * Math.PI * 4)) ** 1.5
      open = gate.push(room + peak * syll, 20)
    }
    return open
  }

  it('is still being heard a minute in', () => {
    const g = new AutoGate()
    hold(g, 0.6, 2000)
    expect(talking(g, 27, 0.6, 60_000)).toBe(true)
  })

  /* The floor is the thing that was moving, so it is the thing to check: a
     gate that happens to be open at the final instant proves nothing. */
  it('and the line has not climbed over them', () => {
    const g = new AutoGate()
    hold(g, 0.6, 2000)
    talking(g, 27, 0.6, 60_000)
    expect(g.threshold).toBeLessThan(27 / 2)
  })

  /*
   * The case that failed hardest: a quiet voice, where the line only has to
   * climb a little way to shut somebody out entirely. Before this it spent
   * the whole twenty seconds shut.
   */
  it('including somebody softly spoken', () => {
    const g = new AutoGate()
    hold(g, 0.6, 2000)
    expect(talking(g, 9, 0.6, 20_000)).toBe(true)
    expect(g.threshold).toBeLessThan(9)
  })

  /* And in a room that is not silent to begin with. */
  it('and in a room with something running in it', () => {
    const g = new AutoGate()
    fan(g, 3, 5, 4000)
    expect(talking(g, 20, 4, 30_000)).toBe(true)
  })
})

/**
 * How long it holds on after the last word.
 *
 * Reported as the microphone staying open two or three tenths of a second
 * longer than it needed to. It was 780ms from the last word to the gate
 * closing, and only 450 of that was the hold that carries a pause between
 * words. The other 330 was the smoothed level draining: it is 150ms of the
 * past, so it went on answering "still loud" long after the room had gone
 * quiet, and the hold only started once it had finished.
 *
 * Opening and staying open are different questions and were being asked of
 * the same number. Opening wants to be sure - one reading is a fraction of a
 * second of audio and a gate that opens on any of them chatters. Staying open
 * wants to be current. So opening asks the smoothed level and staying open
 * asks the quick one, which is 500ms now.
 *
 * Both ends are asserted, because a gate that closes fast and clips people
 * mid-sentence has not been improved.
 */
describe('letting go after somebody stops', () => {
  const talk = (g: AutoGate, ms: number): void => {
    for (let t = 0; t < ms; t += 20) {
      const syll = Math.abs(Math.sin((t / 1000) * Math.PI * 4)) ** 1.5
      g.push(0.6 + 78 * syll, 20)
    }
  }
  const silenceUntilShut = (g: AutoGate): number => {
    let held = 0
    while (g.push(0.6, 20) && held < 4000) held += 20
    return held
  }

  it('closes within about half a second', () => {
    const g = new AutoGate()
    hold(g, 0.6, 3000)
    talk(g, 3000)
    const tail = silenceUntilShut(g)
    expect(tail).toBeLessThan(600)
    /* And not instantly either: the hold is deliberate, and a gate that shuts
       the moment a word ends chops the end off it. */
    expect(tail).toBeGreaterThan(400)
  })

  /*
   * The other end of the same bargain. A pause between words is a few hundred
   * milliseconds; the gate must ride through one without letting go, or every
   * sentence arrives in pieces.
   */
  it('but rides through a pause between words', () => {
    const g = new AutoGate()
    hold(g, 0.6, 3000)
    talk(g, 1000)
    /* A third of a second of nothing, which is a long gap in a sentence. */
    let open = g.isOpen
    for (let t = 0; t < 330; t += 20) open = g.push(0.6, 20)
    expect(open, 'still open through the pause').toBe(true)
    /* And the next word is not clipped, because it never shut. */
    talk(g, 500)
    expect(g.isOpen).toBe(true)
  })
})
