import { describe, expect, it } from 'vitest'
import { levelOf } from './micmeter'
import { AutoGate } from './autogate'

/**
 * The units the gate is judging, and why they have to be these ones.
 *
 * Every threshold in AutoGate - the margin of 1.9, the flat 5, the floor of 3
 * and the ceiling of 50 - was tuned against the root mean square of the
 * analyser's frequency bytes, which are a decibel scale. The rewrite of the
 * client measured the time domain instead, the mean departure from silence,
 * and multiplied it by a factor chosen so that ordinary speech landed in the
 * teens. Ordinary speech did.
 *
 * Quiet speech did not, and that is the whole complaint. Decibels compress: a
 * voice twenty dB down still reads most of the way up a dB scale, and reads
 * almost nothing on a linear one. The line stayed where it was while the
 * quantity underneath it changed shape.
 *
 * So these check the property that matters rather than the arithmetic: a soft
 * voice has to stay well clear of the room, and it has to clear the line the
 * gate draws without anybody touching a slider.
 */

const BINS = 256

/** The analyser's bytes are a dB window: 0 is -100dB, 255 is -30dB. */
const atDb = (db: number) => Math.max(0, Math.min(255, Math.round(((db + 100) / 70) * 255)))

/** A spectrum where the voice band sits at one level and the rest much lower. */
const speechAt = (db: number): Uint8Array => {
  const out = new Uint8Array(BINS)
  for (let i = 0; i < BINS; i++) {
    /* 300Hz to 3.4kHz at 48kHz over 512 points is roughly bins 3 to 36. */
    out[i] = i >= 3 && i <= 36 ? atDb(db) : atDb(db - 35)
  }
  return out
}

/** A quiet room: everything down at the bottom of the window. */
const room = (): Uint8Array => {
  const out = new Uint8Array(BINS)
  for (let i = 0; i < BINS; i++) out[i] = atDb(-92)
  return out
}

describe('the scale the thresholds were written in', () => {
  it('reads nothing for nothing', () => {
    expect(levelOf(new Uint8Array(BINS))).toBe(0)
    expect(levelOf(new Uint8Array(0))).toBe(0)
  })

  /*
   * The property the linear measure lost. A voice twenty decibels quieter is
   * a hundredth of the power, and on a linear scale it all but disappears;
   * here it should still read most of what a loud one does.
   */
  it('keeps a quiet voice within reach of a loud one', () => {
    const loud = levelOf(speechAt(-38))
    const soft = levelOf(speechAt(-58))
    expect(soft).toBeGreaterThan(loud * 0.45)
  })

  it('while still putting the loud one higher', () => {
    expect(levelOf(speechAt(-38))).toBeGreaterThan(levelOf(speechAt(-58)))
  })

  it('and a quiet room well below either', () => {
    expect(levelOf(room())).toBeLessThan(levelOf(speechAt(-58)) / 2)
  })
})

/**
 * And the two ends joined up: what the meter measures, put through the gate
 * that judges it. This is the reported failure, written down.
 */
describe('somebody speaking softly, through the whole thing', () => {
  const feed = (gate: AutoGate, bins: Uint8Array, ms: number): boolean => {
    let open = gate.isOpen
    for (let t = 0; t < ms; t += 20) open = gate.push(levelOf(bins), 20)
    return open
  }

  it('is heard, without touching a slider', () => {
    const g = new AutoGate()
    feed(g, room(), 3000)
    expect(feed(g, speechAt(-58), 2000)).toBe(true)
  })

  it('and so is somebody speaking normally', () => {
    const g = new AutoGate()
    feed(g, room(), 3000)
    expect(feed(g, speechAt(-38), 2000)).toBe(true)
  })

  /* The room itself still must not open it, or this has bought nothing. */
  it('while the room on its own does not open it', () => {
    const g = new AutoGate()
    expect(feed(g, room(), 8000)).toBe(false)
  })
})
