import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Losing a server takes you out of its call.
 *
 * Being in a voice room is held in one map in the gateway and nowhere else,
 * and three things can take away your right to be in one: the channel being
 * deleted, losing access to it, and losing the whole server. The first two
 * cleared the call. The third did not, in any of the ways it happens - being
 * kicked, being banned, or walking out.
 *
 * So somebody banned while sitting in a voice room stayed in it. Everybody
 * went on seeing them there and they went on talking, while the member list
 * showed them gone. Closing their socket is not the same thing: the app was
 * never told to hang up, and the map still had them.
 *
 * A ban that leaves the person audible is not a ban, which is why this is
 * checked rather than assumed - it is the one failure that would look, from
 * the outside, exactly like the feature working.
 */

const read = (...p: string[]) =>
  readFileSync(join(__dirname, ...p), 'utf8').split('\r\n').join('\n')

const gateway = read('gateway.ts')
const admin = read('routes', 'admin.ts')
const spaces = read('routes', 'spaces.ts')

/* Comments name the bug on purpose, so a plain search cannot tell the
   warning from the thing it warns about. */
const codeOnly = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from)
  expect(a, `${from} exists`).toBeGreaterThan(-1)
  const b = src.indexOf(to, a + from.length)
  expect(b, `${from} is bounded`).toBeGreaterThan(a)
  return src.slice(a, b)
}

describe('the clearing itself', () => {
  const fn = slice(gateway, 'export function clearVoiceForUserInSpace', '\n}')

  /*
   * The same three steps the moderator's remove-from-call does, because
   * they are what "out of the room" means here: gone from the map that is
   * the only record of it, told to hang up, and everybody else told.
   * Any two of the three is a state somebody can see the wrong half of.
   */
  it('does all three things being removed from a call means', () => {
    expect(fn).toContain('voice.delete(userId)')
    expect(fn).toContain("{ t: 'voice-kick' }")
    expect(fn).toContain('announceVoice()')
  })

  /* And only for a call in that server. Somebody's conversation, or another
     server's room, is not this server's to end. */
  it('and only when the call is in that server', () => {
    expect(fn).toContain('spaceOfChannel(state.channelId) !== spaceId')
  })
})

describe('every way of losing a server', () => {
  /* Kick and ban share removeFromSpace, so one call covers both - which is
     the whole reason that function exists. */
  it('clears the call when somebody is removed or banned', () => {
    const fn = slice(admin, 'function removeFromSpace', '\n  }')
    expect(codeOnly(fn)).toContain('clearVoiceForUserInSpace(id, target_space)')
  })

  /*
   * Before the socket closes, not after.
   *
   * The frame telling their app to hang up has to reach a socket that is
   * still open. The other order sends it into a closed one, which is the
   * same as not sending it - and the failure would only show on a client
   * that had not noticed the close yet.
   */
  it('and does it while their socket is still open', () => {
    const fn = codeOnly(slice(admin, 'function removeFromSpace', '\n  }'))
    const clear = fn.indexOf('clearVoiceForUserInSpace')
    const drop = fn.indexOf('disconnectUser(')
    expect(clear).toBeGreaterThan(-1)
    expect(drop).toBeGreaterThan(-1)
    expect(clear).toBeLessThan(drop)
  })

  /* And walking out yourself, which nobody reports because the person it
     happens to is the one who left. */
  it('and when somebody leaves of their own accord', () => {
    const route = slice(spaces, "app.post('/api/spaces/:id/leave'", '\n  app.')
    expect(codeOnly(route)).toContain('clearVoiceForUserInSpace(user.id, id)')
  })
})

/**
 * And the two that already did it still do.
 *
 * These are what made the gap findable - the codebase already knew that
 * losing access to a room has to end the call, in two of the three places
 * it can happen. Named here so that removing either of them fails loudly
 * rather than quietly restoring the same bug somewhere else.
 */
describe('the two that were already right', () => {
  it('a channel going away ends the calls in it', () => {
    expect(gateway).toContain('export function clearVoiceIn')
    expect(codeOnly(spaces)).toContain('clearVoiceIn(rooms)')
  })

  it('and losing a private channel ends yours', () => {
    expect(gateway).toContain('export function clearVoiceForUsers')
    expect(codeOnly(admin)).toContain('clearVoiceForUsers(')
  })
})
