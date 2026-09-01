import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Two bars of controls for one call.
 *
 * The stage has a full set, and the strip above the profile — which is what
 * you are looking at whenever you are in a call and reading something else —
 * had a smaller one that had drifted. Sharing could be started from it but
 * never stopped, and the sound going out with the picture could not be
 * touched at all: you had to open the stage to quieten your own share.
 *
 * Neither is the "real" bar. A control that exists in one and not the other
 * is a control somebody cannot find, so this compares them.
 */

const shell = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')
const stage = readFileSync(resolve(process.cwd(), 'src/ui/Stage.tsx'), 'utf8')

/** The strip above the profile, and the menu its arrow opens. */
const bar = shell.slice(shell.indexOf('const shareItems: MenuItem[]'),
  shell.indexOf('</div>', shell.indexOf('title="Leave the call"')))

describe('the call controls above the profile', () => {
  it('is the bar this is about', () => {
    /* Or every assertion below is about an empty string. */
    expect(bar.length).toBeGreaterThan(200)
    expect(bar).toContain('call.setMuted')
  })

  /* The one that sent Jack to the stage to turn his own sound down. */
  it('can turn the shared sound on and off', () => {
    expect(bar).toContain('call.setShareAudio')
    /* And the stage still can, so this is parity rather than a swap. */
    expect(stage).toContain('setShareAudio')
  })

  /* Only offered where there is something to turn off — a share started
     without sound never captured any. Both bars agree on that. */
  it('and only where a share actually carries sound', () => {
    expect(bar).toContain('c.shareAudio.has')
    expect(stage).toContain('call.shareAudio.has')
  })

  /* The quality needed the stage too, and putting each of these on the bar as
     its own glyph is how four controls quietly become seven. */
  it('and can change the quality without opening the stage', () => {
    expect(bar).toContain('call.setShareQuality')
    expect(bar).toContain('SHARE_PRESETS.map')
  })

  /* A list of four sizes with nothing marked does not say which is running. */
  it('and marks the quality already going out', () => {
    expect(bar).toContain('x.id === preset.id')
  })

  /* Behind one arrow rather than spread across the bar. */
  it('and keeps them all behind a single arrow', () => {
    const strip = shell.slice(shell.indexOf('<div className="vctl">'),
      shell.indexOf('</div>', shell.indexOf('title="Leave the call"')))
    expect(strip).toContain('aria-label="Sharing options"')
    /* Five: mute, deafen, share, the arrow, leave. A sixth means something
       has been put back on the bar instead of into the menu. */
    expect(strip.match(/<button/g)).toHaveLength(5)
  })

  /* It passed a literal true, so the button that starts a share could not
     end one. */
  it('and stops a share as well as starting one', () => {
    expect(bar).toContain('call.setShare(!sharing, true)')
    expect(bar).not.toContain('call.setShare(true, true)')
  })

  /* Read off the roster rather than kept alongside it: a second copy of
     "am I sharing" is a second thing that can be wrong. */
  it('and reads whether it is sharing from the call itself', () => {
    expect(shell).toContain("m.id === world.me.id)?.sharing")
  })
})
