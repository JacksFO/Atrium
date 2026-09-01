import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { SHARE_PRESETS, presetById, qualityLabel } from './sharequality'

/**
 * Turning somebody else's chosen preset back into a badge.
 *
 * The quality badge used to read a setting held on this machine, so it could
 * only ever describe your own share. A sharer now sends the id of the preset
 * they picked, and every viewer turns it back into the same "1080p 30FPS"
 * the sharer sees. This is the turning back.
 */
describe('the preset behind an id somebody else sent', () => {
  it('finds every preset there is', () => {
    for (const preset of SHARE_PRESETS) {
      expect(presetById(preset.id)).toBe(preset)
    }
  })

  it('gives a viewer the same words the sharer sees', () => {
    const high = presetById('high')
    expect(high).not.toBeNull()
    expect(qualityLabel(high!)).toBe('1080p 30FPS')
  })

  it('and nothing slower than thirty frames is offered any more', () => {
    // The 15fps and 10fps presets were removed on request. This is the check
    // that a future addition does not quietly reintroduce a crawling one.
    for (const preset of SHARE_PRESETS) {
      expect(preset.fps, `${preset.id} runs at ${preset.fps}fps`).toBeGreaterThanOrEqual(30)
    }
  })

  it('but a retired id still resolves to nothing rather than to a guess', () => {
    // Somebody on an older page may still be sharing at one of these. The
    // server still accepts the string; a viewer that has never heard of it
    // shows no badge, which is the honest answer.
    expect(presetById('light')).toBeNull()
    expect(presetById('sharp')).toBeNull()
  })

  /*
   * Null, not a default. A preset this client has never heard of - an older
   * or newer version at the other end - should show no badge rather than a
   * confident wrong one, and quietly falling back to Balanced would tell
   * every viewer a number that nobody had chosen.
   */
  it('says nothing about an id it does not know', () => {
    expect(presetById('ultra-mega-4k')).toBeNull()
    expect(presetById('')).toBeNull()
    expect(presetById(null)).toBeNull()
    expect(presetById(undefined)).toBeNull()
  })

  it('does not fall back to the default for an unknown one', () => {
    // The bug this guards against reads better as itself than as a comment:
    // find(...) ?? DEFAULT would have made every stranger's share "Balanced".
    expect(presetById('nonsense')).not.toBe(presetById('smooth'))
  })
})

describe('the ids the server is allowed to accept', () => {
  /*
   * The gateway keeps its own copy of this list, because it checks the string
   * before sending it on to everybody else. If a preset is added here and not
   * there, sharing at it would silently show no badge to anybody - so this
   * says out loud what that list has to contain.
   *
   * The gateway's copy is deliberately larger: it still accepts the two
   * retired ids, so a share running on an older page keeps its badge for the
   * people whose client still knows the name.
   */
  it('are exactly these four', () => {
    expect(SHARE_PRESETS.map((p) => p.id).sort())
      .toEqual(['fluid', 'high', 'large', 'smooth'])
  })
})

/**
 * A preset named for a resolution keeps that resolution.
 *
 * Three of the four told the encoder to hold the frame rate when the line
 * could not carry everything, which means giving up resolution instead - so a
 * share chosen as "720p 30" quietly became something less than 720p whenever
 * the upload tightened, and the number in its name was a wish. Reported as a
 * screen full of small text arriving unreadable, and it is the same fault at
 * every size: 1080p that has become 720p is no better a promise kept.
 *
 * Asked of every preset rather than of the one that was reported, because the
 * name is the promise in all four cases.
 */
describe('what a preset gives up when the line is tight', () => {
  it('is never the resolution it is named for', () => {
    expect(SHARE_PRESETS.length, 'there are presets to check').toBeGreaterThan(2)
    for (const preset of SHARE_PRESETS) {
      expect(preset.degradation, `${preset.name} holds its size`).toBe('maintain-resolution')
    }
  })

  /* And the name really is the resolution, or the promise above is being kept
     about a number nobody reads. */
  it('and the name says the size it holds', () => {
    for (const preset of SHARE_PRESETS) {
      expect(preset.name, `${preset.name} names its height`).toContain(String(preset.height))
    }
  })

  /*
   * The still ones ask the encoder for sharpness over smoothness. A share of
   * anything with text in it is the common case, and 'motion' invites the
   * encoder to soften detail to keep frames moving - which is the other half
   * of what made small text unreadable.
   */
  it('and the slower ones ask for detail rather than motion', () => {
    for (const preset of SHARE_PRESETS.filter((p) => p.fps <= 30)) {
      expect(preset.contentHint, preset.name).toBe('detail')
    }
  })
})

/**
 * What a screen is encoded with, and that the choice stays a deliberate one.
 *
 * VP9 is a third to a half more efficient than VP8 on the content a screen is
 * made of, and that applies to every frame. Against it: livekit-client forces
 * `contentHint = 'motion'` for a screen share on an SVC codec - which VP9 is -
 * because Chrome otherwise caps L1T3 screenshare at five frames a second, so
 * the 'detail' the slow presets ask for is not honoured while VP9 is on. It
 * also drops to a single spatial layer, so a viewer on a poor connection gets
 * fewer frames at full size rather than a smaller picture.
 *
 * The bet is that on a mostly still screen the motion hint has little to spend
 * itself on while the efficiency applies regardless. It is a bet, and the two
 * are told apart by looking rather than by reasoning - which is why the choice
 * lives in one constant with the argument written beside it, and why this
 * checks that it stayed there rather than checking which way it points.
 */
describe('the codec a screen share is published with', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/lib/voice.ts'), 'utf8')
    .split('\r\n').join('\n')

  /* Chosen in one place, so switching back is one word rather than a hunt. */
  it('is named in one constant, with the argument beside it', () => {
    expect(src).toMatch(/const SCREEN_CODEC: 'vp9' \| 'vp8'/)
    expect(src, 'the publish uses it rather than a literal')
      .toMatch(/videoCodec: SCREEN_CODEC/)
    expect(src, 'and the price of the choice is written down').toMatch(/five frames a second/)
  })

  /* A browser that cannot decode it still gets a picture. */
  it('with a fallback behind it', () => {
    expect(src).toMatch(/backupCodec: true/)
  })

  /*
   * The presets still ask for detail, and the type says plainly that a screen
   * share on an SVC codec will not get it. Asked of both so the two cannot
   * drift into disagreeing quietly.
   */
  it('and the slower presets still ask for detail', () => {
    for (const preset of SHARE_PRESETS.filter((p) => p.fps <= 30)) {
      expect(preset.contentHint, preset.name).toBe('detail')
    }
  })

  /* And dynacast stays on: it is what stops layers nobody watches being
     encoded, whatever codec is in use. */
  it('with dynacast on', () => {
    expect(src).toMatch(/dynacast:\s*true/)
  })
})
