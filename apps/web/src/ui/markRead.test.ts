import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readFrame } from '../lib/actions'

/**
 * Saying that a channel has been read.
 *
 * The frame existed, the server has always handled it, and nothing ever sent
 * one. So opening a conversation and reading it changed nothing anywhere: the
 * count stayed on the channel, the dot stayed by its name, and the number
 * stayed on the taskbar icon. Reported as reading a message and the
 * notification staying put, which is exactly what it was.
 *
 * A frame nothing sends is the same shape of fault as a component nothing
 * renders, and it hides the same way - everything looks present.
 */

const hook = readFileSync(resolve(process.cwd(), 'src/ui/useMarkRead.ts'), 'utf8')
const shell = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')

describe('marking a channel read', () => {
  it('has a frame the server understands', () => {
    expect(readFrame('c1')).toEqual({ t: 'read', channelId: 'c1' })
  })

  /* The fault itself: defined, never sent. */
  it('and something actually sends it', () => {
    expect(hook).toContain('send(readFrame(openId))')
    expect(shell).toContain('useMarkRead(')
  })

  /*
   * A conversation sitting open on a second monitor while somebody is in a
   * game has not been read. Marking it read there loses the one thing that
   * would have told them about it.
   */
  it('and only while the window is being looked at', () => {
    expect(hook).toContain('isWatching()')
    expect(hook).toContain('onAttentionChange')
    const guard = hook.slice(hook.indexOf('if (!openId'))
    expect(guard).toContain('!watching')
  })

  /* Attention is not React state, so coming back to the window has to
     re-run the effect rather than be noticed by chance on the next render. */
  it('and coming back to the window is enough to send it', () => {
    expect(hook).toContain('useEffect(() => onAttentionChange(setWatching), [])')
    const deps = hook.slice(hook.lastIndexOf('}, ['))
    expect(deps).toContain('watching')
  })

  /*
   * One frame per thing that arrives while you are watching, and one when a
   * channel is opened - not one per event of any kind.
   *
   * The open one is not housekeeping. The server keeps when each channel was
   * last read and works the badges out from it; a channel that has never
   * been marked read has no such time, and it counts nothing as unread there
   * on purpose, or a new member would arrive to a thousand. Sending only
   * when something was already waiting meant a channel somebody reads every
   * day never got a time at all - so the badge lived in the client's own
   * tally and vanished on reload.
   *
   * What is still guarded is the rest: the channel has to be open and the
   * window has to be being looked at.
   */
  it('and only for an open channel somebody is looking at', () => {
    expect(hook).toContain('if (!openId || !watching) return')
  })

  /* Still driven by what is waiting, so a message arriving while you watch
     clears itself. */
  it('and again when something new arrives', () => {
    const deps = hook.slice(hook.lastIndexOf('}, ['))
    expect(deps).toContain('waiting')
  })
})
