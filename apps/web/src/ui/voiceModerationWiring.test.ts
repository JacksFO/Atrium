import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The frames the menu sends are the frames the server reads.
 *
 * This is the failure the whole feature was: three complete server handlers
 * and nothing that spoke to them. A menu that sends `voice-mute` to a server
 * listening for `voice-moderate` fails exactly the same way and looks exactly
 * the same from the outside - a button that does nothing, with no error, on a
 * path nobody tests because both halves are individually correct.
 *
 * So this reads both sides and checks they agree on the name of the frame and
 * on the fields inside it.
 */

const ui = readFileSync(join(__dirname, 'Shell.tsx'), 'utf8').split('\r\n').join('\n')
const gateway = readFileSync(
  join(__dirname, '..', '..', '..', 'server', 'src', 'gateway.ts'), 'utf8',
).split('\r\n').join('\n')

/** The body of one `case` in the gateway's frame switch. */
function handler(name: string): string {
  const from = gateway.indexOf(`case '${name}': {`)
  expect(from, `the server handles ${name}`).toBeGreaterThan(-1)
  const to = gateway.indexOf("\n        case '", from + 10)
  expect(to, `${name} is bounded`).toBeGreaterThan(from)
  return gateway.slice(from, to)
}

describe('silencing somebody', () => {
  const server = handler('voice-moderate')

  it('is sent under the name the server listens for', () => {
    expect(ui).toContain("t: 'voice-moderate'")
  })

  it('and names them in the field the server reads', () => {
    expect(server).toContain("String(msg.userId ?? '')")
    expect(ui).toMatch(/t: 'voice-moderate', userId: id/)
  })

  /*
   * Two separate booleans, not one "moderate" flag. The server treats them
   * as independent - deafening implies a mute unless one was already meant,
   * so that lifting a deafen cannot undo a mute somebody chose - and sending
   * both at once would make that distinction meaningless.
   */
  it('and sets mute and deafen through the two fields it reads', () => {
    expect(server).toContain("typeof msg.serverMuted === 'boolean'")
    expect(server).toContain("typeof msg.serverDeafened === 'boolean'")
    expect(ui).toContain('serverMuted: !mod.serverMuted')
    expect(ui).toContain('serverDeafened: !mod.serverDeafened')
  })

  /* One at a time, so each press is one decision the server can log. */
  it('and never sends both in one frame', () => {
    for (const m of ui.matchAll(/send\(\{\s*\n?\s*t: 'voice-moderate'[^}]*\}/g)) {
      const both = m[0].includes('serverMuted') && m[0].includes('serverDeafened')
      expect(both, `one frame set both: ${m[0]}`).toBe(false)
    }
  })

  /* And the permission it is gated on here is the one the server asks for. */
  it('and is offered on the permission the server checks', () => {
    expect(server).toContain("has('mute_members')")
    const helper = readFileSync(
      join(__dirname, '..', 'lib', 'voiceModeration.ts'), 'utf8')
    expect(helper).toContain("includes('mute_members')")
  })
})

describe('taking somebody out of a call', () => {
  const server = handler('voice-disconnect-member')

  it('is sent under the name the server listens for', () => {
    expect(ui).toContain("t: 'voice-disconnect-member'")
  })

  it('and names them the same way', () => {
    expect(server).toContain("String(msg.userId ?? '')")
    expect(ui).toMatch(/t: 'voice-disconnect-member', userId: id/)
  })

  it('and is offered on the permission the server checks', () => {
    expect(server).toContain("'move_members'")
    const helper = readFileSync(
      join(__dirname, '..', 'lib', 'voiceModeration.ts'), 'utf8')
    expect(helper).toContain("includes('move_members')")
  })
})

/**
 * And the menu asks the helper rather than working it out again.
 *
 * The conditions are the part that has to match the server, and a second copy
 * of them inside a menu builder is a second copy to get wrong - in the one
 * place they cannot be tested.
 */
describe('the member menu', () => {
  it('decides what to offer in one place', () => {
    expect(ui).toContain('voiceModerationFor(world, id)')
  })

  it('and draws nothing when that place says nothing', () => {
    expect(ui).toMatch(/const mod = voiceModerationFor\(world, id\)\s*\n\s*if \(mod\) \{/)
  })
})
