import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Mute and deafen are one control with two buttons.
 *
 * Deafening mutes you: hearing nobody while they can still hear you is a
 * state people get into by accident and then talk into. The two halves that
 * were missing are the ways back out of it.
 */
describe('deafening', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/ui/useCall.ts'), 'utf8')
  const body = (name: string) => {
    const at = src.indexOf(`const ${name} = useCallback`)
    return src.slice(at, src.indexOf('}, [])', at)).replace(/\/\*[\s\S]*?\*\//g, '')
  }

  it('mutes you as well', () => {
    expect(body('setDeaf')).toMatch(/deaf: on, muted: on/)
  })

  /* Undeafening puts the microphone back, because taking it away was this
     doing it rather than something anybody asked for. */
  it('and undeafening puts the microphone back', () => {
    expect(body('setDeaf')).toContain('setMic(!on')
  })

  /* Somebody reaching for the microphone means to talk to people, and
     talking to people you cannot hear is the same accident from the other
     end. */
  it('and unmuting undeafens', () => {
    expect(body('setMuted')).toMatch(/deaf: on \? c\.deaf : false/)
  })

  /* Muting on its own leaves deafening alone: they are one control, not the
     same button. */
  it('but muting does not deafen', () => {
    expect(body('setMuted')).not.toMatch(/deaf: true/)
  })
})

describe('joining a voice room', () => {
  const shell = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')

  /*
   * Walking into a room is not the same as wanting to look at it. Most of
   * the time somebody joins to talk and carries on reading whatever they
   * were reading, and the stage covering that is the app deciding for them.
   */
  it('does not open the stage', () => {
    const at = shell.indexOf("if (c?.kind === 'voice') {")
    expect(at).toBeGreaterThan(0)
    const body = shell.slice(at, at + 260)
    expect(body).toContain('void call.join(id)')
    expect(body).not.toMatch(/join\(id\)\.then\(\(\) => setOnStage/)
  })

  /* But pressing a room you are already in does, because that is asking. */
  it('though pressing one you are already in does', () => {
    expect(shell).toMatch(/if \(call\.call\.channel === id\) \{ setOnStage\(true\); return \}/)
  })
})
