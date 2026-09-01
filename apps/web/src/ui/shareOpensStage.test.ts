import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Pressing share puts you on the stage.
 *
 * Said in the source rather than by driving a real share, because what makes
 * this correct is *which branch* the stage is opened from, and there is no
 * screen to pick in a test. The mistake this guards is the obvious way to
 * write it: open the stage on the press. Opening the picker and changing your
 * mind is the commonest thing anybody does with it, and it must not move you
 * somewhere you did not ask to be.
 *
 * `setShare` answers whether a share is now running, which is the only way to
 * tell the two apart - a dismissed picker and a chosen screen both come back
 * as an ordinary resolved promise.
 */
describe('starting a share', () => {
  const shell = readFileSync(join(__dirname, 'Shell.tsx'), 'utf8')
  const useCall = readFileSync(join(__dirname, 'useCall.ts'), 'utf8')

  it('opens the stage only once a screen has actually been chosen', () => {
    const at = shell.indexOf('call.setShare(!sharing, true)')
    expect(at, 'the share button is still wired this way').toBeGreaterThan(0)
    const after = shell.slice(at, at + 200)
    expect(after).toContain('.then((started)')
    expect(after).toContain('if (started) onStage()')
  })

  it('and setShare says whether one is, rather than answering nothing', () => {
    expect(useCall).toContain('setShare: (on: boolean, audio?: boolean) => Promise<boolean>')
    /* Every arm answers, including the two that swallow a cancel: a promise
       that resolves undefined reads as "no share" only by accident. */
    expect(useCall).toContain('return went')
  })
})
