import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Telling the server where you are in voice.
 *
 * The gateway keeps one map of who is in which room and it is filled by
 * three frames and nothing else. The React port sent none of them. As far as
 * the server was concerned nobody was ever in a voice channel: rooms said
 * "Nobody in here" with people sitting in them, and a call in a conversation
 * could never end - the count of people in it was zero before anybody joined
 * and zero after, so the two minute clock had nothing to run out on and
 * "Join call" stayed for ever.
 *
 * Reported as the third thing: a call started, left, and still offering to
 * be joined by two people who were not in it.
 */

const hook = readFileSync(resolve(process.cwd(), 'src/ui/useVoiceState.ts'), 'utf8')
const shell = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')

describe('the voice frames', () => {
  it('are all three, and something sends them', () => {
    for (const frame of ['voice-join', 'voice-leave', 'voice-update']) {
      expect(hook, `${frame} is never sent`).toContain(`t: '${frame}'`)
    }
    expect(shell).toContain('useVoiceState(')
  })

  /*
   * Leaving is said out loud rather than left to the socket closing. Without
   * it the server only drops somebody when their connection goes, so walking
   * out of a room leaves their avatar sitting in it for everybody else.
   */
  it('and leaving is announced, not waited for', () => {
    const leaving = hook.slice(hook.indexOf('if (!here)'))
    expect(leaving.slice(0, 260)).toContain("t: 'voice-leave'")
  })

  /*
   * A move is a join of the new room. Sending a leave first would empty the
   * room for a moment, and an empty room ends a call that is still happening.
   */
  it('and moving rooms does not leave first', () => {
    const moving = hook.slice(hook.indexOf('if (inRoom.current !== here)'))
    const upToJoin = moving.slice(0, moving.indexOf("t: 'voice-join'"))
    expect(upToJoin).not.toContain('voice-leave')
  })

  /* A re-render is not news. Without this every render of the shell would be
     a frame on the wire for everybody in the room to be told about. */
  it('and says nothing when nothing changed', () => {
    expect(hook).toContain('told.current === now')
  })

  /*
   * What is being published, from the media server's own roster, rather than
   * a flag kept alongside it that can disagree with it.
   */
  it('and reads sharing and camera from the roster', () => {
    expect(hook).toContain('call.members.find((m) => m.id === meId)')
    expect(hook).toContain('!!mine?.sharing')
    expect(hook).toContain('!!mine?.cam')
  })
})
