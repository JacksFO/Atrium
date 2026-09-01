import { describe, it, expect } from 'vitest'
import { TONES } from './sound'

/**
 * No two sounds may be the same sound.
 *
 * They are all short sine motifs from the same generator, so it is easy to
 * write one that happens to be note for note identical to another and never
 * notice - the two events rarely happen together, and by the time somebody
 * is confused nobody remembers which is which.
 *
 * That is not hypothetical: the sound for somebody starting to watch your
 * screen shipped as 660 then 990, which was exactly the sound of a call
 * being answered.
 */
type Motif = { name: string; freqs: number[] }

/*
 * Read from the table rather than out of the source.
 *
 * This used to pick the numbers out of each function body with a regular
 * expression, because that was the only way to reach them - they were written
 * inline at the point of use. They are a table now, exported, so this asks
 * the module what the sounds are instead of reading the file that defines
 * them and hoping the shape of the code has not moved.
 */
function motifs(): Motif[] {
  return Object.entries(TONES).map(([name, tones]) => ({
    name, freqs: tones.map((t) => t.freq),
  }))
}

describe('notification sounds', () => {
  const all = motifs()

  it('finds them all', () => expect(all.length).toBeGreaterThanOrEqual(8))

  it('are all different from each other', () => {
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const { name, freqs } of all) {
      const key = freqs.join('-')
      const first = seen.get(key)
      if (first) clashes.push(`${name} is note for note ${first} (${key})`)
      else seen.set(key, name)
    }
    expect(clashes, clashes.join('\n')).toEqual([])
  })

  /*
   * And different in SHAPE, not merely in pitch.
   *
   * Note-for-note was too weak a rule. Under it, a message arriving, a
   * mention, the connection coming back and a call being answered were all a
   * rising fifth - four events, one shape, told apart only by how high it
   * started. Nobody learns four sounds that are the same sound played
   * higher, which is the whole point of having sounds at all.
   *
   * The shape is the sequence of steps in semitones: [7] is a rising fifth
   * whatever key it is in, [-7,7] falls and comes back, [4,0] steps up and
   * holds. Two sounds may share notes; they may not share a shape.
   */
  it('are different in shape, not only in pitch', () => {
    const shape = (freqs: number[]) =>
      freqs.slice(1).map((f, i) => Math.round(12 * Math.log2(f / freqs[i]!))).join(',')

    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const { name, freqs } of all) {
      // A single note has no steps, so it is judged on pitch below instead.
      if (freqs.length < 2) continue
      const key = shape(freqs)
      const first = seen.get(key)
      if (first) clashes.push(`${name} is the same shape as ${first} (${key} semitones)`)
      else seen.set(key, name)
    }
    expect(clashes, clashes.join('\n')).toEqual([])
  })

  it('and single notes are far enough apart to tell apart', () => {
    // Nothing to shape a one-note blip with but its pitch, so that has to do
    // the work. A tone apart would be a guess; this is a comfortable jump.
    const singles = all.filter((m) => m.freqs.length === 1)
    const tooClose: string[] = []
    for (const a of singles) {
      for (const b of singles) {
        if (a.name >= b.name) continue
        const gap = Math.abs(Math.round(12 * Math.log2(b.freqs[0]! / a.freqs[0]!)))
        if (gap < 5) tooClose.push(`${a.name} and ${b.name} are only ${gap} semitones apart`)
      }
    }
    expect(tooClose, tooClose.join('\n')).toEqual([])
  })

  it('stay inside a range people can hear comfortably', () => {
    const wrong = all.flatMap(({ name, freqs }) =>
      freqs.filter((f) => f < 200 || f > 2000).map((f) => `${name}: ${f}Hz`))
    expect(wrong, wrong.join('\n')).toEqual([])
  })
})

describe('the ring is in the scheme too', () => {
  /*
   * It used to build its tones inline rather than through play(), so the
   * scanner above never saw it - which meant the one sound somebody has to
   * recognise from another room was the one sound exempt from every rule
   * here. It is in the table with the rest now, so the checks above already
   * cover it and what is left is what is particular to a ring.
   */
  const ring = TONES.ring.map((t) => t.freq)

  it('is not the shape of any other sound', () => {
    const shape = (freqs: number[]) =>
      freqs.slice(1).map((f, i) => Math.round(12 * Math.log2(f / freqs[i]!))).join(',')
    const mine = shape(ring)
    const others = motifs()
      .filter((m) => m.name !== 'ring' && m.freqs.length > 1)
      .map((m) => ({ name: m.name, key: shape(m.freqs) }))
    const clash = others.find((o) => o.key === mine)
    expect(clash?.name, `the ring is the same shape as ${clash?.name}`).toBeUndefined()
  })

  it('and stays in the same comfortable range', () => {
    expect(ring.every((f) => f >= 200 && f <= 2000)).toBe(true)
  })

  /*
   * Long enough to be a phrase and short enough to leave a silence. Four
   * notes inside a second, then room before it comes round again - the gap
   * is what stops a ring becoming a drone.
   */
  it('is a phrase with a gap after it', () => {
    const ends = Math.max(...TONES.ring.map((t) => t.at + t.length))
    expect(TONES.ring.length).toBeGreaterThanOrEqual(3)
    expect(ends).toBeLessThan(2.0)
  })
})

