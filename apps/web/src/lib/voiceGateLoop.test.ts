import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AutoGate } from './autogate'

/**
 * What the gate is allowed to listen to.
 *
 * The first version of voice activation measured the very track it was
 * silencing, on the reasoning that what is being sent is the honest thing to
 * measure. It is - and it is also silent the moment the gate shuts, so the
 * detector heard a perfectly quiet room, kept the gate shut, and went on
 * hearing a quiet room for ever.
 *
 * A gate starts shut, so this latched on the first quiet moment of the call,
 * which in a quiet room is the first reading. Not "cut off after a pause":
 * the microphone never opened at all, for anybody, and no ring ever appeared
 * round your own face, because nothing was ever being sent.
 *
 * The trap is not in AutoGate, which is why AutoGate's own tests all passed.
 * It is in what the loop is wired to, so that is what these two say.
 */

/**
 * A stretch of a real call, as levels, forty a second: the room on its own,
 * somebody talking, a pause long enough to count as a stop, then talking
 * again. The room is a quiet 3 and the voice a normal 25 - the same units
 * everything else in this feature is written in.
 */
const ROOM = 60
const SPEECH = 40
const CALL = [
  ...Array.from({ length: ROOM }, () => 3), // a second and a half of room
  ...Array.from({ length: SPEECH }, () => 25), // somebody talks
  ...Array.from({ length: ROOM }, () => 3), // and stops
  ...Array.from({ length: SPEECH }, () => 25), // and talks again
]
const FIRST = [ROOM, ROOM + SPEECH] // where each phase of it starts and ends
const PAUSE = [ROOM + SPEECH, ROOM * 2 + SPEECH]
const AGAIN = [ROOM * 2 + SPEECH, CALL.length]

/**
 * Play the call to a gate, saying what the gate is allowed to hear, and
 * report what it did in each phase. It starts shut, as a gate does, so what
 * matters is not whether it is ever shut but whether it opens for a voice.
 */
function play(hear: (raw: number, published: boolean) => number) {
  const detector = new AutoGate()
  /* The published track, which is enabled until the gate first shuts it -
     joining a call and being inaudible until you speak is not the deal. */
  let published = true
  const states = CALL.map((raw) => {
    const open = detector.push(hear(raw, published), 25)
    published = open
    return open
  })
  const during = ([from, to]: number[]) => states.slice(from, to)
  return {
    heardTheVoice: during(FIRST).some(Boolean),
    shutForThePause: during(PAUSE).at(-1) === false,
    heardItAgain: during(AGAIN).some(Boolean),
  }
}

describe('a gate fed by its own output', () => {
  it('latches shut and never opens, however loudly anybody talks', () => {
    /* What a meter on the *gated* track hears: nothing, once it is shut. */
    const call = play((raw, published) => (published ? raw : 0))

    expect(call.shutForThePause, 'it is shut, which alone looks right').toBe(true)
    expect(call.heardTheVoice, 'but it never opened for the first words').toBe(false)
    expect(call.heardItAgain, 'nor for any that came after').toBe(false)
  })

  it('where one fed by the microphone opens again', () => {
    /* The microphone, which goes on hearing the room whatever the gate is
       doing to what is published. */
    const call = play((raw) => raw)

    expect(call.heardTheVoice, 'it opens for the first words').toBe(true)
    expect(call.shutForThePause, 'shuts for the pause').toBe(true)
    expect(call.heardItAgain, 'and opens again when somebody speaks').toBe(true)
  })
})

describe('and the hook is wired that way', () => {
  const src = readFileSync(join(__dirname, '..', 'ui', 'useVoiceGate.ts'), 'utf8')

  /*
   * The requirement is that what is measured goes on hearing the room while
   * the published track is switched off. This used to be written down as
   * "opens its own capture", which is one way to satisfy it and not the
   * requirement - and it was the expensive way: a second getUserMedia is a
   * second chain of gain, echo cancellation and noise suppression, so what
   * was measured drifted from what was sent, and a voice cut out while the
   * bar sat above the line.
   *
   * A clone of the published track satisfies the same requirement without
   * the second capture: it shares the capture and carries its own on/off.
   * So what is asserted now is the clone, and that the published track is
   * never listened to directly.
   */
  it('measures a copy of what is published, not the thing being gated', () => {
    expect(src).toContain('.clone()')
    expect(src).toContain('listenTo(')
    expect(src, 'a second getUserMedia is what this replaced')
      .not.toMatch(/listen\(/)
  })

  /* And the copy is given back. A cloned track holds the device open just as
     the original does, so one left running is a microphone light that never
     goes out. */
  it('and stops the copy when it is done with it', () => {
    expect(src).toContain('heard.stop()')
  })
})

/**
 * The ways a gate can hold a microphone shut without anybody deciding to.
 *
 * All four of these were in the client before this one, each written for a
 * failure somebody hit, and none of them survived the rewrite. They share a
 * shape: something stops the readings arriving, the gate goes on believing
 * the last thing it was told, and the last thing it was told is usually
 * "quiet" - so somebody talks to a room that cannot hear them, and nothing
 * anywhere says so.
 *
 * Asserted from the source because the alternative is a fake AudioContext, a
 * fake MediaStream and a fake document, and a test built out of three fakes
 * would be asserting that the fakes were wired up.
 */
describe('failing open rather than shut', () => {
  const src = readFileSync(join(__dirname, '..', 'ui', 'useVoiceGate.ts'), 'utf8')
  const meter = readFileSync(join(__dirname, 'micmeter.ts'), 'utf8')

  it('is reading the files it means to', () => {
    expect(src).toContain('export function useVoiceGate')
    expect(meter).toContain('export function listenTo')
  })

  /*
   * A background tab has its timers throttled to about one a second, so a
   * reading can be a second old rather than twenty milliseconds old. Deciding
   * on it is deciding on the room as it was a second ago.
   */
  it('ignores a reading that arrived too late to mean anything', () => {
    expect(src).toContain('STALE_MS')
    expect(src).toMatch(/since > STALE_MS/)
  })

  /*
   * And when no reading arrives at all. A suspended audio context makes the
   * analyser answer zeros, which reads as a perfectly silent room - so the
   * meter says nothing instead, and this is what notices the silence.
   */
  it('opens when the meter has gone quiet altogether', () => {
    expect(meter).toContain("ctx.state !== 'running'")
    expect(meter, 'and asks for it back').toContain('ctx.resume')
    expect(src).toMatch(/heardAt > STALE_MS/)
  })

  /* Returning to the app: the call library re-acquires a track partly from
     whether it is switched on, so a gate that happened to be shut at that
     moment made it throw the microphone away. */
  it('opens on coming back to the app', () => {
    expect(src).toContain('visibilitychange')
    expect(src, 'and stops listening for it afterwards')
      .toContain('removeEventListener')
  })

  /* Whatever stops this - the setting turned off, the call ended, a mute -
     must not leave a microphone shut by a thing that is no longer running. */
  it('and on the way out, whatever the reason', () => {
    const at = src.lastIndexOf('return () => {')
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at)).toContain('gate(true)')
  })
})
