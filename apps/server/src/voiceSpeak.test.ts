import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VOICE_CHANNEL_PERMISSIONS, CHANNEL_PERMISSIONS } from './permissions.js'

/**
 * Who may talk in a voice channel, and whether anybody can say so.
 *
 * The voice token is minted with canPublish taken from a permission read in
 * that channel - speaking in a room is saying something in it, so it is
 * send_messages. That has always been the rule and it works: deny it in a
 * voice channel and the token comes back unable to publish, which is
 * enforcement in the one place a patched client cannot reach.
 *
 * What was missing was any way to set it. The permissions pane offers
 * whatever VOICE_CHANNEL_PERMISSIONS lists, and this was not on it - so the
 * server enforced a rule the app gave nobody a way to write. That is the
 * quiet half of a permissions bug: not a switch that does nothing, but a rule
 * with no switch, which reads as a feature nobody built.
 */

const src = readFileSync(join(__dirname, 'index.ts'), 'utf8').split('\r\n').join('\n')

describe('speaking in a voice channel', () => {
  /** The permission the voice token actually reads, out of the route. */
  const governing = (() => {
    const from = src.indexOf('const canSpeak =')
    expect(from, 'the voice token decides canSpeak somewhere').toBeGreaterThan(-1)
    const decision = src.slice(from, src.indexOf('\n\n', from))
    expect(decision.length).toBeLessThan(600)
    const named = /permissionsIn\([^)]*\)\.has\('([a-z_]+)'\)/.exec(decision)
    expect(named, 'and reads a named permission in that channel').toBeTruthy()
    return named![1]!
  })()

  /*
   * In that channel, not across the server. A voice room that takes speaking
   * away is the whole point, and a server-wide read would hand the token
   * canPublish on the strength of being allowed to talk somewhere else.
   */
  it('is decided in the channel being joined', () => {
    const from = src.indexOf('const canSpeak =')
    const decision = src.slice(from, src.indexOf('\n\n', from))
    expect(decision).toContain('permissionsIn(')
    expect(decision).not.toContain('permissionsFor(')
  })

  it('and whatever decides it can be set against a voice channel', () => {
    expect(VOICE_CHANNEL_PERMISSIONS as readonly string[]).toContain(governing)
  })

  /* And against a text one, because the same permission means the same thing
     in both and the two lists must not disagree about it. */
  it('and against a text channel too', () => {
    expect(CHANNEL_PERMISSIONS as readonly string[]).toContain(governing)
  })

  /*
   * The voice list stays the short one. Its whole reason is that most
   * permissions have nothing to say about a room with no messages in it, and
   * a list that grew to match the text one would be the thing it exists to
   * avoid.
   */
  it('and the voice list is still the shorter of the two', () => {
    expect(VOICE_CHANNEL_PERMISSIONS.length).toBeLessThan(CHANNEL_PERMISSIONS.length)
    for (const p of VOICE_CHANNEL_PERMISSIONS) {
      expect(CHANNEL_PERMISSIONS as readonly string[]).toContain(p)
    }
  })
})

/**
 * And a server mute still beats all of it.
 *
 * Two different questions - may you talk here, and has a moderator silenced
 * you - and the token has to answer no if either does. Kept as a test because
 * the shape invites an `||` where an `&&` belongs, and that mistake gives a
 * muted person their voice back.
 */
describe('a server mute', () => {
  it('is combined with it rather than replacing it', () => {
    const from = src.indexOf('canPublish:')
    expect(from).toBeGreaterThan(-1)
    const line = src.slice(from, src.indexOf('\n', from))
    expect(line).toContain('canSpeak &&')
    expect(line).toContain('!serverMuted(')
  })
})