describe('a screen going up and coming down', () => {
  const all = motifs()
  const by = (name: string) => all.find((m) => m.name === name)

  it('both exist', () => {
    expect(by('shareStart')?.freqs).toBeDefined()
    expect(by('shareStop')?.freqs).toBeDefined()
  })

  it('are the same notes each way round, so they read as a pair', () => {
    const up = by('shareStart')!.freqs
    const down = by('shareStop')!.freqs
    expect(new Set(up)).toEqual(new Set(down))
    expect(up[0]).toBeLessThan(up[up.length - 1]!)
    expect(down[0]).toBeGreaterThan(down[down.length - 1]!)
  })

  /*
   * The design claim, written down so the next sound cannot quietly take it.
   *
   * Every other motif moves on every note. Half-heard, a repeated note is
   * what says "a screen" rather than "somebody arrived" - and if something
   * else adopts the same trick, that stops being true without anybody
   * noticing until two events sound alike.
   */
  it('are the only sounds with a note repeated', () => {
    const repeats = all
      .filter(({ freqs }) => freqs.some((f, i) => i > 0 && f === freqs[i - 1]))
      .map((m) => m.name)
      .sort()
    expect(repeats).toEqual(['shareStart', 'shareStop'])
  })

  it('and are not the sound of somebody watching yours', () => {
    // Closely related events, so worth saying out loud rather than trusting
    // the duplicate check to catch it one day.
    expect(by('shareStart')!.freqs).not.toEqual(by('watchStart')!.freqs)
    expect(by('shareStop')!.freqs).not.toEqual(by('watchStop')!.freqs)
  })
})

/**
 * Every sound is in tune.
 *
 * Reported as "the calling one really sucks and does not sound nice", which
 * sounds like a matter of taste and was not. The ring was 620 to 760 hertz:
 * 3.52 semitones, a quarter-tone adrift between a minor and a major third,
 * belonging to no interval at all. Every other sound in the app was within a
 * hundredth of a semitone of a real one, so it was the single odd number out
 * of twenty-odd, and it was the one somebody could hear.
 *
 * Whether a sound is pleasant is a matter for ears. Whether it is in tune is
 * arithmetic, and arithmetic is checkable - so this checks it, and the next
 * sound anybody writes gets told before somebody has to listen to it for a
 * fortnight and put it on a list.
 */
describe('every sound sits on a real interval', () => {
  /** Distance between two pitches, in semitones. Twelve to the octave. */
  const semitones = (a: number, b: number) => 12 * Math.log2(b / a)

  /*
   * A hundredth of a semitone is a rounded frequency; a tenth is a mistake.
   * The widest miss among the sounds that were always fine is 0.02, and the
   * ring as reported was 0.48 - so anything past a twentieth is the fault
   * and nothing legitimate is near it.
   */
  const TOLERANCE = 0.05

  for (const [name, tones] of Object.entries(TONES)) {
    it(`${name} moves by whole semitones`, () => {
      const steps = tones.slice(1).map((tone, i) => {
        const step = semitones(tones[i]!.freq, tone.freq)
        return { from: tones[i]!.freq, to: tone.freq, step, off: Math.abs(step - Math.round(step)) }
      })
      const adrift = steps.filter((s) => s.off > TOLERANCE)
      expect(adrift, JSON.stringify(adrift)).toEqual([])
    })
  }

  /* The one that was wrong, named, so the fix cannot be quietly undone. */
  it('and the ring is the marimba that was chosen by ear', () => {
    const notes = TONES.ring.map((t) => t.freq)
    expect(notes).toEqual([587.33, 440, 587.33, 739.99])
    const steps = notes.slice(1).map((f, i) => Math.round(semitones(notes[i]!, f)))
    expect(steps).toEqual([-5, 5, 4])
  })

  /*
   * And it is struck rather than held. Being in tune was not enough on its
   * own: a sine has one frequency and nothing else in it, so however it is
   * shaped it sounds like a test tone. The second oscillator is the timbre.
   */
  it('and is played on something, rather than beeped', () => {
    expect(TONES.ring.every((t) => t.ratio === 4)).toBe(true)
    expect(TONES.ring.every((t) => (t.attack ?? 1) < 0.01)).toBe(true)
  })
})

/**
 * The four short ones are played on something, not beeped.
 *
 * Chosen off a bench of before-and-after. Nothing about them was out of tune -
 * that was the ring - so not a note moved. What changed is the shape: a slower
 * attack so a sound arrives rather than clicks, a longer tail so it stops
 * rather than being cut off, and a quiet octave above the fundamental for body.
 *
 * Asserted because it is invisible. A sound with the wrong envelope plays
 * perfectly happily and simply sounds cheap, so nothing else here would ever
 * notice it being undone.
 */
describe('the sounds heard most often', () => {
  const WARMED = ['ping', 'mention', 'answered', 'hangup'] as const

  for (const name of WARMED) {
    it(`${name} arrives rather than clicking`, () => {
      /* The engine's default is 12ms, which is a click at these pitches. */
      expect(TONES[name].every((t) => (t.attack ?? 0.012) > 0.012)).toBe(true)
    })

    it(`${name} is played on something`, () => {
      expect(TONES[name].every((t) => t.ratio === 2)).toBe(true)
      /* Gently. These play fifty times an evening and have to stay
         forgettable - the ring can afford to be an instrument; these cannot. */
      expect(TONES[name].every((t) => (t.index ?? 0) > 0 && (t.index ?? 0) < 0.6)).toBe(true)
    })
  }

  /* The whole point of leaving the notes alone. */
  it('and not one of them changed key', () => {
    expect(TONES.ping.map((t) => t.freq)).toEqual([880, 1174])
    expect(TONES.mention.map((t) => t.freq)).toEqual([932, 1661])
    expect(TONES.answered.map((t) => t.freq)).toEqual([660, 990])
    expect(TONES.hangup.map((t) => t.freq)).toEqual([660, 440])
  })
})

